import { describe, it, expect } from 'vitest';
import { solutionPlan, plan, formula, layered, nFromAmounts, SALTS, type Chem } from './index';

describe('solutionPlan', () => {
  it('bundles a PbI2 additive into the base PbI2 mass', () => {
    const r = solutionPlan({ mode: 'Perovskite', comp: { A: { FA: 1 }, X: { I: 1 } }, M: 1, V: 1, sol: '', c: 0, u: 'mg/mL',
      sv: [{ n: 'DMF', p: 4 }, { n: 'DMSO', p: 1 }], ad: [{ n: 'PbI2', b: 'mol%', v: 3 }], act: {} }, SALTS);
    expect(r.rows.find((x) => x.s === 'PbI2')!.mg).toBeCloseTo(461.01 * 1.03, 2);
    expect(r.solv[0].ul).toBeCloseTo(800, 6);
    expect(r.target).toBe('FAPbI3');
  });
  it('density method: solvent = final volume minus the volume of the solids', () => {
    const base = { mode: 'Perovskite' as const, comp: { A: { MA: 1 }, X: { I: 1 } }, M: 1, V: 1, sol: '', c: 0, u: 'mg/mL' as const, sv: [{ n: 'DMF', p: 1 }], ad: [], act: {} };
    const r = solutionPlan({ ...base, meth: 'density', rho: 4.16 }, SALTS);
    const mass = 461.01 + 158.97; // mg of PbI2 + MAI for 1 mmol
    expect(r.density!.solidUl).toBeCloseTo(mass / 4.16, 6);
    expect(r.solv[0].ul).toBeCloseTo(1000 - mass / 4.16, 6);
    expect(r.rows.find((x) => x.s === 'PbI2')!.mg).toBeCloseTo(461.01, 6); // same masses as the solvent method
    expect(solutionPlan(base, SALTS).solv[0].ul).toBeCloseTo(1000, 6);
  });
  it('separate stock solutions: default stocks at M × total salt per Pb add up to V; masses and volumes', () => {
    const base = { mode: 'Perovskite' as const, comp: { A: { FA: 1 }, X: { I: 1 } }, M: 1, V: 1, sol: '', c: 0, u: 'mg/mL' as const, sv: [{ n: 'DMF', p: 1 }], ad: [], act: {}, prep: 'stocks' as const };
    const r = solutionPlan(base, SALTS), st = r.stocks!;
    expect(st.list.map((x) => x.c)).toEqual([2, 2]);           // 2 mol salt per mol Pb
    expect(st.list.every((x) => Math.abs(x.need - 500) < 1e-9)).toBe(true);
    expect(st.topUp).toBeCloseTo(0, 9);
    const pb = st.list.find((x) => x.s === 'PbI2')!;
    expect(pb.mg).toBeCloseTo(2 * 0.5 * 461.01, 6);              // 2 M × 0.5 mL
    const r2 = solutionPlan({ ...base, stocks: { PbI2: { c: 1.5, v: 1 }, FAI: { c: 4 } } }, SALTS).stocks!;
    expect(r2.list.find((x) => x.s === 'PbI2')!.need).toBeCloseTo(666.667, 2);
    expect(r2.list.find((x) => x.s === 'PbI2')!.mg).toBeCloseTo(1.5 * 461.01, 6);
    expect(r2.topUp).toBeCloseTo(1000 - 666.667 - 250, 2);
    expect(solutionPlan({ ...base, stocks: { PbI2: { c: 0.5 } } }, SALTS).stocks!.over).toBe(true);
  });
});

