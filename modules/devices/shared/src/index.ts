// Pure domain logic: no I/O, no framework. Ported from the HTML prototype.
import { chemNamed } from '@psc/core';

/**
 * A substance as the calculations read it. `s` (short name), `aka` (other names) and `cas` let a worked-out name such as PbI2
 * find "Lead(II) iodide" in the inventory (0.55.4).
 */
export type Chem = { n: string; f: string; M: number; pur?: number; s?: string; aka?: string[]; cas?: string };
/** The substance a name means in a list of `Chem`s (0.55.4): see `chemNamed`. */
export const chemIn = (chems: Chem[], name: string) =>
  chemNamed(chems, name, (c) => ({ name: c.n, s: c.s, aka: c.aka, f: c.f, cas: c.cas }));
/** The calculations' list from substances as the app and the snapshots hold them. */
export const toChems = (
  list: { name: string; f?: string; M?: number; pur?: number; s?: string; aka?: string[]; cas?: string }[],
): Chem[] => list.map((c) => ({ n: c.name, f: c.f ?? '', M: c.M ?? 0, pur: c.pur, s: c.s, aka: c.aka, cas: c.cas }));
/**
 * Perovskite composition: A-site and X-site fractions. With `L` (a bulky spacer cation) and `n`, a layered (2D / quasi-2D) perovskite:
 * Ruddlesden–Popper (monovalent spacer, z = 1) L2A(n−1)PbnX(3n+1), Dion–Jacobson (divalent spacer, z = 2) LA(n−1)PbnX(3n+1).
 * Per Pb: spacer 2/n (RP) or 1/n (DJ); A-site (n−1)/n; halide (3n+1)/n. n may be non-integer (quasi-2D, nominal ⟨n⟩).
 * General form after Ossila, "What are 2D perovskites": RA(n−1)BnX(3n+1); n = 1 is 2D, n < 5 quasi-2D, n > 5 often quasi-3D, n → ∞ 3D.
 */
export type Comp = {
  A: Record<string, number>;
  /** B-site metals with their fractions (0.57): Pb, Sn, Ge. Absent or empty = Pb, as every composition before 0.57. */
  B?: Record<string, number>;
  X: Record<string, number>;
  L?: { ion: string; z: 1 | 2 };
  n?: number;
  s?: number;
};

/**
 * A layered formula written with `s` spacer cations instead of the usual 2 (RP) or 1 (DJ): the same compound scaled by
 * k = s / s₀, so the spacer : A-cation : Pb ratio (and n) is unchanged. Returns the amounts as written: spacer, A-site, Pb, halide.
 */
export function layeredAmounts(c: Comp) {
  const n = c.n!,
    s0 = c.L!.z === 1 ? 2 : 1,
    s = c.s && c.s > 0 ? c.s : s0,
    k = s / s0;
  return { s, s0, k, a: k * (n - 1), pb: k * n, x: k * (3 * n + 1) };
}
/** n from the amounts as written (spacer s, A-site a): RP n = 1 + 2a/s, DJ n = 1 + a/s. */
export function nFromAmounts(L: NonNullable<Comp['L']>, s: number, a: number) {
  const k = s / (L.z === 1 ? 2 : 1);
  return 1 + a / k;
}

