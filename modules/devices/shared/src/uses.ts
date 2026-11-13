import {
  SPACERS,
  solutionPlan,
  spinPlan,
  type Additive,
  type Chem,
  type Comp,
  type Dispense,
  type SpinStep,
} from './index';

/**
 * What a recipe takes from the inventory (0.42). The solution and spin-coating recipes compute here, so the app's recipe screens
 * and the server's consumption report (inventory) use one calculation.
 */
/** `box`: the container it is taken from, when the batch recorded one (0.45). */
export type ChemUse = { name: string; mg?: number; ul?: number; box?: number | null };
/** The chemical table as recipes read it: names and roles (which solutes a mode offers), and the molar data. */
export type ChemCtx = { chems: { name: string; role: string; roles?: string[] }[]; cl: Chem[] };

// ------------------------------------------------------------------ solutions
export type SolMode = 'Perovskite' | 'ETL' | 'HTL' | 'Custom';
/** 3D perovskite, or layered: Ruddlesden–Popper (monovalent spacer), Dion–Jacobson (divalent spacer), alternating cations in the interlayer (GA). */
export type SolDim = '3D' | 'RP' | 'DJ';
export const spacersFor = (dim: SolDim) => SPACERS.filter((x) => x.z === (dim === 'DJ' ? 2 : 1));
export const spacerOf = (d: { dim: SolDim; L: string }) =>
  spacersFor(d.dim).find((x) => x.ion === d.L) ?? spacersFor(d.dim)[0];
export const solComp = (d: {
  A: Record<string, number>;
  X: Record<string, number>;
  dim: SolDim;
  L: string;
  n: number;
  s?: number;
}): Comp =>
  d.dim === '3D'
    ? { A: d.A, X: d.X }
    : { A: d.A, X: d.X, L: { ion: spacerOf(d).ion, z: d.dim === 'DJ' ? 2 : 1 }, n: Math.max(1, d.n || 1), s: d.s };
export const solutionDefaults = () => ({
  mode: 'Perovskite' as SolMode,
  A: {} as Record<string, number>,
  X: {} as Record<string, number>,
  M: 0,
  V: 0,
  meth: 'solvent' as 'solvent' | 'density',
  rho: 0,
  dim: '3D' as SolDim,
  L: 'PEA',
  n: 2,
  s: undefined as number | undefined,
  prep: 'one' as 'one' | 'stocks',
  stocks: {} as Record<string, { c?: number; v?: number }>,
  sol: '',
  c: 0,
  u: 'mg/mL' as 'mg/mL' | 'mM',
  sv: [] as { n: string; p: number }[],
  ad: [] as Additive[],
  stir: false,
  sm: 0,
  heat: false,
  hT: 0,
  hm: 0,
  cool: false,
});
export type SolutionD = ReturnType<typeof solutionDefaults>;

export const solutesFor = (d: SolutionD, ctx: ChemCtx) => {
  // a substance may have several roles (0.44); a batch frozen before that has one
  const by = (...r: string[]) =>
    ctx.chems.filter((c) => (c.roles ?? [c.role]).some((x) => r.includes(x))).map((c) => c.name);
  return d.mode === 'ETL' ? by('etl', 'organic') : d.mode === 'HTL' ? by('htl') : ctx.chems.map((c) => c.name);
};
export const soluteOf = (d: SolutionD, ctx: ChemCtx) => {
  const l = solutesFor(d, ctx);
  return l.includes(d.sol) ? d.sol : d.sol || l[0] || '';
};
export const solutionPlanOf = (d: SolutionD, ctx: ChemCtx, act: Record<string, string> = {}) =>
  solutionPlan(
    {
      mode: d.mode,
      comp: solComp(d),
      M: d.M,
      V: d.V,
      sol: soluteOf(d, ctx),
      c: d.c,
      u: d.u,
      sv: d.sv,
      ad: d.ad,
      act,
      meth: d.meth,
      rho: d.rho,
      prep: d.prep,
      stocks: d.stocks,
    },
    ctx.cl,
  );

