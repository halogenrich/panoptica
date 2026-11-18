import { describe, expect, it } from 'vitest';
import { casValid, molarMass, normCas, isFormula } from './chem';

describe('substances', () => {
  it('works out molar mass from a formula', () => {
    expect(molarMass('PbI2')).toBe(461.01);
    expect(molarMass('I2Pb')).toBe(461.01);
    expect(molarMass('CH3NH3PbI3')).toBe(619.98);
    expect(molarMass('(CH3)2SO')).toBe(78.13);
    expect(molarMass('CuSO4·5H2O')).toBe(249.68);
    expect(molarMass('C8H19N')).toBe(129.25);
    expect(molarMass('Cl2Sr.6.0H2O')).toBe(266.61);
    expect(molarMass('CoO4S.7H2O')).toBe(281.09);
  });
  it('gives no molar mass rather than a wrong one', () => {
    expect(molarMass('H2Cl6Pt.nH2O')).toBeNull();
    expect(molarMass('[I-].[I-].[Pb++]')).toBeNull();
    expect(molarMass('Xx2')).toBeNull();
    expect(molarMass('')).toBeNull();
  });
  it('writes CAS numbers one way and checks them', () => {
    expect(normCas(' 0127-08-2 ')).toBe('127-08-2');
    expect(normCas('10101-63-0')).toBe('10101-63-0');
    expect(casValid('10101-63-0')).toBe(true); // lead(II) iodide
    expect(casValid('67-68-5')).toBe(true); // dimethyl sulfoxide
    expect(casValid('67-68-6')).toBe(false);
  });
});

describe('isFormula (0.57): only names that read whole as a formula get subscripts', () => {
  it('formulas', () => {
    for (const f of ['PbI2', 'SnO2', 'C60', 'FAPbI3', 'Cs0.05FA0.95PbI3', '(PEA)2PbI4', 'MoO3', 'Pb(SCN)2', 'C70'])
      expect(isFormula(f), f).toBe(true);
  });
  it('names with numbers that are not formulas stay as written', () => {
    for (const f of [
      '2PACz',
      'MeO-2PACz',
      'PC71BM',
      'PC61BM',
      'FK209',
      'Me-4PACz',
      'Spiro-OMeTAD',
      'Li-TFSI',
      'PbI2 99.99 %',
    ])
      expect(isFormula(f), f).toBe(false);
    for (const f of ['DMF', 'PEAI', 'BCP', '', 'C600', 'Pb(I2', 'Pb)I2(']) expect(isFormula(f), f).toBe(false);
  });
});
