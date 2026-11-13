import { describe, expect, it } from 'vitest';
import { nameOf, readInventory, splitPlace } from './inventoryCsv';

// Made-up rows in the layout of an OpenEnventory package export: a title line before the table, names in several languages,
// "left / size" amounts, non-breaking spaces, "compartment" places, HTML in comments. Not any lab's data.
const NB = ' ';
const head = [
  'structure',
  'name',
  'empirical formula',
  'CAS number',
  'purity/concentration',
  'haz. cod.',
  'Safety class',
  'MW',
  'amount',
  'barcode',
  'Lot no.',
  'storage',
  'Date opened',
  'Expiry date',
  'supplier',
  'Catalog no.',
  `density (20${NB}°C)`,
  'melting point',
  'boiling point',
  `refractive index (20${NB}°C)`,
  'comment on chemical',
  '',
];
const row = (o: Record<string, string>) => head.map((h) => JSON.stringify(o[h] ?? '')).join(',');
const csv = [
  head.map((h) => JSON.stringify(h)).join(','),
  'Example export title line',
  row({
    structure: '0_structure.mol',
    name: 'Lead(II) iodide; lead diiodide; Blei(II)-iodid (German)',
    'empirical formula': 'I2Pb',
    'CAS number': '10101-63-0',
    'purity/concentration': `99.99${NB}%`,
    'haz. cod.': 'GHS07,GHS08,GHS09',
    MW: '461.01',
    amount: `18${NB}g / 25${NB}g`,
    barcode: '9000001',
    'Lot no.': 'LOT-A',
    storage: `compartment${NB}B1-Glovebox Example`,
    supplier: 'Supplier One',
    'Catalog no.': 'X-100',
    [`density (20${NB}°C)`]: '6.16',
    'melting point': '402',
    'boiling point': '954',
  }),
  row({
    name: 'Bleiiodid zur Synthese, Example®; Lead(II) iodide',
    'empirical formula': 'I2Pb',
    'CAS number': '10101-63-0',
    amount: `100${NB}g`,
    storage: `compartment${NB}Cabinet 2`,
    supplier: 'Supplier Two',
    'Date opened': '2026-01-15',
  }),
  row({
    name: 'Example reagent ≥99,5% (trace metals basis)',
    'empirical formula': 'C2H6OS',
    'CAS number': '0067-68-5',
    amount: `0.4${NB}l / 1${NB}l`,
    storage: `compartment${NB}Cabinet 2`,
    [`refractive index (20${NB}°C)`]: '1.479',
    'comment on chemical':
      '<span style="font-size: 12px;">Produto Controlado pela Polícia Federal.</span><br><div>Keep dry</div>',
    'Expiry date': '20.06.2030',
  }),
].join('\n');

describe('reading an inventory export', () => {
  const r = readInventory(csv);
  it('finds the table under a title line and skips lines that are not containers', () => {
    expect(r.rows).toHaveLength(3);
    expect(r.skipped).toBe(1);
    expect(r.columns.lot).toBe('Lot no.');
    expect(r.columns.d).toBe('density (20 °C)');
  });
  it('makes one substance of the containers with the same CAS number', () => {
    expect(r.substances).toHaveLength(2);
    const pb = r.substances.find((s) => s.cas === '10101-63-0')!;
    expect(pb).toMatchObject({
      name: 'Lead(II) iodide',
      f: 'I2Pb',
      M: 461.01,
      d: 6.16,
      mp: 402,
      bp: 954,
      containers: 2,
    });
    expect(pb.ghs).toEqual(['GHS07', 'GHS08', 'GHS09']);
  });
  it('reads amounts as left and size, and units', () => {
    expect(r.rows[0]).toMatchObject({
      amount: 18,
      size: 25,
      unit: 'g',
      purity: 99.99,
      lot: 'LOT-A',
      barcode: '9000001',
    });
    expect(r.rows[1]).toMatchObject({
      amount: 100,
      size: 100,
      unit: 'g',
      opened: '2026-01-15',
      supplier: 'Supplier Two',
    });
    expect(r.rows[2]).toMatchObject({ amount: 0.4, size: 1, unit: 'L', expires: '2030-06-20' });
  });
  it('reads places without the "compartment" word, each once', () => {
    expect(r.places).toEqual(['B1-Glovebox Example', 'Cabinet 2']);
  });
  it('writes CAS numbers without leading zeros and works out a missing molar mass', () => {
    const s = r.substances.find((x) => x.cas === '67-68-5')!;
    expect(s.M).toBe(78.13);
    expect(s.nD).toBe(1.479);
  });
  it('turns the Federal Police note into its tick, keeps other comments as notes, without HTML', () => {
    expect(r.rows[2].pf).toBe(true);
    expect(r.rows[2].army).toBe(false);
    expect(r.rows[2].notes).toBe('Keep dry');
    expect(r.rows[0].notes).toBe('Catalogue no. X-100');
  });
  it('takes the purity from the name when there is no column for it', () => {
    expect(r.rows[2].purity).toBe(99.5);
  });
});

describe('one name from several', () => {
  it('skips catalogue and German entries and drops the purity', () => {
    expect(nameOf('Lead(II) iodide; lead diiodide; Blei(II)-iodid')).toBe('Lead(II) iodide');
    expect(nameOf('Nickelchlorid zur Synthese, Example®; Nickel(II) chloride')).toBe('Nickel(II) chloride');
    expect(nameOf('Potassium acetate (99 %)')).toBe('Potassium acetate');
    expect(nameOf('Zinn(II)bromid; tin dibromide')).toBe('tin dibromide');
    expect(nameOf('Kobaltfluorid')).toBe('Kobaltfluorid');
    expect(nameOf('Cesium iodide, 99.999% trace metals basis')).toBe('Cesium iodide');
  });
});

describe('splitPlace', () => {
  it('reads "storage - division"', () => {
    expect(splitPlace('Cabinet 2 - 07')).toEqual({ area: 'Cabinet 2', shelf: '07' });
    expect(splitPlace('Fridge - Door', ['fridge'])).toEqual({ area: 'fridge', shelf: 'Door' });
    expect(splitPlace('Fridge')).toEqual({ area: 'Fridge', shelf: '' });
    expect(splitPlace('Box - A', ['Box - A'])).toEqual({ area: 'Box - A', shelf: '' });
  });
});