/** Planned amounts of one solution: salts (or the stock solutions as prepared), additives and solvents. */
export function solutionUses(d: SolutionD, ctx: ChemCtx): ChemUse[] {
  const r = solutionPlanOf(d, ctx),
    out: ChemUse[] = [];
  if (r.stocks) for (const x of r.stocks.list) out.push({ name: x.s, mg: x.mg });
  else for (const x of r.rows) out.push({ name: x.s, mg: x.mg });
  for (const a of r.extra)
    out.push(
      a.b === 'µL stock/mL' ? { name: a.n, mg: a.stockMg } : a.ul ? { name: a.n, ul: a.ul } : { name: a.n, mg: a.m },
    );
  const stockUl = r.stocks ? r.stocks.list.reduce((t, x) => t + x.make * 1000, 0) : 0,
    sp = d.sv.reduce((t, x) => t + x.p, 0) || 1;
  for (const v of r.solv) out.push({ name: v.n, ul: v.ul + (stockUl * (d.sv.find((x) => x.n === v.n)?.p ?? 0)) / sp });
  return out.filter((u) => u.name && ((u.mg ?? 0) > 0 || (u.ul ?? 0) > 0));
}

// ------------------------------------------------------------------ spin coating
// a new recipe starts empty: the lab enters its own program
export const spinDefaults = () => ({
  steps: [] as SpinStep[],
  dp: [] as Dispense[],
  an: false,
  aT: 0,
  aM: 0,
  ox: false,
  oa: '',
  oh: 0,
  N: 1,
  ov: 0,
});
export type SpinD = ReturnType<typeof spinDefaults>;
/** Solvents dispensed straight from the bottle (antisolvent, washing); solutions are counted in their own recipe. */
export const spinUses = (d: SpinD): ChemUse[] =>
  Object.entries(spinPlan(d.steps, d.dp, d.N, d.ov).vol)
    .filter(([k]) => k.startsWith('Solvent: '))
    .map(([k, mL]) => ({ name: k.slice(9), ul: mL * 1000 }));

// ------------------------------------------------------------------ a batch
/** A batch's frozen stack, as far as consumption reads it. */
export type UseSnapshot = {
  stack: { sl: { m: string }[] };
  resolved: Record<number, { a?: { data: unknown } | null; b?: { data: unknown } | null } | undefined>;
  chems: { name: string; role: string; f: string; M: number; pur?: number; bottle?: { id: number } | null }[];
};
/**
 * Reagents a batch took, from its frozen recipes: each solution prepared once (salts, additives, solvents) and the solvents
 * dispensed straight from the bottle in spin programs. Planned amounts, not weighed ones. A recipe from an older version that no
 * longer computes is left out.
 */
export function snapshotUses(s: UseSnapshot): ChemUse[] {
  const ctx: ChemCtx = {
      chems: s.chems,
      cl: s.chems.map((c) => ({ n: c.name, f: c.f, M: c.M, pur: c.pur })),
    },
    out: ChemUse[] = [];
  s.stack.sl.forEach((sl, i) => {
    if (sl.m !== 'Spin') return; // the other layers' recipes (substrate preparation, evaporation) take nothing counted
    const r = s.resolved[i] ?? {};
    try {
      if (r.a) out.push(...solutionUses({ ...solutionDefaults(), ...(r.a.data as object) }, ctx));
    } catch {
      /* older recipe */
    }
    try {
      if (r.b) out.push(...spinUses({ ...spinDefaults(), ...(r.b.data as object) }));
    } catch {
      /* older recipe */
    }
  });
  // each use names the container the batch was started with (0.44 snapshots record it)
  const box = new Map(s.chems.map((c) => [c.name.toLowerCase(), c.bottle?.id ?? null]));
  return out.map((u) => ({ ...u, box: box.get(u.name.trim().toLowerCase()) ?? null }));
}