/** Spacer cations the formula reader knows: monovalent (Ruddlesden–Popper) and divalent (Dion–Jacobson). */
export const SPACERS: { ion: string; z: 1 | 2; name: string }[] = [
  { ion: 'PEA', z: 1, name: 'phenethylammonium' },
  { ion: 'BA', z: 1, name: 'n-butylammonium' },
  { ion: 'OA', z: 1, name: 'n-octylammonium' },
  { ion: 'BzA', z: 1, name: 'benzylammonium' },
  { ion: 'EA', z: 1, name: 'ethylammonium' },
  { ion: 'DMA', z: 1, name: 'dimethylammonium' },
  { ion: 'ThMA', z: 1, name: '2-thiophenemethylammonium' },
  { ion: 'PDA', z: 2, name: '1,3-propanediammonium' },
  { ion: 'BDA', z: 2, name: '1,4-butanediammonium' },
  { ion: 'EDA', z: 2, name: 'ethylenediammonium' },
  { ion: '3AMP', z: 2, name: '3-(aminomethyl)piperidinium' },
  { ion: '4AMP', z: 2, name: '4-(aminomethyl)piperidinium' },
];
const ION_RE = /(PEA|BzA|ThMA|DMA|PDA|BDA|EDA|3AMP|4AMP|BA|OA|EA|Cs|FA|MA|Pb|Sn|Ge|Br|Cl|I)(\d*)/g;
/** B-site metals (0.57). Bi is left out: Bi³⁺ does not fit ABX₃. */
export const B_IONS = ['Pb', 'Sn', 'Ge'];
/** The B-site of a composition: Pb when none is chosen (compositions saved before 0.57). */
export const bSite = (c: { B?: Record<string, number> }): Record<string, number> => {
  const on = Object.entries(c.B ?? {}).filter(([k]) => B_IONS.includes(k));
  return on.length ? Object.fromEntries(on) : { Pb: 1 };
};
/** What the molarity counts: "Pb", "Sn"… or "B-site" when it is mixed (0.57). */
export const bLabel = (c: { B?: Record<string, number> }) => {
  const k = Object.keys(bSite(c));
  return k.length === 1 ? k[0] : 'B-site';
};
export const is2D = (c: Comp) => !!(c.L?.ion && c.n && Number.isFinite(c.n) && c.n >= 1);
export type Rect = [number, number, number, number]; // x, y, w, h in mm

export const SALTS: Chem[] = [
  { n: 'PbI2', f: 'PbI2', M: 461.01 },
  { n: 'PbBr2', f: 'PbBr2', M: 367.01 },
  { n: 'PbCl2', f: 'PbCl2', M: 278.1 },
  { n: 'SnI2', f: 'SnI2', M: 372.52 },
  { n: 'SnBr2', f: 'SnBr2', M: 278.52 },
  { n: 'SnCl2', f: 'SnCl2', M: 189.62 },
  { n: 'GeI2', f: 'GeI2', M: 326.44 },
  { n: 'GeBr2', f: 'GeBr2', M: 232.45 },
  { n: 'GeCl2', f: 'GeCl2', M: 143.55 },
  { n: 'CsI', f: 'CsI', M: 259.81 },
  { n: 'CsBr', f: 'CsBr', M: 212.81 },
  { n: 'FAI', f: 'FAI', M: 171.97 },
  { n: 'FABr', f: 'FABr', M: 124.97 },
  { n: 'MAI', f: 'MAI', M: 158.97 },
  { n: 'MABr', f: 'MABr', M: 111.97 },
  { n: 'MACl', f: 'MACl', M: 67.52 },
];

const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

/** Ion counts of a salt formula, e.g. "PbI2" -> { Pb: 1, I: 2 } */
export function ions(f: string): Record<string, number> {
  const o: Record<string, number> = {};
  for (const m of f.matchAll(ION_RE)) o[m[1]] = (o[m[1]] || 0) + (+m[2] || 1);
  return o;
}
/** Ions of a salt: from its name when the name is a plain ion formula (PEAI, PDAI2, CsBr…), else from its chemical formula. */
export function saltIons(name: string, chems: Chem[] = SALTS): Record<string, number> {
  if (name.replace(ION_RE, '') === '') return ions(name);
  return ions(chemIn(chems, name)?.f ?? name);
}

/**
 * Salt amounts (mol per mol B-site metal) for a composition. Halides go to the BX2 salts first (Br, Cl, then I), each halide
 * shared among the B-site metals by their fractions (0.57: Pb, Sn, Ge; before, Pb only); A-site salts take the rest.
 */
