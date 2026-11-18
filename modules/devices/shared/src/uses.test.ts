import { describe, it, expect } from 'vitest';
import { SALTS } from './index';
import {
  snapshotUses,
  solutionDefaults,
  solutionRunUses,
  solutionUses,
  spinDefaults,
  spinRunUses,
  spinUses,
  type ChemCtx,
} from './uses';

const ctx: ChemCtx = {
  chems: SALTS.map((c) => ({ name: c.n, role: 'salt' })),
  cl: SALTS,
};
const fapbi3 = {
  ...solutionDefaults(),
  A: { FA: 1 },
  X: { I: 1 },
  M: 1,
  V: 1,
  sv: [
    { n: 'DMF', p: 4 },
    { n: 'DMSO', p: 1 },
  ],
};
const spin = {
  ...spinDefaults(),
  dp: [
    { src: 'Preset: Perovskite', v: 50, filter: false, when: 'before' as const, at: 0 },
    { src: 'Solvent: CB', v: 100, filter: false, when: 'remaining' as const, at: 10 },
  ],
  N: 10,
};

describe('amounts from run data (0.45.1)', () => {
  it('without run data, a solution takes what it plans', () => {
    expect(solutionRunUses(fapbi3, ctx, {})).toEqual(solutionUses(fapbi3, ctx));
    expect(spinRunUses(spin, {})).toEqual(spinUses(spin).map((u) => ({ ...u, run: false })));
  });
  it('what was weighed and added replaces the plan, value by value', () => {
    const u = solutionRunUses(fapbi3, ctx, { 'w:PbI2': '470,5', 'v:DMF': '790', 'w:FAI': '' });
    expect(u.find((x) => x.name === 'PbI2')).toEqual({ name: 'PbI2', mg: 470.5, run: true });
    expect(u.find((x) => x.name === 'DMF')).toEqual({ name: 'DMF', ul: 790, run: true });
    const fai = u.find((x) => x.name === 'FAI')!;
    expect(fai.run).toBeUndefined();
    expect(fai.mg).toBeCloseTo(solutionUses(fapbi3, ctx).find((x) => x.name === 'FAI')!.mg!, 6);
  });
  it('a spin program: the volumes dispensed and the substrates coated', () => {
    // dispense 1 is the solvent (the solution's dispense is counted in its own recipe)
    expect(spinRunUses(spin, { 'dp:1': '120', n: '8' })).toEqual([{ name: 'CB', ul: 960, run: true }]);
    expect(spinRunUses(spin, { n: '8' })).toEqual([{ name: 'CB', ul: 800, run: true }]);
  });
  it('a batch reads the run data of each of its recipes by id', () => {
    const snap = {
      stack: { sl: [{ m: 'Spin', a: '7', b: '9' }] },
      resolved: { 0: { a: { data: fapbi3 }, b: { data: spin } } },
      chems: SALTS.map((c) => ({ name: c.n, role: 'salt', f: c.f, M: c.M, bottle: c.n === 'PbI2' ? { id: 3 } : null })),
    };
    const planned = snapshotUses(snap),
      run = snapshotUses(snap, { '7': { 'w:PbI2': '470' }, '9': { n: '5' } });
    expect(planned.find((x) => x.name === 'PbI2')!.box).toBe(3);
    expect(run.find((x) => x.name === 'PbI2')).toMatchObject({ mg: 470, run: true, box: 3 });
    expect(run.find((x) => x.name === 'CB')).toMatchObject({ ul: 500, run: true });
  });
});

describe('worked-out names find the inventory’s substances (0.55.4)', () => {
  // the inventory names its substances in full; the composition works out PbI2 and FAI
  const inv: ChemCtx = {
    chems: [
      { name: 'Lead(II) iodide', role: 'salt' },
      { name: 'Formamidinium iodide', role: 'salt' },
    ],
    cl: [
      { n: 'Lead(II) iodide', f: 'I2Pb', M: 461.01, cas: '10101-63-0' },
      { n: 'Formamidinium iodide', f: 'CH5IN2', M: 171.97, s: 'FAI' },
    ],
  };
  it('the masses are those of the inventory’s substances, and the uses carry their names', () => {
    const u = solutionUses(fapbi3, inv);
    expect(u.find((x) => x.name === 'Lead(II) iodide')?.mg).toBeCloseTo(461.01, 1);
    expect(u.find((x) => x.name === 'Formamidinium iodide')?.mg).toBeCloseTo(171.97, 1);
    expect(u.some((x) => x.name === 'PbI2' || x.name === 'FAI')).toBe(false);
  });
  it('an additive of the same substance as a salt is weighed with it', () => {
    const d = { ...fapbi3, ad: [{ n: 'Lead(II) iodide', b: 'mol%' as const, v: 5 }] };
    const u = solutionUses(d, inv).filter((x) => x.name === 'Lead(II) iodide');
    expect(u).toHaveLength(1);
    expect(u[0].mg).toBeCloseTo(461.01 * 1.05, 1);
  });
});