describe('layered (2D) perovskites', () => {
  const chems: Chem[] = [...SALTS, { n: 'BAI', f: 'C4H12IN', M: 201.05 }, { n: 'PEAI', f: 'C8H12IN', M: 249.09 }, { n: 'PDAI2', f: 'C3H12I2N2', M: 329.95 }];
  it('Ruddlesden-Popper (BA)2(MA)n-1PbnI3n+1: BAI : MAI : PbI2 = 2 : n-1 : n', () => {
    const p = plan({ A: { MA: 1 }, X: { I: 1 }, L: { ion: 'BA', z: 1 }, n: 4 });
    expect(p.PbI2).toBeCloseTo(1, 9); expect(p.MAI).toBeCloseTo(3 / 4, 9); expect(p.BAI).toBeCloseTo(2 / 4, 9);
    expect(formula(p, chems)).toBe('(BA)2(MA)3Pb4I13');
    expect(layered({ A: { MA: 1 }, X: { I: 1 }, L: { ion: 'PEA', z: 1 }, n: 1 })).toBe('(PEA)2PbI4');
  });
  it('Dion-Jacobson (PDA)(MA)n-1PbnI3n+1: PDAI2 : MAI : PbI2 = 1 : n-1 : n, mixed A-site', () => {
    const p = plan({ A: { Cs: 0.05, FA: 0.95 }, X: { I: 1 }, L: { ion: 'PDA', z: 2 }, n: 5 });
    expect(p.PDAI2).toBeCloseTo(1 / 5, 9); expect(p.FAI).toBeCloseTo(0.95 * 4 / 5, 9); expect(p.CsI).toBeCloseTo(0.05 * 4 / 5, 9);
    expect(formula(p, chems)).toBe('(PDA)(Cs0.05FA0.95)4Pb5I16');
  });
  it('2D solution: masses per mL from the Pb molarity, ion table includes the spacer', () => {
    const r = solutionPlan({ mode: 'Perovskite', comp: { A: { MA: 1 }, X: { I: 1 }, L: { ion: 'PEA', z: 1 }, n: 1 }, M: 0.5, V: 1, sol: '', c: 0, u: 'mg/mL', sv: [{ n: 'DMF', p: 1 }], ad: [], act: {} }, chems);
    expect(r.rows.find((x) => x.s === 'PEAI')!.mg).toBeCloseTo(2 * 0.5 * 249.09, 6);
    expect(r.rows.find((x) => x.s === 'MAI')).toBeUndefined();
    expect(r.target).toBe('(PEA)2PbI4');
    expect(r.ct.find((c) => c.ion === 'PEA')!.total).toBeCloseTo(2, 9);
    expect(r.ct.find((c) => c.ion === 'I')!.total).toBeCloseTo(4, 9);
  });
  it('new spacers parse from their salt names', () => {
    const p = plan({ A: { MA: 1 }, X: { I: 1 }, L: { ion: 'BzA', z: 1 }, n: 2 });
    expect(p.BzAI).toBeCloseTo(1, 9);
    expect(formula(p, [...chems, { n: 'BzAI', f: 'C7H10IN', M: 235.07 }])).toBe('(BzA)2(MA)Pb2I7');
  });
  it('spacer and A-cation amounts as written: the ratio sets n, the formula keeps the typed numbers', () => {
    const L = { ion: 'BA', z: 1 as const };
    expect(nFromAmounts(L, 2, 3)).toBeCloseTo(4, 9);           // BA2MA3 -> n = 4
    expect(nFromAmounts(L, 0.4, 0.6)).toBeCloseTo(4, 9);       // same ratio as fractions
    expect(nFromAmounts({ ion: 'PDA', z: 2 }, 1, 2)).toBeCloseTo(3, 9);
    expect(layered({ A: { MA: 1 }, X: { I: 1 }, L, n: 4, s: 0.4 })).toBe('(BA)0.4(MA)0.6Pb0.8I2.6');
    // salt amounts per Pb do not depend on how the formula is written
    expect(plan({ A: { MA: 1 }, X: { I: 1 }, L, n: 4, s: 0.4 })).toEqual(plan({ A: { MA: 1 }, X: { I: 1 }, L, n: 4 }));
  });
});
