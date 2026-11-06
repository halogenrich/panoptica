import { boxStats, type SlotExtras } from '@psc/core';
import { KINDS } from '../recipes';
import { norm } from '../recipes/types';
import { snapCtx, type Batch } from '../views/Batches';
import { slotPresets } from '../views/BatchReport';
import { inStats, type Dir, type IvSetFull, type Link, type MetricKey, type StatRow } from '../iv/model';

/** A device as listed by the server for picking (GET /api/comparisons/devices). */
export interface DeviceRow {
  set: number;
  setName: string;
  date: string;
  system: string;
  owner: string;
  mine: boolean;
  sample: string;
  substrate: string;
  link: (Link & { label: string }) | null;
  group: string;
  off: boolean;
  best: number;
  pixels: number;
}
export type Member = { set: number; sample: string; substrate: string };
export type Group = { id: string; name: string; ref?: boolean; members: Member[] };
export type CmpData = { groups: Group[]; dir?: Dir | 'both'; relative?: boolean; metrics?: MetricKey[] };
export interface Comparison {
  id: number;
  name: string;
  visibility: 'private' | 'shared';
  notes: string;
  owner: string;
  mine: boolean;
  editable: boolean;
  updated_at: string;
  data: CmpData;
  groups: number;
  devices: number;
}

export const memberKey = (m: Member) => `${m.set}|${m.sample}|${m.substrate}`;
export const newId = () => Math.random().toString(36).slice(2, 9);

/**
 * Sample names in the lab are usually `batch_mod` (e.g. TripleC_Padrao, TripleC_fulerenol_com_aneal): the part before the first
 * underscore names the batch, the rest the modification. Without an underscore the whole name is the modification.
 */
export function splitName(sample: string) {
  const i = sample.indexOf('_');
  return i > 0 ? { batch: sample.slice(0, i), mod: sample.slice(i + 1) } : { batch: '', mod: sample };
}
const REF = /^(padr[aã]o|ref(erence|er[eê]ncia)?|control(e|o)?|std|standard)$/i;

