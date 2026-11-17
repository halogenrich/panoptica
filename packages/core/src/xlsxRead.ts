import { strFromU8, unzipSync } from 'fflate';

/**
 * Reading a spreadsheet (0.54: the inventory template comes back filled in as .xlsx): the first sheet's cells as text, row by
 * row, each row as long as the widest one. Numbers are kept as Excel writes them (a date is its day number; the importer reads
 * it). Throws when the file is not an .xlsx.
 */
export function readXlsx(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes, {
    filter: (f) => f.name === 'xl/workbook.xml' || f.name.endsWith('.rels') || f.name.startsWith('xl/'),
  });
  const text = (n: string) => (files[n] ? strFromU8(files[n]) : '');
  const wb = text('xl/workbook.xml');
  if (!wb) throw new Error('not an Excel file (.xlsx)');
  const first = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const rels = text('xl/_rels/workbook.xml.rels');
  const target = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => attr(r, 'Id') === first);
  const t = target ? attr(target, 'Target') : 'worksheets/sheet1.xml';
  const path = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
  const sheet = text(path) || text('xl/worksheets/sheet1.xml');
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runs(m[1]));
  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const at = +(attr(r[1] ?? r[3] ?? '', 'r') || rows.length + 1) - 1;
    const row: string[] = [];
    let next = 0;
    for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = c[1],
        ref = attr(a, 'r'),
        col = ref ? colIndex(ref) : next,
        type = attr(a, 't'),
        body = c[2] ?? '';
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
      row[col] =
        type === 's'
          ? (shared[+v] ?? '')
          : type === 'inlineStr'
            ? runs(body)
            : type === 'b'
              ? v === '1'
                ? 'TRUE'
                : 'FALSE'
              : unescape(v);
      next = col + 1;
    }
    rows[at] = row;
  }
  const width = Math.max(0, ...rows.map((r) => r?.length ?? 0));
  return Array.from(rows, (r) => Array.from({ length: width }, (_, i) => r?.[i] ?? ''));
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? '';
const unescape = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
/** The text of a cell: its runs joined, without phonetic hints. */
const runs = (xml: string) =>
  unescape(
    [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''),
  );
/** "C12" → 2 */
const colIndex = (ref: string) => {
  const l = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  let n = 0;
  for (const ch of l) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
