import { describe, expect, it } from 'vitest';
import { Molecule } from 'openchemlib';
import { CHEM_REF } from './substances';
import { composition } from './chem';

// What each reference SMILES must hold (0.57), checked by hand against the compounds' formulas.
// prettier-ignore
const EXPECT: Record<string, string> = {
  DMF: 'C3H7NO', DMSO: 'C2H6OS', CB: 'C6H5Cl', DCB: 'C6H4Cl2', IPA: 'C3H8O', EtOH: 'C2H6O', MeOH: 'CH4O', 'n-BuOH': 'C4H10O',
  Acetone: 'C3H6O', Toluene: 'C7H8', Anisole: 'C7H8O', EtOAc: 'C4H8O2', MeOAc: 'C3H6O2', Et2O: 'C4H10O', CHCl3: 'CHCl3',
  DCM: 'CH2Cl2', NMP: 'C5H9NO', DMAc: 'C4H9NO', GBL: 'C4H6O2', '2-ME': 'C3H8O2', ACN: 'C2H3N', THF: 'C4H8O', Hexane: 'C6H14',
  Cyclohexane: 'C6H12', Mesitylene: 'C9H12', MAI: 'CH6NI', MABr: 'CH6NBr', MACl: 'CH6NCl', FAI: 'CH5N2I', FABr: 'CH5N2Br',
  FACl: 'CH5N2Cl', FAAc: 'C3H8N2O2', GACl: 'CH6N3Cl', GAI: 'CH6N3I', GASCN: 'C2H6N4S', PEAI: 'C8H12NI', BAI: 'C4H12NI',
  tBP: 'C9H13N', 'Li-TFSI': 'C2F6LiNO4S2', 'Spiro-OMeTAD': 'C81H68N4O8', '2PACz': 'C14H14NO3P', 'MeO-2PACz': 'C16H18NO5P',
  'Me-4PACz': 'C18H22NO3P', 'MeO-4PACz': 'C18H22NO5P', 'Me-2PACz': 'C16H18NO3P', BCP: 'C26H20N2',
};

describe('reference SMILES (0.57)', () => {
  it('every one reads and holds the atoms of its compound', () => {
    const withSmiles = CHEM_REF.filter((r) => r.smiles);
    expect(withSmiles.map((r) => r.s).sort()).toEqual(Object.keys(EXPECT).sort());
    for (const r of withSmiles) {
      const m = Molecule.fromSmiles(r.smiles!);
      expect(composition(m.getMolecularFormula().formula), r.s).toEqual(composition(EXPECT[r.s]));
    }
  });
  it('none for salts of metals, oxides, metals, polymers and fullerenes', () => {
    for (const s of ['PbI2', 'SnO2', 'Ag', 'PTAA', 'PEDOT:PSS', 'C60', 'PCBM', 'NiO'])
      expect(CHEM_REF.find((r) => r.s === s)?.smiles, s).toBeUndefined();
  });
});
