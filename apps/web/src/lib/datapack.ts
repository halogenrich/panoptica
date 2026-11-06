import { strToU8, zipSync } from 'fflate';
import { sha256 } from '@psc/core';
import { api } from '../api';
import type { Batch, BRun } from '../views/Batches';
import { snapCtx } from '../views/Batches';
import { batchMeasurements, batchSheets } from '../views/BatchReport';
import type { Booking } from '../views/Calendar';
import { SYSTEM, inStats, isCheck, type IvSet, type IvSetFull } from '../iv/model';
import { cmpRows, type Comparison } from '../compare/model';
import type { Sheet } from './xlsx';
import { fixName } from './names';

/**
 * Data package: a .zip with the chosen batches, measurements and comparisons as open formats (CSV and JSON), a README that
 * describes them (what, who, when, how, units), metadata.json with the fields of a repository deposit (REDU / Dataverse) and
 * SHA-256 checksums of every file. Meant for the data management plan of a FAPESP project: what is deposited is self-describing.
 */
export type PackMeta = {
  title: string;
  description: string;
  authors: string;
  affiliation: string;
  grant: string;
  license: string;
  keywords: string;
};
export type PackSel = { batches: number[]; iv: number[]; cmp: number[] };
export const LICENSES: [string, string][] = [
  ['CC-BY-4.0', 'CC BY 4.0 (reuse with credit)'],
  ['CC0-1.0', 'CC0 1.0 (public domain)'],
  ['CC-BY-NC-4.0', 'CC BY-NC 4.0 (credit, no commercial use)'],
  ['', 'Not decided yet (internal use)'],
];

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'item';
const cell = (v: unknown) => {
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const csv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
/** Derived values to 6 significant digits (the curves themselves are written as stored). */
const sig = (x: number) => (Number.isFinite(x) ? Number(x.toPrecision(6)) : x);
const json = (x: unknown) => JSON.stringify(x, null, 2) + '\n';
const day = (s: string) => (s ?? '').slice(0, 10);

/** Everything the package may hold, and how the items are linked (to add what the chosen ones depend on). */
export async function packCatalog() {
  const [batches, sets, cmps] = await Promise.all([
    api<{ id: number; code: string; name: string; status: string; owner: string; created_at: string }[]>('/batches'),
    api<IvSet[]>('/iv'),
    api<{ id: number; name: string; owner: string; updated_at: string }[]>('/comparisons'),
  ]);
  return { batches, sets, cmps };
}
export type Catalog = Awaited<ReturnType<typeof packCatalog>>;

/** The chosen items plus what they depend on: a batch's measurements, a measurement's batches, a comparison's measurements. */
export async function withLinked(sel: PackSel, cat: Catalog): Promise<PackSel> {
  const iv = new Set(sel.iv),
    b = new Set(sel.batches);
  for (const id of sel.cmp) {
    const c = await api<Comparison>('/comparisons/' + id).catch(() => null);
    c?.data.groups.forEach((g) => g.members.forEach((m) => iv.add(m.set)));
  }
  for (const s of cat.sets) {
    const linkedTo = Object.values(s.links ?? {})
      .filter((l) => l?.kind === 'batch')
      .map((l) => l!.id);
    if (linkedTo.some((x) => b.has(x))) iv.add(s.id);
  }
  for (const s of cat.sets)
    if (iv.has(s.id)) for (const l of Object.values(s.links ?? {})) if (l?.kind === 'batch') b.add(l.id);
  const can = new Set(cat.batches.map((x) => x.id));
  return { batches: [...b].filter((x) => can.has(x)), iv: [...iv], cmp: sel.cmp };
}

type Files = Record<string, Uint8Array>;
const put = (f: Files, path: string, text: string) => (f[path] = strToU8(text));
const sheetsAsCsv = (f: Files, dir: string, sheets: Sheet[]) =>
  sheets.forEach((s) => put(f, `${dir}/${slug(s.name).toLowerCase()}.csv`, csv(s.rows)));

async function packBatch(f: Files, id: number) {
  const b = await api<Batch & Record<string, unknown>>('/batches/' + id);
  const [runs, books, sets] = await Promise.all([
    api<BRun[]>(`/batches/${id}/runs`).catch(() => []),
    api<Booking[]>(`/batches/${id}/bookings`).catch(() => []),
    batchMeasurements(id),
  ]);
  const dir = `batches/${slug(b.code)}`;
  put(
    f,
    `${dir}/batch.json`,
    json({
      code: b.code,
      description: b.name,
      status: b.status,
      owner: b.owner,
      started: b.created_at,
      visibility: b.visibility,
      snapshot: b.snapshot,
      record: b.record,
      variants: b.variants ?? null,
      bookings: books.map((k) => ({
        equipment: k.equipment,
        step: k.step,
        start: k.start,
        end: k.end,
        outcome: k.outcome,
        reason: k.reason,
      })),
      runData: runs,
    }),
  );
  sheetsAsCsv(f, dir, batchSheets(b, snapCtx(b), runs, sets, books));
  return { code: b.code, name: b.name, owner: b.owner, date: day(b.created_at) };
}

async function packSet(f: Files, id: number) {
  const s = await api<IvSetFull & { created_at: string; notes: string }>('/iv/' + id);
  const dir = `measurements/${id}-${slug(s.name)}`;
  const { curves, ...meta } = s;
  put(
    f,
    `${dir}/measurement.json`,
    json({
      ...meta,
      system: SYSTEM[s.system] ?? s.system,
      curves: curves.length,
      units: { V: 'V', J: 'mA/cm²', area: 'cm²', light: 'mW/cm²', pce: '%', ff: '%', rs: 'Ω·cm²', rsh: 'Ω·cm²' },
    }),
  );
  // one file per curve: sample_substrate_pixel_scan_direction (a number added if two would share a name)
  const used = new Set<string>(),
    names = new Map<number, string>();
  for (const c of curves) {
    const base =
      [c.sample, c.substrate, c.pixel, c.scan].filter(Boolean).map(slug).join('_') +
      `_${c.dir === 'rev' ? 'backward' : 'forward'}`;
    let n = base;
    for (let k = 2; used.has(n); k++) n = `${base}_${k}`;
    used.add(n);
    names.set(c.id, `curves/${n}.csv`);
  }
  const name = (c: (typeof curves)[number]) => names.get(c.id)!;
  put(
    f,
    `${dir}/pixels.csv`,
    csv([
      [
        'sample',
        'substrate',
        'pixel',
        'scan',
        'direction',
        'linked_to',
        'area_cm2',
        'light_mW_cm2',
        'status',
        'check_sweep',
        'counted',
        'voc_V',
        'jsc_mA_cm2',
        'ff_pct',
        'pce_pct',
        'vmp_V',
        'jmp_mA_cm2',
        'rs_ohm_cm2',
        'rsh_ohm_cm2',
        'instrument_pce_pct',
        'source_file',
        'curve_file',
      ],
      ...curves.map((c) => [
        c.sample,
        c.substrate,
        c.pixel,
        c.scan,
        c.dir === 'rev' ? 'backward' : 'forward',
        s.links[c.sample]?.label ?? '',
        c.area,
        c.pin,
        c.m.status,
        isCheck(c) ? 'yes' : 'no',
        inStats(c, curves) ? 'yes' : 'no',
        sig(c.m.voc),
        sig(c.m.jsc),
        sig(c.m.ff),
        sig(c.m.pce),
        sig(c.m.vmp),
        sig(c.m.jmp),
        sig(c.m.rs),
        sig(c.m.rsh),
        c.inst?.pce != null ? sig(c.inst.pce) : '',
        fixName(c.file),
        name(c),
      ]),
    ]),
  );
  for (const c of curves) put(f, `${dir}/${name(c)}`, csv([['V_V', 'J_mA_cm2'], ...c.V.map((v, i) => [v, c.J[i]])]));
  return { name: s.name, owner: s.owner, date: day(s.date), system: s.system };
}

async function packCmp(f: Files, id: number) {
  const c = await api<Comparison>('/comparisons/' + id);
  const ids = [...new Set(c.data.groups.flatMap((g) => g.members.map((m) => m.set)))];
  const sets: Record<number, IvSetFull> = {};
  for (const x of ids) {
    const s = await api<IvSetFull>('/iv/' + x).catch(() => null);
    if (s) sets[x] = s;
  }
  const dir = `comparisons/${id}-${slug(c.name)}`;
  put(f, `${dir}/comparison.json`, json(c));
  put(
    f,
    `${dir}/pixels.csv`,
    csv([
      [
        'group',
        'reference',
        'measurement',
        'sample',
        'substrate',
        'pixel',
        'scan',
        'direction',
        'voc_V',
        'jsc_mA_cm2',
        'ff_pct',
        'pce_pct',
        'rs_ohm_cm2',
        'rsh_ohm_cm2',
      ],
      ...cmpRows(c.data.groups, sets).map((r) => [
        r.group,
        c.data.groups.find((g) => g.id === r.gid)?.ref ? 'yes' : 'no',
        r.set,
        r.sample,
        r.substrate,
        r.pixel,
        r.scan,
        r.dir === 'rev' ? 'backward' : 'forward',
        sig(r.m.voc),
        sig(r.m.jsc),
        sig(r.m.ff),
        sig(r.m.pce),
        sig(r.m.rs),
        sig(r.m.rsh),
      ]),
    ]),
  );
  return { name: c.name, owner: (c as { owner?: string }).owner ?? '' };
}

const LICENSE_TEXT: Record<string, string> = {
  'CC-BY-4.0': 'Creative Commons Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/)',
  'CC0-1.0': 'Creative Commons Zero 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/)',
  'CC-BY-NC-4.0':
    'Creative Commons Attribution-NonCommercial 4.0 International (https://creativecommons.org/licenses/by-nc/4.0/)',
  '': 'Not decided yet: internal use only until a licence is chosen.',
};

/** Builds the package; `step` reports progress. Returns the zip and its file name. */
export async function buildPackage(sel: PackSel, meta: PackMeta, version: string, step: (t: string) => void) {
  const f: Files = {};
  const b: Awaited<ReturnType<typeof packBatch>>[] = [],
    m: Awaited<ReturnType<typeof packSet>>[] = [],
    c: Awaited<ReturnType<typeof packCmp>>[] = [];
  for (const [i, id] of sel.batches.entries()) {
    step(`Batch ${i + 1} of ${sel.batches.length}`);
    b.push(await packBatch(f, id));
  }
  for (const [i, id] of sel.iv.entries()) {
    step(`Measurement ${i + 1} of ${sel.iv.length}`);
    m.push(await packSet(f, id));
  }
  for (const [i, id] of sel.cmp.entries()) {
    step(`Comparison ${i + 1} of ${sel.cmp.length}`);
    c.push(await packCmp(f, id));
  }
  step('Checksums');
  const dates = [...b.map((x) => x.date), ...m.map((x) => x.date)].filter(Boolean).sort();
  const today = new Date().toISOString().slice(0, 10);
  const authors = meta.authors
    .split(/[;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
  const keywords = meta.keywords
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
  // the citation fields of a Dataverse deposit (REDU, Unicamp's research data repository, runs Dataverse)
  put(
    f,
    'metadata.json',
    json({
      title: meta.title,
      authors: authors.map((name) => ({ name, affiliation: meta.affiliation })),
      description: meta.description,
      subject: ['Engineering', 'Physics', 'Chemistry'],
      keywords,
      license: meta.license || null,
      grant: meta.grant ? { agency: 'FAPESP', number: meta.grant } : null,
      kindOfData: ['Current–voltage (J–V) measurements', 'Device fabrication records'],
      timePeriodCovered: dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null,
      dateOfDeposit: null,
      productionDate: today,
      software: { name: 'Perovskite Lab', version },
      contents: { batches: b, measurements: m, comparisons: c },
    }),
  );
  put(f, 'README.md', readme(meta, authors, keywords, b, m, c, dates, today, version));
  const manifest = Object.keys(f)
    .sort()
    .map((p) => `${sha256(f[p])}  ${p}`)
    .join('\n');
  put(f, 'manifest-sha256.txt', manifest + '\n');
  step('Compressing');
  const root = slug(meta.title || 'data-package');
  const zip = zipSync(Object.fromEntries(Object.entries(f).map(([p, d]) => [`${root}/${p}`, d])), { level: 6 });
  return { zip, name: `${root}.zip`, files: Object.keys(f).length };
}

function readme(
  meta: PackMeta,
  authors: string[],
  keywords: string[],
  b: { code: string; name: string; owner: string; date: string }[],
  m: { name: string; owner: string; date: string; system: string }[],
  c: { name: string; owner: string }[],
  dates: string[],
  today: string,
  version: string,
) {
  const L: string[] = [];
  L.push(`# ${meta.title}`, '');
  if (meta.description) L.push(meta.description.trim(), '');
  L.push(
    `- Authors: ${authors.join('; ') || 'not given'}`,
    `- Affiliation: ${meta.affiliation || 'not given'}`,
    ...(meta.grant ? [`- Funding: FAPESP, process ${meta.grant}`] : []),
    `- Licence: ${LICENSE_TEXT[meta.license] ?? meta.license}`,
    `- Keywords: ${keywords.join(', ') || 'none'}`,
    `- Period covered: ${dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : 'not dated'}`,
    `- Package made: ${today}, with Perovskite Lab ${version}`,
    '',
    '## Contents',
    '',
  );
  if (b.length) {
    L.push(`Batches (${b.length}), folder \`batches/\`:`, '');
    b.forEach((x) => L.push(`- ${x.code}${x.name ? ` (${x.name})` : ''}, started ${x.date} by ${x.owner}`));
    L.push('');
  }
  if (m.length) {
    L.push(`J–V measurements (${m.length}), folder \`measurements/\`:`, '');
    m.forEach((x) => L.push(`- ${x.name}, ${SYSTEM[x.system] ?? x.system}, measured ${x.date} by ${x.owner}`));
    L.push('');
  }
  if (c.length) {
    L.push(`Comparisons (${c.length}), folder \`comparisons/\`:`, '');
    c.forEach((x) => L.push(`- ${x.name}${x.owner ? `, by ${x.owner}` : ''}`));
    L.push('');
  }
  L.push(
    '## Files',
    '',
    '- `batches/<code>/batch.json`: the batch as started (stack and recipes frozen at the start), its variants, bookings, record and run data.',
    '- `batches/<code>/*.csv`: the same as tables: batch, layers, variants, recipes (one row per recipe value), run data (recipe value against the actual value), J–V pixels and statistics of its measurements.',
    '- `measurements/<id>-<name>/measurement.json`: system, date, owner, links of each sample to a batch or stack, device groups.',
    '- `measurements/<id>-<name>/pixels.csv`: one row per J–V curve with its parameters, whether it is a check sweep and whether it counts in the statistics.',
    '- `measurements/<id>-<name>/curves/*.csv`: the curves, one file per pixel, scan and direction (named in `pixels.csv`, column `curve_file`).',
    '- `comparisons/<id>-<name>/comparison.json`: the groups of devices compared and the settings; `pixels.csv`: the counted pixels of each group.',
    '- `metadata.json`: the fields of a repository deposit (title, authors, description, keywords, licence, grant, dates).',
    '- `manifest-sha256.txt`: SHA-256 of every file. Check with `sha256sum -c manifest-sha256.txt` (Linux, macOS) after copying or downloading.',
    '',
    '## Formats and units',
    '',
    'CSV files are UTF-8, comma-separated, with a header row and a decimal point. JSON files are UTF-8.',
    '',
    '- Voltage V in volts; current density J in mA/cm²; photocurrent positive (power quadrant V > 0, J > 0).',
    '- Jsc in mA/cm²; Voc and Vmp in V; FF and PCE in %; Rs and Rsh in Ω·cm²; pixel area in cm²; light intensity in mW/cm².',
    '- Dates are ISO 8601 (yyyy-mm-dd); times are UTC.',
    '',
    '## Methods',
    '',
    '- Devices were made as recorded in each batch: the stack (layer order, method and recipe of each layer) frozen when the batch started, the variants (devices that differ from the default), and the values recorded during the run.',
    '- J–V curves were measured on the 8-pixel system (Padrão) or the 1.5 × 2.5 system and imported from the instrument files (named in `source_file`).',
    '- Parameters were calculated by Perovskite Lab from each curve: Jsc at 0 V, Voc where the current crosses zero, maximum power on a fine grid, FF, PCE from the light intensity, Rs and Rsh from the slopes at Voc and at 0 V. Isolated contact glitches are left out. `instrument_pce_pct` is the value the instrument software reported, for comparison.',
    '- Counted pixels (`counted`): working pixels only, never check sweeps (a quick exploratory scan before the real measurement of the same pixel), and when a pixel was measured more than once, its best scan in each direction. Statistics and comparisons use counted pixels only.',
    '',
    '## Depositing',
    '',
    'FAPESP asks that data from the projects it funds be deposited in an institutional repository. At Unicamp that is REDU (Repositório de Dados de Pesquisa da Unicamp). Upload the files of this folder; `metadata.json` holds what the deposit form asks for.',
    '',
  );
  return L.join('\n');
}