export function plan(c: Comp): Record<string, number> {
  const sa = total(c.A) || 1,
    sx = total(c.X) || 1,
    two = is2D(c),
    n = two ? c.n! : Infinity;
  const xTot = two ? (3 * n + 1) / n : 3,
    aTot = two ? (n - 1) / n : 1;
  const h: Record<string, number> = {},
    out: Record<string, number> = {};
  for (const k in c.X) h[k] = (xTot * c.X[k]) / sx;
  const bs = bSite(c),
    sb = total(bs) || 1;
  let free = 1;
  const pool: Record<string, number> = {};
  for (const k of ['Br', 'Cl', 'I']) {
    const m = Math.min((h[k] || 0) / 2, free);
    if (m > 1e-12) {
      pool[k] = m;
      h[k] -= 2 * m;
      free -= m;
    }
  }
  for (const b of B_IONS)
    if ((bs[b] || 0) > 0)
      for (const k in pool) {
        const m = (pool[k] * bs[b]) / sb;
        if (m > 1e-12) out[b + k + '2'] = m;
      }
  if (two) {
    // spacer salt: LX (2/n per Pb, RP) or LX2 (1/n per Pb, DJ), iodide first
    const { ion, z } = c.L!;
    let need = 2 / n; // halide the spacer carries per Pb, either way
    for (const x of ['I', 'Br', 'Cl']) {
      const m = Math.min(need, h[x] || 0);
      if (m > 1e-12) {
        const salt = ion + x + (z === 2 ? '2' : '');
        out[salt] = (out[salt] || 0) + m / z;
        h[x] -= m;
        need -= m;
      }
    }
  }
  const pri: Record<string, string[]> = { MA: ['Cl', 'Br', 'I'], FA: ['I', 'Br', 'Cl'], Cs: ['I', 'Br', 'Cl'] };
  for (const k of ['MA', 'FA', 'Cs']) {
    let n = ((c.A[k] || 0) / sa) * aTot;
    for (const x of pri[k]) {
      const m = Math.min(n, h[x] || 0);
      if (m > 1e-12) {
        out[k + x] = (out[k + x] || 0) + m;
        h[x] -= m;
        n -= m;
      }
    }
  }
  return out;
}

export interface Row {
  salt: string;
  mol: number;
  mmol: number;
  mg: number;
  known: boolean;
}

/** Masses to weigh for `volumeMl` of solution at `molarity` (mol B-site metal / L). Purity-corrected. */
export function solution(c: Comp, chems: Chem[], molarity: number, volumeMl: number): Row[] {
  const nPb = molarity * volumeMl; // mmol
  return Object.entries(plan(c)).map(([salt, mol]) => {
    const ch = chemIn(chems, salt);
    const mmol = mol * nPb;
    return { salt, mol, mmol, mg: (mmol * (ch?.M ?? 0)) / ((ch?.pur ?? 100) / 100), known: !!ch };
  });
}

/** Formula from salt amounts (any unit), e.g. FA0.85Cs0.15Pb(I)3 */
export function formula(n: Record<string, number>, chems: Chem[] = SALTS): string {
  const t: Record<string, number> = {};
  for (const s in n) {
    const io = saltIons(s, chems);
    for (const k in io) t[k] = (t[k] || 0) + io[k] * n[s];
  }
  const A = ['Cs', 'FA', 'MA'],
    X = ['I', 'Br', 'Cl'],
    tb = B_IONS.reduce((s, k) => s + (t[k] || 0), 0),
    B = Object.fromEntries(B_IONS.filter((k) => (t[k] || 0) > 1e-9).map((k) => [k, t[k]]));
  const sp = SPACERS.find((x) => (t[x.ion] || 0) > 1e-9);
  if (sp && tb > 1e-9) {
    // layered: n from the spacer per B-site metal
    const per = (k: string) => (t[k] || 0) / tb,
      nn = sp.z === 1 ? 2 / per(sp.ion) : 1 / per(sp.ion);
    return layered({
      A: Object.fromEntries(A.map((k) => [k, t[k] || 0])),
      B,
      X: Object.fromEntries(X.map((k) => [k, t[k] || 0])),
      L: sp,
      n: nn,
    });
  }
  const sa = A.reduce((s, k) => s + (t[k] || 0), 0) || 1,
    sx = X.reduce((s, k) => s + (t[k] || 0), 0) || 1;
  const f = (k: string, v: number) => k + (Math.abs(v - 1) < 0.005 ? '' : +v.toFixed(2));
  const xs = X.filter((k) => t[k] > 1e-9),
    bk = Object.keys(B),
    b = bk.length > 1 ? '(' + bk.map((k) => f(k, t[k] / tb)).join('') + ')' : (bk[0] ?? 'Pb');
  return (
    A.filter((k) => t[k] > 1e-9)
      .map((k) => f(k, t[k] / sa))
      .join('') + (xs.length === 1 ? b + xs[0] + '3' : b + '(' + xs.map((k) => f(k, t[k] / sx)).join('') + ')3')
  );
}

