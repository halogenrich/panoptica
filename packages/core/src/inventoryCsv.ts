import { normCas, molarMass } from './chem';

/**
 * Reading an inventory export (0.44): OpenEnventory's package list, or any spreadsheet saved as CSV. Each row is a container; rows
 * with the same CAS number (or, without one, the same name) are one substance. Only what PANOPTICA keeps is read: one name (the
 * export lists it in several languages), formula, molar mass, density, melting and boiling point, refractive index, CAS, hazard
 * pictograms, whether the Federal Police or the Army controls it; and for the container its amount, size, supplier, lot,
 * purity, dates, place and barcode.
 */
export type ImportRow = {
  /** the substance this container is of: its CAS number, or its name when there is none */
  key: string;
  name: string;
  cas: string;
  f: string;
  M: number | null;
  d: number | null;
  mp: number | null;
  bp: number | null;
  nD: number | null;
  ghs: string[];
  pf: boolean;
  army: boolean;
  amount: number | null;
  size: number | null;
  unit: string;
  supplier: string;
  lot: string;
  purity: number | null;
  expires: string | null;
  opened: string | null;
  /** where it is, as the export writes it ("B3-GB Toy - Evap"); the person maps it to a storage place */
  place: string;
  barcode: string;
  notes: string;
};
export type ImportSubstance = Omit<
  ImportRow,
  'amount' | 'size' | 'unit' | 'supplier' | 'lot' | 'purity' | 'expires' | 'opened' | 'place' | 'barcode' | 'notes'
> & { containers: number };
export type ImportResult = {
  rows: ImportRow[];
  substances: ImportSubstance[];
  /** the places found, each once */
  places: string[];
  /** which column each field was read from (shown so the person can check) */
  columns: Record<string, string>;
  /** lines that are not containers ("Results from own database") */
  skipped: number;
};

type Field = keyof ImportRow | 'comment' | 'catalog';
/** Column headers, lowercased, for each field (OpenEnventory first, then common spreadsheet names). */
const HEADERS: [Field, string[]][] = [
  [
    'name',
    ['name', 'molecule_name', 'molecule', 'chemical', 'chemical name', 'substance', 'compound', 'nome', 'reagente'],
  ],
  ['cas', ['cas number', 'cas', 'cas_nr', 'casnr', 'cas no', 'cas-nr', 'cas nº']],
  ['f', ['empirical formula', 'formula', 'molecular formula', 'fórmula', 'formula molecular']],
  ['M', ['mw', 'molar mass', 'molecular weight', 'massa molar']],
  ['d', ['density', 'densidade']],
  ['mp', ['melting point', 'mp', 'ponto de fusão']],
  ['bp', ['boiling point', 'bp', 'ponto de ebulição']],
  ['nD', ['refractive index', 'índice de refração']],
  ['ghs', ['haz. cod.', 'ghs', 'pictograms', 'hazard pictograms']],
  ['amount', ['amount', 'actual_amount', 'quantity', 'qty', 'quantidade', 'remaining', 'amount left']],
  ['size', ['package_amount', 'size', 'container size', 'package size', 'total amount', 'tamanho']],
  ['unit', ['amount_unit', 'unit', 'units', 'unidade']],
  ['supplier', ['supplier', 'vendor', 'brand', 'manufacturer', 'fornecedor', 'marca']],
  ['lot', ['lot no.', 'lot', 'lot_no', 'lot number', 'batch no.', 'batch_no', 'lote']],
  ['purity', ['purity/concentration', 'purity', 'pureza']],
  ['expires', ['expiry date', 'expiry_date', 'expiry', 'expires', 'expiration', 'validade']],
  ['opened', ['date opened', 'open_date', 'opened', 'opening date', 'aberto', 'data de abertura']],
  ['place', ['storage', 'storage_name', 'location', 'place', 'cabinet', 'local', 'armário', 'armario']],
  ['barcode', ['barcode', 'código de barras']],
  ['comment', ['comment on chemical', 'comment', 'comments', 'notes', 'description', 'observações', 'observacoes']],
  ['catalog', ['catalog no.', 'catalog', 'catalogue no.', 'cat. no.']],
];
const clean = (h: string) =>
  h
    .replace(/\u00a0/g, ' ')
    .replace(/\s*\(.*?\)\s*$/, '') // "density (20°C)"
    .trim()
    .toLowerCase();

