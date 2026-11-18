import { describe, expect, it } from 'vitest';
import { casValid, composition, molarMass } from './chem';
import { CHEM_REF, chemNamed, chemRef, duplicatePairs, fold, matchRank, search } from './substances';

const dmf = { label: 'N,N-Dimethylformamide', short: 'DMF', other: ['Dimetilformamida', 'C3H7NO', '68-12-2'] };

describe('search (0.54)', () => {
  it('folds case, accents and punctuation', () => {
    expect(fold('N,N-Dimetilformamida')).toBe('nndimetilformamida');
    expect(fold('Álcool isopropílico')).toBe('alcoolisopropilico');
  });
  it('finds by short name first, then by the start of the name or of a word', () => {
    expect(matchRank('DMF', dmf)).toBe(0);
    expect(matchRank('dm', dmf)).toBe(1);
    expect(matchRank('n,n-dim', dmf)).toBe(2);
    expect(matchRank('dimethyl', dmf)).toBe(3);
    expect(matchRank('formamide', dmf)).toBe(4);
    expect(matchRank('dimetilf', dmf)).toBe(5);
    expect(matchRank('68-12', dmf)).toBe(5);
  });
  it('finds near misses, and nothing for unrelated text', () => {
    expect(matchRank('nndimetilformamida', { label: 'N,N-Dimethylformamide' })).toBe(7);
    expect(matchRank('toluene', dmf)).toBeNull();
  });
  it('ranks a list, keeping the given order on ties', () => {
    const list = [
      { label: 'Methylammonium chloride', short: 'MACl' },
      { label: 'Methylammonium iodide', short: 'MAI' },
      { label: 'Formamidinium iodide', short: 'FAI' },
    ];
    expect(search('MA', list, (x) => x).map((x) => x.short)).toEqual(['MACl', 'MAI', 'FAI']);
    expect(search('iodide', list, (x) => x).map((x) => x.short)).toEqual(['MAI', 'FAI']);
    expect(search('', list, (x) => x)).toHaveLength(3);
  });
});

describe('reference list (0.54)', () => {
  it('has valid, unique CAS numbers and known roles', () => {
    const roles = new Set(['salt', 'solvent', 'etl', 'htl', 'additive', 'organic', 'metal', 'other']);
    for (const r of CHEM_REF) {
      expect(casValid(r.cas), r.cas).toBe(true);
      for (const x of r.roles) expect(roles.has(x), x).toBe(true);
    }
    expect(new Set(CHEM_REF.map((r) => r.cas)).size).toBe(CHEM_REF.length);
    expect(chemRef('0068-12-2')?.s).toBe('DMF');
    expect(chemRef('64-17-5')?.roles).toEqual(['solvent']);
  });
});

describe('possible duplicates (0.54)', () => {
  const c = (id: number, name: string, cas = '', f = '', s = '', aka: string[] = []) => ({ id, name, cas, f, s, aka });
  it('pairs the same CAS, a name that is the other one’s short or other name, and the same atoms', () => {
    expect(
      duplicatePairs([
        c(1, 'MACl'),
        c(2, 'Methylammonium chloride', '593-51-1', 'CH6ClN', 'MACl'),
        c(3, 'PbI2', '10101-63-0'),
        c(4, 'Lead(II) iodide', '10101-63-0'),
        c(5, 'Methylamine HCl', '', 'CH3NH3Cl'),
      ]),
    ).toEqual([
      { a: 1, b: 2, why: 'name' },
      { a: 2, b: 5, why: 'formula' },
      { a: 3, b: 4, why: 'cas' },
    ]);
  });
  it('keeps apart two CAS numbers that disagree', () => {
    expect(duplicatePairs([c(1, 'A', '68-12-2', 'C3H7NO'), c(2, 'B', '67-68-5', 'C3H7NO')])).toEqual([]);
  });
  it('reads the atoms of a formula as molar mass does', () => {
    expect(composition('CH3NH3PbI3')).toEqual({ C: 1, H: 6, N: 1, Pb: 1, I: 3 });
    expect(molarMass('CuSO4·5H2O')).toBe(249.68);
  });
});

describe('the substance a name means (0.55.4)', () => {
  const inv = [
    { name: 'Lead(II) iodide', s: '', aka: [], f: 'I2Pb', cas: '10101-63-0' },
    { name: 'Methylammonium iodide', s: 'MAI', aka: [], f: 'CH6IN', cas: '' },
    { name: 'Formamidinium iodide', s: '', aka: ['FAI'], f: 'CH5IN2', cas: '' },
    { name: 'Caesium iodide', s: '', aka: [], f: 'CsI', cas: '' },
    { name: 'Chlorobenzene', s: 'CB', aka: [], f: 'C6H5Cl', cas: '108-90-7' },
  ];
  const n = (q: string) => chemNamed(inv, q, (x) => x)?.name;
  it('finds by name, short name, other name, formula and atoms', () => {
    expect(n('Chlorobenzene')).toBe('Chlorobenzene');
    expect(n('chlorobenzene')).toBe('Chlorobenzene');
    expect(n('MAI')).toBe('Methylammonium iodide');
    expect(n('FAI')).toBe('Formamidinium iodide');
    expect(n('CsI')).toBe('Caesium iodide');
    expect(n('108-90-7')).toBe('Chlorobenzene');
  });
  it('a reference short name finds the substance by its CAS number', () => {
    expect(n('PbI2')).toBe('Lead(II) iodide');
  });
  it('the same atoms count only when one substance has them', () => {
    const two = [
      { name: 'A', f: 'PbI2' },
      { name: 'B', f: 'I2Pb' },
    ];
    expect(chemNamed(two, 'PbI2', (x) => x)?.name).toBe('A'); // the formula as written first
    expect(chemNamed(two, 'IPbI', (x) => x)).toBeUndefined();
  });
  it('a name nothing has finds nothing', () => {
    expect(n('MABr')).toBeUndefined();
    expect(n('')).toBeUndefined();
  });
});