/** Formula of a layered perovskite, e.g. (PEA)2PbI4, (BA)2(MA)2Pb3I10, (PDA)(Cs0.05FA0.95)4Pb5I16, (PEA)2(FA)(Pb0.5Sn0.5)2I7. */
export function layered(c: Comp): string {
  const r = (v: number) => +v.toFixed(2),
    cnt = (v: number) => (Math.abs(v - 1) < 0.005 ? '' : String(r(v)));
  const part = (o: Record<string, number>, keys: string[], count: number) => {
    const on = keys.filter((k) => (o[k] || 0) > 1e-9),
      s = on.reduce((a, k) => a + o[k], 0) || 1;
    if (!on.length || count < 1e-9) return '';
    if (on.length === 1) return (on[0].length > 1 && /[A-Z].*[A-Z]|\d/.test(on[0]) ? `(${on[0]})` : on[0]) + cnt(count);
    return '(' + on.map((k) => k + cnt(o[k] / s)).join('') + ')' + cnt(count);
  };
  const m = layeredAmounts(c);
  return (
    `(${c.L!.ion})${cnt(m.s)}` +
    part(c.A, ['Cs', 'FA', 'MA'], m.a) +
    part(bSite(c), B_IONS, m.pb) +
    part(c.X, ['I', 'Br', 'Cl'], m.x)
  );
}

export interface SpinStep {
  t: number;
  rpm: number;
  n2: boolean;
  final: boolean;
}

/** Controller countdown: seconds remaining at the start and end of each step. */
export function spinTimeline(steps: SpinStep[]) {
  const totalS = steps.reduce((a, s) => a + s.t, 0);
  let used = 0;
  const rows = steps.map((s) => {
    const from = totalS - used;
    used += s.t;
    return { ...s, from, to: totalS - used };
  });
  return { total: totalS, rows, finalOk: steps.filter((s) => s.final).length === 1 };
}

export type RateUnit = 'A/s' | 'A/min';
export const depositionSeconds = (nm: number, rate: number, unit: RateUnit) =>
  ((nm * 10) / rate) * (unit === 'A/min' ? 60 : 1);
export const convertRate = (v: number, from: RateUnit, to: RateUnit) =>
  +(from === to ? v : from === 'A/s' ? v * 60 : v / 60).toPrecision(6);

export interface Stage {
  until: number;
  rate: number;
} // nm, A/s

/** Metal evaporation: rate steps until given thicknesses. Controller thickness is in kA (nm / 100). */
export function metalStages(stages: Stage[]) {
  let prev = 0,
    sum = 0;
  const rows = stages.map((s) => {
    const seconds = ((s.until - prev) * 10) / s.rate;
    const r = { from: prev, until: s.until, rate: s.rate, seconds, kA: s.until / 100 };
    prev = s.until;
    sum += seconds;
    return r;
  });
  return { rows, total: sum, final: prev, ordered: stages.every((s, i) => !i || s.until > stages[i - 1].until) };
}

export const SUBSTRATES = {
  '1.2 × 1.2 cm': { w: 12, h: 12, ito: [2, 0, 8, 12] as Rect, note: 'ITO-free strips: 2 mm on two opposite edges' },
  '1.5 × 2.5 cm': {
    w: 25,
    h: 15,
    ito: [0, 0, 25, 12] as Rect,
    note: 'ITO-free strip: 3 mm along one 2.5 cm edge (bottom)',
  },
};
export type SubKey = keyof typeof SUBSTRATES;