/** CSV or TSV with quotes; the delimiter is guessed from the first line. */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0],
    d = [',', ';', '\t'].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === d) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const num = (v: string) => {
  const m = v
    .replace(/\u00a0/g, ' ')
    .replace(',', '.')
    .match(/-?\d+(?:\.\d+)?/);
  return m ? +m[0] : null;
};
const UNIT: Record<string, string> = { g: 'g', mg: 'mg', kg: 'kg', ml: 'mL', l: 'L', ul: 'µL', µl: 'µL' };
const unitOf = (v: string) => UNIT[v.trim().toLowerCase()] ?? null;
/** "45 g / 100 g" (left / size, OpenEnventory) or "100 g" (a full container). */
function amountOf(v: string): { amount: number | null; size: number | null; unit: string | null } {
  const parts = v.replace(/\u00a0/g, ' ').split('/');
  const read = (s: string) => {
    const m = s.trim().match(/^(-?[\d.,]+)\s*([a-zA-Zµ]*)/);
    return m ? { n: num(m[1]), u: unitOf(m[2]) } : { n: null, u: null };
  };
  const a = read(parts[0]),
    b = parts[1] ? read(parts[1]) : null;
  return { amount: a.n, size: b ? b.n : a.n, unit: a.u ?? b?.u ?? null };
}
const dateOf = (v: string) => {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};
const textOf = (html: string) =>
  html
    .replace(/<br\s*\/?>|<\/div>|<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
const POLICE = /pol[ií]cia\s+federal|federal\s+police/i,
  ARMY = /ex[ée]rcito|militar|army/i;
/** Words that mark a name as another language's or a catalogue entry ("zur Synthese, Sigma-Aldrich®", "(German)"). */
const NOT_NAME = /\(german\)|®|\bzur synthese\b|\bfür\b|\bultra trocken\b|\breinst\b|\bbezogen\b|\bwasserfrei\b/i;
/** German chemical names ("Zinn(II)bromid", "Pyridindicarbonsäure"): another entry is preferred when there is one. */
const GERMAN =
  /[äöüß]|säure|(chlorid|bromid|iodid|jodid|fluorid|nitrat|sulfat|oxid|hydroxid|carbonat|acetat|phosphat)\b|\b(zinn|blei|kupfer|eisen|natrium|kalium|wasser)/i;
/** One name from "Lead(II) iodide; lead diiodide; Blei(II)-iodid…": the first that is not a catalogue or German entry, without
 * its purity. */
export function nameOf(v: string): string {
  const all = v
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
  const ok = all.filter((x) => !NOT_NAME.test(x));
  const pick = ok.find((x) => !GERMAN.test(x)) ?? ok[0] ?? all[0] ?? '';
  return pick
    .replace(/\s*\(\s*[≥>]?\s*\d+(?:[.,]\d+)?\s*%\s*\)/g, '')
    .replace(/,?\s*[≥>]?\s*\d+(?:[.,]\d+)?\s*%.*$/, '')
    .trim();
}
const purityIn = (v: string) => {
  const m = v.match(/[≥>]?\s*(\d{2,3}(?:[.,]\d+)?)\s*%/);
  const p = m ? +m[1].replace(',', '.') : null;
  return p !== null && p > 0 && p <= 100 ? p : null;
};

/** The export read into containers and the substances they are of. */
export function readInventory(text: string): ImportResult {
  const all = parseCsv(text);
  // the header: the first line where most cells are known column names
  let hi = all.findIndex((r) => r.filter((c) => HEADERS.some(([, s]) => s.includes(clean(c)))).length >= 3);
  if (hi < 0) hi = 0;
  const head = (all[hi] ?? []).map(clean);
  const col: Partial<Record<Field, number>> = {},
    columns: Record<string, string> = {};
  for (const [f, names] of HEADERS) {
    const i = names.map((n) => head.indexOf(n)).find((i) => i >= 0);
    if (i !== undefined) {
      col[f] = i;
      columns[f] = all[hi][i].replace(/\u00a0/g, ' ').trim();
    }
  }
  const body = all.slice(hi + 1),
    // a line with far fewer cells than the header is not a container ("Results from own database")
    lines = body.filter((r) => r.length >= Math.max(2, head.length / 2));
  const rows: ImportRow[] = [];
  for (const r of lines) {
    const g = (f: Field) => (col[f] !== undefined ? (r[col[f]!] ?? '').trim() : '');
    const name = nameOf(g('name'));
    if (!name) continue;
    const comment = textOf(g('comment')),
      everything = r.join(' ');
    const am = amountOf(g('amount')),
      sz = g('size') ? amountOf(g('size')) : null;
    const f = g('f').replace(/\s+/g, '');
    const M = num(g('M')) || (f ? molarMass(f) : null);
    const cas = normCas(g('cas'));
    const notes = [
      comment
        .split('\n')
        .filter((l) => !POLICE.test(l) && !ARMY.test(l))
        .join('\n'),
      g('catalog') ? `Catalogue no. ${g('catalog')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    rows.push({
      key: cas || name.toLowerCase(),
      name,
      cas,
      f,
      M,
      d: num(g('d')),
      mp: num(g('mp')),
      bp: num(g('bp')),
      nD: num(g('nD')),
      ghs: g('ghs')
        .split(/[,;\s]+/)
        .map((x) => x.trim().toUpperCase())
        .filter((x) => /^GHS0\d$/.test(x)),
      pf: POLICE.test(everything),
      army: ARMY.test(comment),
      amount: am.amount,
      size: sz?.amount ?? am.size,
      unit: unitOf(g('unit')) ?? am.unit ?? sz?.unit ?? 'g',
      supplier: g('supplier'),
      lot: g('lot'),
      purity: purityIn(g('purity') ? g('purity') + (g('purity').includes('%') ? '' : '%') : '') ?? purityIn(g('name')),
      expires: dateOf(g('expires')),
      opened: dateOf(g('opened')),
      place: g('place')
        .replace(/\u00a0/g, ' ')
        .replace(/^compartment\s+/i, '')
        .trim(),
      barcode: g('barcode'),
      notes,
    });
  }
  const by = new Map<string, ImportSubstance>();
  for (const r of rows) {
    const s = by.get(r.key);
    if (!s) {
      by.set(r.key, {
        key: r.key,
        name: r.name,
        cas: r.cas,
        f: r.f,
        M: r.M,
        d: r.d,
        mp: r.mp,
        bp: r.bp,
        nD: r.nD,
        ghs: r.ghs,
        pf: r.pf,
        army: r.army,
        containers: 1,
      });
      continue;
    }
    s.containers++;
    // what one row leaves out, another may have; the shortest name is usually the plainest
    if (r.name.length < s.name.length) s.name = r.name;
    s.f ||= r.f;
    s.M ??= r.M;
    s.d ??= r.d;
    s.mp ??= r.mp;
    s.bp ??= r.bp;
    s.nD ??= r.nD;
    s.ghs = [...new Set([...s.ghs, ...r.ghs])];
    s.pf ||= r.pf;
    s.army ||= r.army;
  }
  return {
    rows,
    substances: [...by.values()],
    places: [...new Set(rows.map((r) => r.place).filter(Boolean))],
    columns,
    skipped: body.length - lines.length,
  };
}

/**
 * A place from an export as a storage place and a division: "Cabinet 2 - 07" → Cabinet 2, 07; "Fridge - Door" → Fridge, Door. A
 * place without " - " is a storage place on its own. `known` (the lab's storage places) wins when the whole name is one.
 */
export function splitPlace(place: string, known: string[] = []): { area: string; shelf: string } {
  const p = place.trim(),
    same = known.find((k) => k.toLowerCase() === p.toLowerCase());
  if (same) return { area: same, shelf: '' };
  const m = p.match(/^(.+?)\s+[-–]\s+(.+)$/);
  if (!m) return { area: p, shelf: '' };
  return { area: known.find((k) => k.toLowerCase() === m[1].toLowerCase()) ?? m[1], shelf: m[2] };
}