/** Edit distance, for spotting typos between names (small strings only). */
function dist(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

/**
 * Groups from the names: one group per modification, the reference ("Padrão", "ref", "control"…) first and marked.
 * Names to check: no batch_mod form, or a modification (or batch part) that is one or two letters away from a more common one,
 * which is usually a typo ("Padroa" next to "Padrao") that would otherwise make a group of its own.
 */
export function autoGroups(devs: DeviceRow[]): { groups: Group[]; odd: { dev: DeviceRow; why: string }[] } {
  const parts = devs.map((d) => ({ d, ...splitName(d.sample) }));
  const tally = (xs: string[]) => {
    const m = new Map<string, number>();
    for (const x of xs) if (x) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const mods = tally(parts.map((p) => p.mod)),
    batches = tally(parts.map((p) => p.batch));
  const near = (x: string, all: Map<string, number>) =>
    [...all.entries()].find(
      ([y, n]) =>
        y !== x &&
        n > (all.get(x) ?? 0) &&
        (y.toLowerCase() === x.toLowerCase() ||
          (Math.min(x.length, y.length) > 3 && dist(x.toLowerCase(), y.toLowerCase()) <= 2)),
    )?.[0];
  const odd: { dev: DeviceRow; why: string }[] = [];
  for (const p of parts) {
    const m = near(p.mod, mods),
      b = p.batch && near(p.batch, batches);
    if (!p.batch) odd.push({ dev: p.d, why: 'not in the batch_mod form, so its whole name is the group' });
    else if (m) odd.push({ dev: p.d, why: `“${p.mod}” looks like a typo of “${m}”: it made its own group` });
    else if (b) odd.push({ dev: p.d, why: `batch part “${p.batch}” looks like a typo of “${b}”` });
  }
  const by = new Map<string, Group>();
  for (const p of parts) {
    const k = p.mod.toLowerCase();
    if (!by.has(k)) by.set(k, { id: newId(), name: p.mod.replace(/_/g, ' '), members: [] });
    by.get(k)!.members.push({ set: p.d.set, sample: p.d.sample, substrate: p.d.substrate });
  }
  const groups = [...by.values()];
  const ref = groups.find((g) => REF.test(g.name.trim()));
  if (ref) ref.ref = true;
  return { groups: ref ? [ref, ...groups.filter((g) => g !== ref)] : groups, odd };
}

/** One counted curve of a device in the comparison, with its group and measurement. */
export type CRow = StatRow & { gid: string; setId: number; dev: string };

/** Rows for the comparison: every counted curve (best scan per pixel and direction, never a check sweep) of each member. */
export function cmpRows(groups: Group[], sets: Record<number, IvSetFull>): CRow[] {
  return groups.flatMap((g) =>
    g.members.flatMap((m) => {
      const s = sets[m.set];
      if (!s) return [];
      return s.curves
        .filter((c) => c.sample === m.sample && c.substrate === m.substrate && inStats(c, s.curves))
        .map((c) => ({
          set: s.name,
          setId: s.id,
          date: s.date,
          group: g.name || 'Unnamed group',
          gkey: g.id,
          gid: g.id,
          dev: memberKey(m),
          sample: c.sample,
          substrate: c.substrate,
          pixel: c.pixel,
          scan: c.scan,
          dir: c.dir,
          m: c.m,
        }));
    }),
  );
}

/**
 * Relative to the reference: each value divided by the median of the reference group's pixels in the same measurement and
 * direction, so day-to-day differences of the lamp, the room or the system cancel out. Rows without a reference in their
 * measurement are dropped (and counted, to tell the user).
 */
export function relative(rows: CRow[], refId: string | undefined, keys: MetricKey[]) {
  if (!refId) return { rows, missing: 0 };
  const med = new Map<string, number>();
  const key = (r: CRow, k: string) => `${r.setId}|${r.dir}|${k}`;
  for (const k of keys) {
    const by = new Map<string, number[]>();
    for (const r of rows)
      if (r.gid === refId && Number.isFinite(r.m[k] as number)) {
        const x = by.get(key(r, k)) ?? [];
        x.push(r.m[k] as number);
        by.set(key(r, k), x);
      }
    for (const [kk, v] of by) med.set(kk, boxStats(v)!.median);
  }
  let missing = 0;
  const out: CRow[] = [];
  for (const r of rows) {
    if (!med.has(key(r, 'pce'))) {
      missing++;
      continue;
    }
    const m: any = { ...r.m };
    for (const k of keys) {
      const b = med.get(key(r, k));
      m[k] = b && Number.isFinite(r.m[k] as number) ? (r.m[k] as number) / b : NaN;
    }
    out.push({ ...r, m });
  }
  return { rows: out, missing };
}

/** The batch's recipe values in words, by layer: "Layer 2 · SnO2 › Speed" → "4000 rpm", from its frozen snapshot. */
export function batchFacts(b: Batch): Record<string, string> {
  const ctx = snapCtx(b),
    out: Record<string, string> = {},
    seen = new Map<string, number>();
  b.snapshot.stack.sl.forEach((s) => {
    const n = (seen.get(s.n) ?? 0) + 1;
    seen.set(s.n, n);
    const layer = n > 1 ? `${s.n} (${n})` : s.n;
    if (s.m === 'Manual') {
      out[`${layer} › Method`] = `by hand: ${s.t ?? ''}`.trim();
      return;
    }
    out[`${layer} › Method`] = s.m;
    // what a batch variant adds to the layer
    const x = s as typeof s & SlotExtras;
    if (x.add?.length) out[`${layer} › Additive`] = x.add.join(', ');
    if (x.note?.length) out[`${layer} › Change`] = x.note.join('; ');
    for (const p of slotPresets(s)) {
      const r = ctx.all.find((x) => String(x.id) === String(p.id)),
        k = KINDS[p.seg];
      if (!r) continue;
      out[`${layer} › Recipe`] = (out[`${layer} › Recipe`] ? out[`${layer} › Recipe`] + ' + ' : '') + r.name;
      if (!k) continue;
      for (const [a, v] of Object.entries(k.describe(norm(k, r.data), ctx))) out[`${layer} › ${a}`] = v;
    }
  });
  const notes = (b.snapshot as { notes?: string[] }).notes;
  if (notes?.length) out['Device › Change'] = notes.join('; ');
  return out;
}

/** What differs between two sets of facts: [what, reference value, this value]. */
export function diffFacts(ref: Record<string, string>, b: Record<string, string>): [string, string, string][] {
  return Object.keys({ ...ref, ...b })
    .filter((k) => (ref[k] ?? '') !== (b[k] ?? ''))
    .map((k) => [k, ref[k] ?? '—', b[k] ?? '—']);
}
