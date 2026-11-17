import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { readXlsx } from './xlsxRead';
import { EXAMPLE_NOTE, INVENTORY_TEMPLATE, readInventoryRows } from './inventoryCsv';

/** A small .xlsx as Excel writes it: shared strings, a number, a date as its day number, an empty cell skipped. */
function book(rows: (string | number)[][]) {
  const shared: string[] = [];
  const cell = (v: string | number, ref: string) => {
    if (v === '') return '';
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    let i = shared.indexOf(v);
    if (i < 0) i = shared.push(v) - 1;
    return `<c r="${ref}" t="s"><v>${i}</v></c>`;
  };
  const col = (i: number) => String.fromCharCode(65 + (i % 26)).padStart(i >= 26 ? 2 : 1, 'A');
  const data = rows
    .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, col(ci) + (ri + 1))).join('')}</row>`)
    .join('');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return zipSync({
    'xl/workbook.xml': strToU8(
      '<workbook xmlns:r="r"><sheets><sheet name="Inventory" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${data}</sheetData></worksheet>`),
    'xl/sharedStrings.xml': strToU8(`<sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`),
  });
}

describe('inventory template (0.54)', () => {
  it('reads cells, shared strings and gaps', () => {
    expect(readXlsx(book([['a', '', 3], ['x & y']]))).toEqual([
      ['a', '', '3'],
      ['x & y', '', ''],
    ]);
  });
  it('the importer reads the template exactly, and leaves the example row out', () => {
    const head = INVENTORY_TEMPLATE.map((c) => c.header);
    const row = (p: Record<string, string | number>) => head.map((h) => p[h] ?? '');
    const rows = readXlsx(
      book([
        head,
        INVENTORY_TEMPLATE.map((c) => c.example),
        row({
          Substance: 'Smoke chloride',
          'Short name': 'SC',
          'Other names': 'Cloreto de teste; Test chloride',
          'CAS number': '593-51-1',
          Formula: 'CH6ClN',
          'Amount left': 2.5,
          Size: 10,
          Unit: 'g',
          'Purity (%)': 99.5,
          Supplier: 'Acme',
          Lot: 'L-9',
          'Storage place': 'Cabinet 3 - North',
          Division: 'Top',
          Barcode: 'SMK-9',
          Opened: 46082, // 01/03/2026 as Excel stores a date
          Expires: '31/12/2027',
          'Federal Police': 'yes',
          Army: 'no',
          Notes: 'opened once',
        }),
      ]),
    );
    const r = readInventoryRows(rows);
    expect(r.skipped).toBe(1);
    expect(r.rows).toHaveLength(1);
    const x = r.rows[0];
    expect(x).toMatchObject({
      name: 'Smoke chloride',
      s: 'SC',
      aka: ['Cloreto de teste', 'Test chloride'],
      cas: '593-51-1',
      f: 'CH6ClN',
      amount: 2.5,
      size: 10,
      unit: 'g',
      purity: 99.5,
      supplier: 'Acme',
      lot: 'L-9',
      barcode: 'SMK-9',
      opened: '2026-03-01',
      expires: '2027-12-31',
      pf: true,
      army: false,
      notes: 'opened once',
    });
    // a storage place with " - " in its name stays whole when the division has its own column
    expect(r.placeParts[x.place]).toEqual({ area: 'Cabinet 3 - North', shelf: 'Top' });
    expect(r.substances[0]).toMatchObject({ s: 'SC', aka: ['Cloreto de teste', 'Test chloride'] });
    expect(INVENTORY_TEMPLATE.at(-1)?.example).toBe(EXAMPLE_NOTE);
  });
});