// [pixels, width mm, length mm from contact edge, scrape strip mm] - placeholders until real masks are provided
export const PATTERNS: Record<SubKey, Record<string, [number, number, number, number]>> = {
  '1.2 × 1.2 cm': { '4 px (placeholder)': [4, 2, 8, 1] },
  '1.5 × 2.5 cm': { '6 px (placeholder)': [6, 2, 8, 1] },
};

export const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) *
  Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));

/** Metal fingers, scrape zone and active pixel areas for a pattern on a substrate. Only patterns of that substrate size resolve. */
export function pattern(sub: SubKey, name?: string) {
  const P = PATTERNS[sub],
    q = name && P[name] ? name : Object.keys(P)[0];
  const [n, pw, pl, sw] = P[q],
    big = sub === '1.5 × 2.5 cm',
    L = big ? 25 : 12,
    ito = SUBSTRATES[sub].ito;
  const metal: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const c = ((i + 0.5) * L) / n;
    metal.push(big ? [c - pw / 2, 15 - pl, pw, pl] : [12 - pl, c - pw / 2, pl, pw]);
  }
  const scrape: Rect[] = [big ? [0, 0, L, sw] : [2, 0, sw, L]];
  return { name: q, metal, scrape, ito, areas: metal.map((m) => overlap(m, ito)) };
}

export type Basis = 'mol%' | 'wt%' | 'mg/mL' | 'µL/mL' | 'µL stock/mL';
export interface Additive {
  n: string;
  b: Basis;
  v: number;
  sc?: number;
}
export interface SolIn {
  mode: 'Perovskite' | 'ETL' | 'HTL' | 'Custom';
  comp: Comp;
  M: number;
  V: number;
  sol: string;
  c: number;
  u: 'mg/mL' | 'mM';
  sv: { n: string; p: number }[];
  ad: Additive[];
  act: Record<string, string | number | undefined>;
  /**
   * How V and M are meant for a perovskite. 'solvent' (default): V mL of solvent is added, M = mol Pb per L of solvent.
   * 'density': V mL is the final solution; the solids take up mass / density (`rho`, g/cm³, of the perovskite), so less solvent is added.
   */
  meth?: 'solvent' | 'density';
  rho?: number;
  /**
   * 'one' (default): everything weighed into one vial. 'stocks': each salt is dissolved on its own in the solvent mixture
   * (stock concentration `c`, mol/L, and volume to prepare `v`, mL; defaults: c = M × total salt per Pb, v = the volume needed),
   * then the stocks are mixed and topped up with solvent to V. Additives go into the mixed solution.
   */
  prep?: 'one' | 'stocks';
  stocks?: Record<string, { c?: number; v?: number }>;
}

