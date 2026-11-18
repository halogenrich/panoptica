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
  /** short name and other names (0.54, the template's columns) */
  s: string;
  aka: string[];
  f: string;
  /** the structure (0.57, the template's SMILES column) */
  smiles: string;
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
  /** lines that are not containers ("Results from own database"), and the template's example row */
  skipped: number;
  /** places given as a storage place and a division in their own columns (the template, 0.54): read as they are */
  placeParts: Record<string, { area: string; shelf: string }>;
};

type Field = keyof ImportRow | 'comment' | 'catalog' | 'division' | 'pfcol' | 'armycol';
/** Column headers, lowercased, for each field (OpenEnventory first, then common spreadsheet names). */
const HEADERS: [Field, string[]][] = [
  [
    'name',
    ['name', 'molecule_name', 'molecule', 'chemical', 'chemical name', 'substance', 'compound', 'nome', 'reagente'],
  ],
  ['cas', ['cas number', 'cas', 'cas_nr', 'casnr', 'cas no', 'cas-nr', 'cas nº']],
  ['s', ['short name', 'abbreviation', 'acronym', 'sigla', 'nome curto']],
  ['aka', ['other names', 'synonyms', 'outros nomes', 'sinônimos', 'sinonimos']],
  ['f', ['empirical formula', 'formula', 'molecular formula', 'fórmula', 'formula molecular']],
  ['smiles', ['smiles', 'canonical smiles', 'isomeric smiles']],
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
  [
    'place',
    ['storage place', 'storage', 'storage_name', 'location', 'place', 'cabinet', 'local', 'armário', 'armario'],
  ],
  ['division', ['division', 'shelf', 'divisão', 'divisao', 'prateleira']],
  ['pfcol', ['federal police', 'polícia federal', 'policia federal']],
  ['armycol', ['army', 'exército', 'exercito']],
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
  // a date cell of a spreadsheet read as its number of days since 30/12/1899 (Excel's dates)
  if (/^\d{5}(\.\d+)?$/.test(s))
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5).toISOString().slice(0, 10);
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

/** A yes in a column of its own ("Federal Police": yes, sim, x, 1). */
const yes = (v: string) => /^(yes|y|sim|s|x|1|true|✓|✔)$/i.test(v.trim());
/** The note the template's example row carries: a row with it is left out if it was not deleted. */
export const EXAMPLE_NOTE = 'Example row: delete this row';

/** The export read into containers and the substances they are of. */
export function readInventory(text: string): ImportResult {
  return readInventoryRows(parseCsv(text));
}
/** The same, from rows already read (a spreadsheet, 0.54). */
export function readInventoryRows(all: string[][]): ImportResult {
  all = all.filter((r) => r.some((x) => (x ?? '').trim()));
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
    lines = body.filter(
      (r) =>
        r.length >= Math.max(2, head.length / 2) &&
        !(col.comment !== undefined && (r[col.comment] ?? '').trim() === EXAMPLE_NOTE),
    );
  const placeParts: ImportResult['placeParts'] = {};
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
    const area = g('place')
        .replace(/\u00a0/g, ' ')
        .replace(/^compartment\s+/i, '')
        .trim(),
      division = g('division');
    // a division in its own column: the place is shown as both, and read as they are
    const place = area && division ? `${area} - ${division}` : area;
    if (area && division) placeParts[place] = { area, shelf: division };
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
      s: g('s'),
      aka: g('aka')
        .split(/[;\n]/)
        .map((x) => x.trim())
        .filter(Boolean),
      f,
      smiles: g('smiles').trim(),
      M,
      d: num(g('d')),
      mp: num(g('mp')),
      bp: num(g('bp')),
      nD: num(g('nD')),
      ghs: g('ghs')
        .split(/[,;\s]+/)
        .map((x) => x.trim().toUpperCase())
        .filter((x) => /^GHS0\d$/.test(x)),
      pf: POLICE.test(everything) || yes(g('pfcol')),
      army: ARMY.test(comment) || yes(g('armycol')),
      amount: am.amount,
      size: sz?.amount ?? am.size,
      unit: unitOf(g('unit')) ?? am.unit ?? sz?.unit ?? 'g',
      supplier: g('supplier'),
      lot: g('lot'),
      purity: purityIn(g('purity') ? g('purity') + (g('purity').includes('%') ? '' : '%') : '') ?? purityIn(g('name')),
      expires: dateOf(g('expires')),
      opened: dateOf(g('opened')),
      place,
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
        s: r.s,
        aka: r.aka,
        f: r.f,
        smiles: r.smiles,
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
    s.s ||= r.s;
    s.aka = [...new Set([...s.aka, ...r.aka])];
    s.f ||= r.f;
    s.smiles ||= r.smiles;
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
    placeParts,
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

/**
 * The inventory spreadsheet template (0.54): one column per field the importer reads, each with what to write in it (the notes
 * sheet), and one example row the importer leaves out if it was not deleted. The import screen offers it as an Excel file.
 */
export const INVENTORY_TEMPLATE: { header: string; note: string; example: string | number }[] = [
  { header: 'Substance', note: 'Required. The name the lab uses for it.', example: 'Lead(II) iodide' },
  {
    header: 'Short name',
    note: 'Shown in recipes and lists in place of the full name. Common compounds get one from their CAS number.',
    example: 'PbI2',
  },
  {
    header: 'Other names',
    note: 'Other names search also finds, separated by ";".',
    example: 'Lead iodide; Iodeto de chumbo',
  },
  {
    header: 'CAS number',
    note: 'Containers with the same CAS number are one substance. Common compounds also get their short name and role from it.',
    example: '10101-63-0',
  },
  { header: 'Formula', note: 'Gives the molar mass (PbI2, CH3NH3I, CuSO4·5H2O).', example: 'PbI2' },
  {
    header: 'SMILES',
    note: 'The structure, drawn on the substance page. From ChemDraw: Edit › Copy As › SMILES. Common compounds get one from their CAS number.',
    example: '',
  },
  { header: 'Amount left', note: 'A number: what the container holds now. 0 for an empty one.', example: 4.5 },
  { header: 'Size', note: 'A number: what the container holds when full.', example: 5 },
  { header: 'Unit', note: 'g, mg, kg, mL, L or µL. For both amounts.', example: 'g' },
  { header: 'Purity (%)', note: 'A number, 99.99.', example: 99.99 },
  { header: 'Supplier', note: '', example: 'Example supplier' },
  { header: 'Lot', note: '', example: 'A1234' },
  {
    header: 'Storage place',
    note: 'A storage place that does not exist yet is made (Glovebox 1).',
    example: 'Glovebox 1',
  },
  { header: 'Division', note: 'A shelf or compartment of the storage place.', example: 'Shelf 2' },
  { header: 'Barcode', note: '', example: '' },
  { header: 'Opened', note: 'A date, dd/mm/yyyy.', example: '01/03/2026' },
  { header: 'Expires', note: 'A date, dd/mm/yyyy.', example: '01/03/2028' },
  { header: 'Federal Police', note: '"yes" when the Federal Police controls it.', example: 'no' },
  { header: 'Army', note: '"yes" when the Army controls it.', example: 'no' },
  { header: 'Notes', note: 'About this container.', example: EXAMPLE_NOTE },
];
