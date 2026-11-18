import {
  SPACERS,
  chemIn,
  toChems,
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
/**
 * `box`: the container it is taken from, when the batch recorded one (0.45). `run`: the amount is what the run data say was
 * weighed or dispensed, not what the recipe planned (0.45.1).
 */
export type ChemUse = { name: string; mg?: number; ul?: number; box?: number | null; run?: boolean };
/** The chemical table as recipes read it: names and roles (which solutes a mode offers), and the molar data. */
export type ChemCtx = { chems: { name: string; role: string; roles?: string[] }[]; cl: Chem[] };
/**
 * Uses under the inventory's names (0.55.4): a salt worked out as PbI2 is taken from "Lead(II) iodide" when that is the
 * substance the name means (short name, other name, formula), so its containers are found. Empty uses are dropped.
 */
const named = (out: ChemUse[], ctx: ChemCtx) =>
  out
    .filter((u) => u.name && ((u.mg ?? 0) > 0 || (u.ul ?? 0) > 0))
    .map((u) => ({ ...u, name: chemIn(ctx.cl, u.name)?.n ?? u.name }));

// ------------------------------------------------------------------ solutions
export type SolMode = 'Perovskite' | 'ETL' | 'HTL' | 'Custom';
/** 3D perovskite, or layered: Ruddlesden–Popper (monovalent spacer), Dion–Jacobson (divalent spacer), alternating cations in the interlayer (GA). */
export type SolDim = '3D' | 'RP' | 'DJ';
export const spacersFor = (dim: SolDim) => SPACERS.filter((x) => x.z === (dim === 'DJ' ? 2 : 1));
export const spacerOf = (d: { dim: SolDim; L: string }) =>
  spacersFor(d.dim).find((x) => x.ion === d.L) ?? spacersFor(d.dim)[0];
export const solComp = (d: {
  A: Record<string, number>;
  B?: Record<string, number>;
  X: Record<string, number>;
  dim: SolDim;
  L: string;
  n: number;
  s?: number;
}): Comp =>
  d.dim === '3D'
    ? { A: d.A, B: d.B, X: d.X }
    : {
        A: d.A,
        B: d.B,
        X: d.X,
        L: { ion: spacerOf(d).ion, z: d.dim === 'DJ' ? 2 : 1 },
        n: Math.max(1, d.n || 1),
        s: d.s,
      };
export const solutionDefaults = () => ({
  mode: 'Perovskite' as SolMode,
  // a new composition starts as FAPbI3 (0.57); recipes saved before keep what they had (an older one with no B-site is Pb)
  A: { FA: 1 } as Record<string, number>,
  B: { Pb: 1 } as Record<string, number>,
  X: { I: 1 } as Record<string, number>,
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
  /** a Custom solution used to clean substrates (0.58), such as the lab's own soap solution: substrate cleaning lists it */
  cln: false,
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
  return named(out, ctx);
}

/** A run-data value as a number, or null when it was left empty or is not one ("12,5" reads as 12.5). */
export const runNumber = (v: string | undefined): number | null => {
  if (v === undefined || !v.trim()) return null;
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
/**
 * What one solution really took, from its run data where they were entered (weighed masses, volumes added) and its planned
 * amounts elsewhere. The run-data keys are the solution's run fields: `w:<salt>`, `w:add:<additive>`, `v:<solvent>`.
 */
export function solutionRunUses(d: SolutionD, ctx: ChemCtx, values: Record<string, string>): ChemUse[] {
  const r = solutionPlanOf(d, ctx),
    out: ChemUse[] = [],
    got = (k: string) => runNumber(values[k]);
  const salts = r.stocks ? r.stocks.list : r.rows;
  for (const x of salts) {
    const w = got('w:' + x.s);
    out.push(w === null ? { name: x.s, mg: x.mg } : { name: x.s, mg: w, run: true });
  }
  for (const a of r.extra) {
    const w = got('w:add:' + a.n);
    if (a.b === 'µL stock/mL') {
      // the volume of its stock solution was measured: the additive scales with it
      out.push(
        w === null || !a.ul ? { name: a.n, mg: a.stockMg } : { name: a.n, mg: (a.stockMg * w) / a.ul, run: true },
      );
    } else if (a.ul) out.push(w === null ? { name: a.n, ul: a.ul } : { name: a.n, ul: w, run: true });
    else out.push(w === null ? { name: a.n, mg: a.m } : { name: a.n, mg: w, run: true });
  }
  // with stock solutions, the run data give the solvent added to make up the volume; the stocks' own solvent stays planned
  const stockUl = r.stocks ? r.stocks.list.reduce((t, x) => t + x.make * 1000, 0) : 0,
    sp = d.sv.reduce((t, x) => t + x.p, 0) || 1;
  for (const v of r.solv) {
    const w = got('v:' + v.n),
      inStocks = (stockUl * (d.sv.find((x) => x.n === v.n)?.p ?? 0)) / sp;
    out.push(w === null ? { name: v.n, ul: v.ul + inStocks } : { name: v.n, ul: w + inStocks, run: true });
  }
  return named(out, ctx);
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

/**
 * The solvents a spin program really dispensed: each dispense's volume (`dp:<n>`, n counting the dispenses that have a source)
 * and the substrates coated (`n`) from the run data where entered, else as planned.
 */
export function spinRunUses(d: SpinD, values: Record<string, string>): ChemUse[] {
  const n = runNumber(values.n),
    N = n ?? d.N,
    by = new Map<string, ChemUse>();
  d.dp
    .filter((x) => x.src)
    .forEach((x, i) => {
      if (!x.src.startsWith('Solvent: ')) return;
      const v = runNumber(values['dp:' + i]),
        name = x.src.slice(9),
        u = by.get(name) ?? { name, ul: 0, run: false };
      u.ul! += (v ?? x.v) * N * (1 + d.ov / 100);
      // from the run data when any of it was measured (a dispense's volume, or the substrates coated)
      u.run = u.run || v !== null || n !== null;
      by.set(name, u);
    });
  return [...by.values()].filter((u) => (u.ul ?? 0) > 0);
}

// ------------------------------------------------------------------ a batch
/** A batch's frozen stack, as far as consumption reads it. */
export type UseSnapshot = {
  stack: { sl: { m: string; a?: string; b?: string }[] };
  resolved: Record<number, { a?: { data: unknown } | null; b?: { data: unknown } | null } | undefined>;
  chems: {
    name: string;
    role: string;
    f: string;
    M: number;
    pur?: number;
    s?: string;
    aka?: string[];
    cas?: string;
    bottle?: { id: number } | null;
  }[];
};
/**
 * Reagents a batch took, from its frozen recipes: each solution prepared once (salts, additives, solvents) and the solvents
 * dispensed straight from the bottle in spin programs. Where the batch's run data for a recipe give what was really weighed or
 * dispensed (`runs`: by recipe id, the latest value given for each field), those amounts count; elsewhere the planned ones (0.45.1). A recipe from an
 * older version that no longer computes is left out.
 */
export function snapshotUses(s: UseSnapshot, runs: Record<string, Record<string, string>> = {}): ChemUse[] {
  const ctx: ChemCtx = {
      chems: s.chems,
      cl: toChems(s.chems),
    },
    out: ChemUse[] = [];
  s.stack.sl.forEach((sl, i) => {
    if (sl.m !== 'Spin') return; // the other layers' recipes (substrate preparation, evaporation) take nothing counted
    const r = s.resolved[i] ?? {};
    try {
      if (r.a) {
        const d = { ...solutionDefaults(), ...(r.a.data as object) },
          v = sl.a ? runs[sl.a] : undefined;
        out.push(...(v ? solutionRunUses(d, ctx, v) : solutionUses(d, ctx)));
      }
    } catch {
      /* older recipe */
    }
    try {
      if (r.b) {
        const d = { ...spinDefaults(), ...(r.b.data as object) },
          v = sl.b ? runs[sl.b] : undefined;
        out.push(...(v ? spinRunUses(d, v) : spinUses(d)));
      }
    } catch {
      /* older recipe */
    }
  });
  // each use names the container the batch was started with (0.44 snapshots record it)
  const box = new Map(s.chems.map((c) => [c.name.toLowerCase(), c.bottle?.id ?? null]));
  return out.map((u) => ({ ...u, box: box.get(u.name.trim().toLowerCase()) ?? null }));
}