/** Full solution preparation: masses (additives bundled into matching compounds), solvent volumes, ion contributions, actual formula/molarity from weighed masses. */
export function solutionPlan(i: SolIn, chems: Chem[]) {
  const ch = (n: string) => chemIn(chems, n),
    per = i.mode === 'Perovskite',
    V = i.V,
    nPb = i.M * V;
  const main = per
    ? Object.entries(plan(i.comp)).map(([s, mol]) => {
        const c = ch(s),
          n = mol * nPb;
        return { s, mol, n, m: (n * (c?.M ?? 0)) / ((c?.pur ?? 100) / 100), ok: !!c?.M };
      })
    : (() => {
        const c = ch(i.sol),
          m = i.u === 'mg/mL' ? i.c * V : (i.c * V * (c?.M ?? 0)) / 1000;
        return [{ s: i.sol, mol: 0, n: m / (c?.M || 1), m, ok: !!c?.M }];
      })();
  const mainMass = main.reduce((a, r) => a + r.m, 0);
  const ad = i.ad.map((a) => {
    const c = ch(a.n),
      ul = a.b[0] === 'µ' ? a.v * V : 0;
    const m =
      a.b === 'mol%'
        ? (a.v / 100) * (per ? nPb : (main[0]?.n ?? 0)) * (c?.M ?? 0)
        : a.b === 'wt%'
          ? (a.v / 100) * mainMass
          : a.b === 'mg/mL'
            ? a.v * V
            : 0;
    return { ...a, ul, m, mmol: m / (c?.M || 1), stockMg: a.b === 'µL stock/mL' ? (ul * (a.sc ?? 0)) / 1000 : 0 };
  });
  // an additive of a salt the composition already has is weighed with it: the same name, or the same substance (0.55.4)
  const same = (a: string, b: string) => a === b || (!!ch(a) && ch(a) === ch(b));
  const rows = main.map((r) => {
    const ex = ad.filter((a) => same(a.n, r.s) && !a.ul),
      em = ex.reduce((s, a) => s + a.m, 0);
    return { ...r, em, bundled: ex.map((a) => `${a.v} ${a.b}`), mmol: r.n + em / (ch(r.s)?.M || 1), mg: r.m + em };
  });
  const extra = ad.filter((a) => a.ul || !main.some((r) => same(r.s, a.n)));
  // solids: everything weighed (salts with bundled additives, weighed additives); their volume counts in the density method
  const solidMg = rows.reduce((a, r) => a + r.mg, 0) + extra.filter((a) => !a.ul).reduce((a, x) => a + x.m, 0);
  const multi = per && i.prep === 'stocks';
  const dens = per && !multi && i.meth === 'density' && (i.rho ?? 0) > 0;
  const solidUl = dens ? solidMg / i.rho! : 0; // mg ÷ (g/cm³ = mg/µL) = µL
  const solventUl = Math.max(0, V * 1000 - solidUl - (dens ? extra.reduce((a, x) => a + x.ul, 0) : 0));
  const sp = i.sv.reduce((a, s) => a + s.p, 0) || 1;
  // separate stock solutions: one per salt, mixed by volume, then solvent up to V
  const cDef = i.M * main.reduce((a, r) => a + r.mol, 0);
  const stocks = multi
    ? rows.map((r) => {
        const st = i.stocks?.[r.s] ?? {},
          c = st.c && st.c > 0 ? st.c : cDef,
          c0 = ch(r.s);
        const need = c ? (r.mmol / c) * 1000 : 0; // µL of stock to pipette (mmol ÷ mol/L = mL)
        const make = st.v && st.v > 0 ? st.v : need / 1000; // mL to prepare
        return {
          s: r.s,
          c,
          auto: !(st.c && st.c > 0),
          need,
          make,
          autoV: !(st.v && st.v > 0),
          short: make * 1000 < need - 1e-6,
          mg: (c * make * (c0?.M ?? 0)) / ((c0?.pur ?? 100) / 100),
        }; // mmol × g/mol = mg
      })
    : [];
  const stockUl = stocks.reduce((a, x) => a + x.need, 0),
    topUp = V * 1000 - stockUl;
  const solv = i.sv.map((s) => ({ n: s.n, ul: ((multi ? Math.max(0, topUp) : solventUl) * s.p) / sp }));
  const act: Record<string, number> = {};
  for (const r of rows) {
    const w = i.act[r.s];
    const expected = multi ? (stocks.find((x) => x.s === r.s)?.mg ?? r.mg) : r.mg;
    act[r.s] = w !== undefined && w !== '' ? (r.n * +w) / (expected || 1) : r.n;
  }
  const ct = per
    ? [...SPACERS.map((x) => x.ion), 'Cs', 'FA', 'MA', ...B_IONS, 'I', 'Br', 'Cl']
        .map((k) => {
          const from = main
            .map((r) => [r.s, r.mol * (saltIons(r.s, chems)[k] || 0)] as [string, number])
            .filter((z) => z[1] > 1e-9);
          return from.length ? { ion: k, total: from.reduce((a, z) => a + z[1], 0), from } : null;
        })
        .filter((x): x is { ion: string; total: number; from: [string, number][] } => !!x)
    : [];
  return {
    per,
    rows,
    extra,
    solv,
    ct,
    stocks: multi ? { list: stocks, stockUl, topUp, over: topUp < -1e-6 } : null,
    density: dens ? { solidMg, solidUl, solventUl, rho: i.rho! } : null,
    target: per
      ? is2D(i.comp)
        ? layered(i.comp)
        : // from the amounts per B-site (0.57), not the mmol: with no molarity yet the formula still reads
          formula(Object.fromEntries(main.map((r) => [r.s, r.mol])), chems)
      : '',
    actual: per ? formula(act, chems) : '',
    actualM: per
      ? Object.entries(act).reduce((s, [k, v]) => {
          const io = saltIons(k, chems);
          return s + v * B_IONS.reduce((a, b) => a + (io[b] || 0), 0);
        }, 0) / (V || 1)
      : 0,
  };
}

export interface Dispense {
  src: string;
  v: number;
  filter: boolean;
  when: 'before' | 'remaining';
  at: number;
}

/** Spin program + dispenses: countdown rows, ordered events, and total volume per source (mL) for N substrates plus overage %. */
export function spinPlan(steps: SpinStep[], dp: Dispense[], N: number, overagePct: number) {
  const tl = spinTimeline(steps);
  const events = dp
    .filter((d) => d.src)
    .map((d) => ({
      ...d,
      order: d.when === 'before' ? Infinity : d.at,
      over: d.when === 'remaining' && d.at > tl.total,
    }))
    .sort((a, b) => b.order - a.order);
  const vol: Record<string, number> = {};
  for (const d of dp) if (d.src) vol[d.src] = (vol[d.src] || 0) + (d.v * N * (1 + overagePct / 100)) / 1000;
  return { ...tl, events, vol };
}
export const CORE_VERSION = '0.1.0';

export interface LayerIn {
  n: string;
  kind: 'film' | 'metal';
  mat: string;
  nm: number;
  rects?: Rect[];
}
export interface Slab {
  kind: 'glass' | 'ito' | 'film' | 'metal';
  n: string;
  mat: string;
  label: string;
  y0: number;
  h: number;
  rects: Rect[];
}

/** Schematic (logarithmic) visual height for a layer of `nm` nanometres, in scene units. */
export const visH = (nm: number) => 0.07 + 0.17 * Math.log10(Math.max(nm, 1));

/** Substrate area left after removing a full-length scrape strip (one or two rectangles). */
export function footprint(sub: SubKey, strip: Rect): Rect[] {
  const { w: W, h: H } = SUBSTRATES[sub];
  const parts: Rect[] =
    strip[3] >= H - 1e-6
      ? [
          [0, 0, strip[0], H],
          [strip[0] + strip[2], 0, W - strip[0] - strip[2], H],
        ]
      : [
          [0, 0, W, strip[1]],
          [0, strip[1] + strip[3], W, H - strip[1] - strip[3]],
        ];
  return parts.filter((r) => r[2] > 1e-6 && r[3] > 1e-6);
}

/** Layers bottom to top: glass, ITO, films (minus the scrape zone), metal fingers. */
export function stackSlabs(sub: SubKey, layers: LayerIn[], scrape: Rect): Slab[] {
  const S = SUBSTRATES[sub],
    fp = footprint(sub, scrape),
    out: Slab[] = [];
  let y = 0;
  const add = (kind: Slab['kind'], n: string, mat: string, label: string, h: number, rects: Rect[]) => {
    out.push({ kind, n, mat, label, y0: y, h, rects });
    y += h;
  };
  add('glass', 'Glass', 'Glass', 'Glass', 0.8, [[0, 0, S.w, S.h]]);
  add('ito', 'ITO', 'ITO', 'ITO', 0.1, [S.ito]);
  for (const l of layers)
    add(
      l.kind,
      l.n,
      l.mat,
      `${l.n}${l.mat && l.mat !== l.n ? ' · ' + l.mat : ''} · ${l.nm} nm`,
      visH(l.nm),
      l.kind === 'metal' ? (l.rects ?? []) : fp,
    );
  return out;
}
/** The Electronic Devices module's shared logic (0.43): perovskite solution chemistry, spin coating, evaporation, substrates and
 * masks, J–V and lifetime analysis, stacks in 3D, variants, consumption, and the photovoltaics steps equipment can do. */
export * from './geom';
export * from './iv';
export * from './mask';
export * from './stack3d';
export * from './variants';
export * from './uses';
export * from './steps';
export * from './designs';
export * from './lines';
