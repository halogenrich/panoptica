/**
 * 2D structures from SMILES, drawn ChemDraw style (0.57, Richard's picture of ethyl acetate): skeletal, carbons unlabelled,
 * heteroatoms as coloured symbols with their hydrogens, bonds as thick lines with round ends that stop short of a label,
 * double bonds as two lines (the second inside the ring for ring bonds, both centred when one end has nothing else on it).
 * OpenChemLib reads the SMILES, gives the Kekulé bonds and lays the atoms out; the drawing below is PANOPTICA's own.
 * Units: the bond length is 1.
 */
import type { Molecule } from 'openchemlib';

export type Seg = { x1: number; y1: number; x2: number; y2: number };
/** A text run of an atom label: plain, subscript (H counts) or superscript (charge). */
export type Run = { t: string; k?: 'sub' | 'sup' };
export type Label = {
  x: number;
  y: number;
  el: string;
  /** what comes before the symbol (HO, H2N) and after it (OH, NH3+) */
  pre: Run[];
  sym: string;
  post: Run[];
};
export type Drawing = { w: number; h: number; lines: Seg[]; labels: Label[] };

/** Proportions taken from the picture: thick strokes, wide double bonds, a label about half a bond tall. */
export const STYLE = { stroke: 0.1, gap: 0.2, font: 0.5, trim: 0.27, inner: 0.16, pad: 0.45 };

/** Rough advance widths (in em) of the label font, enough to keep bonds and fragments clear of the labels. */
const ch = (c: string) =>
  /[Iil|]/.test(c)
    ? 0.28
    : /[frt]/.test(c)
      ? 0.36
      : /[MW]/.test(c)
        ? 0.84
        : /[A-Z]/.test(c)
          ? 0.68
          : /[+−]/.test(c)
            ? 0.6
            : 0.56;
export const wid = (r: Run[]) => r.reduce((s, x) => s + [...x.t].reduce((t, c) => t + ch(c) * (x.k ? 0.62 : 1), 0), 0);

/**
 * Crowded layouts (Spiro-OMeTAD's four diarylamines fold onto each other in OpenChemLib's layout): branches hanging from a
 * chain bond are mirrored or turned in 30° steps about their attachment while that moves atoms apart. A layout with no atoms
 * closer than 0.8 bond is left as it is.
 */
function relieve(P: { x: number; y: number }[], nbr: number[][], chain: [number, number][]) {
  const n = P.length;
  const score = () => {
    let s = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const d = Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y);
        if (d < 0.8) s += (0.8 - d) * 10 + 1;
      }
    return s;
  };
  let cur = score();
  if (!cur) return;
  // the atoms on c's side of the bond a–c, when the bond is the only link between the two sides
  const side = (a: number, c: number) => {
    const seen = new Set([a, c]),
      st = [c],
      out = [c];
    while (st.length)
      for (const w of nbr[st.pop()!])
        if (!seen.has(w)) {
          seen.add(w);
          out.push(w);
          st.push(w);
        }
    return out;
  };
  const branches = chain
    .map(([a, c]) => {
      const s1 = side(a, c),
        s2 = side(c, a);
      return s1.length <= s2.length ? { p: a, set: s1 } : { p: c, set: s2 };
    })
    .filter((b) => b.set.length > 1 && b.set.length < n - 1);
  const moves = (p: number, q: number, set: number[]) => [
    // mirrored across the bond
    () => {
      const A = P[p],
        dx = P[q].x - A.x,
        dy = P[q].y - A.y,
        l2 = dx * dx + dy * dy;
      for (const i of set) {
        const t = ((P[i].x - A.x) * dx + (P[i].y - A.y) * dy) / l2;
        P[i] = { x: 2 * (A.x + t * dx) - P[i].x, y: 2 * (A.y + t * dy) - P[i].y };
      }
    },
    ...[-2, -1, 1, 2].map((k) => () => {
      const A = P[p],
        c = Math.cos((k * Math.PI) / 6),
        s = Math.sin((k * Math.PI) / 6);
      for (const i of set) {
        const x = P[i].x - A.x,
          y = P[i].y - A.y;
        P[i] = { x: A.x + x * c - y * s, y: A.y + x * s + y * c };
      }
    }),
  ];
  for (let round = 0; round < 30 && cur > 0; round++) {
    let better = false;
    for (const { p, set } of branches) {
      const old = set.map((i) => P[i]);
      let best: { x: number; y: number }[] | null = null,
        bs = cur;
      for (const mv of moves(p, set[0], set)) {
        mv();
        const s = score();
        if (s < bs - 1e-9) {
          bs = s;
          best = set.map((i) => P[i]);
        }
        set.forEach((i, k) => (P[i] = old[k]));
      }
      if (best) {
        set.forEach((i, k) => (P[i] = best![k]));
        cur = bs;
        better = true;
      }
    }
    if (!better) break;
  }
}
const sub = (n: number): Run[] => (n > 1 ? [{ t: String(n), k: 'sub' }] : []);
const chg = (c: number): Run[] =>
  c ? [{ t: (Math.abs(c) > 1 ? String(Math.abs(c)) : '') + (c > 0 ? '+' : '−'), k: 'sup' }] : [];

/** Lays out a molecule that OpenChemLib has read (coordinates invented here). */
export function draw(m: Molecule): Drawing {
  m.inventCoordinates();
  const n = m.getAllAtoms(),
    nb = m.getAllBonds(),
    L = m.getAverageBondLength(true) || 1;
  let P = Array.from({ length: n }, (_, i) => ({ x: m.getAtomX(i) / L, y: m.getAtomY(i) / L }));
  const nbr: number[][] = Array.from({ length: n }, () => []);
  for (let b = 0; b < nb; b++) {
    const a = m.getBondAtom(0, b),
      c = m.getBondAtom(1, b);
    nbr[a].push(c);
    nbr[c].push(a);
  }

  const chain: [number, number][] = [];
  for (let b = 0; b < nb; b++) if (!m.isRingBond(b)) chain.push([m.getBondAtom(0, b), m.getBondAtom(1, b)]);
  relieve(P, nbr, chain);

  // wide rather than tall: the best of the layout turned in 30° steps (bond angles stay on the same grid)
  if (n > 2) {
    let best = P,
      ratio = -1;
    for (let k = 0; k < 6; k++) {
      const t = (k * Math.PI) / 6,
        c = Math.cos(t),
        s = Math.sin(t),
        Q = P.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
      const xs = Q.map((q) => q.x),
        ys = Q.map((q) => q.y),
        r = (Math.max(...xs) - Math.min(...xs) + 1) / (Math.max(...ys) - Math.min(...ys) + 1);
      if (r > ratio + 0.05) {
        ratio = r;
        best = Q;
      }
    }
    P = best;
  }

  // labels: every atom but a neutral carbon with bonds
  const labels: (Label | null)[] = P.map((p, i) => {
    const el = m.getAtomLabel(i),
      q = m.getAtomCharge(i);
    if (el === 'C' && !q && nbr[i].length) return null;
    const h = m.getAllHydrogens(i),
      dx = nbr[i].reduce((s, j) => s + (P[j].x - p.x), 0);
    // hydrogens go on the side away from the bonds; the charge always ends the label
    const H: Run[] = h ? [{ t: 'H' }, ...sub(h)] : [];
    const left = h > 0 && dx > 0.3;
    return { x: p.x, y: p.y, el, sym: el, pre: left ? H : [], post: [...(left ? [] : H), ...chg(q)] };
  });

  // fragments (ions of a salt) side by side, centred on one line, clear of each other's labels
  const frag = new Array(n).fill(-1);
  let nf = 0;
  for (let i = 0; i < n; i++) {
    if (frag[i] >= 0) continue;
    const st = [i];
    frag[i] = nf;
    while (st.length)
      for (const j of nbr[st.pop()!])
        if (frag[j] < 0) {
          frag[j] = nf;
          st.push(j);
        }
    nf++;
  }
  const ext = (i: number) => {
    const l = labels[i];
    if (!l) return { l: P[i].x, r: P[i].x };
    const s = wid([{ t: l.sym }]) / 2;
    return { l: P[i].x - (s + wid(l.pre)) * STYLE.font, r: P[i].x + (s + wid(l.post)) * STYLE.font };
  };
  if (nf > 1) {
    let x0 = 0;
    for (let f = 0; f < nf; f++) {
      const ids = P.map((_, i) => i).filter((i) => frag[i] === f);
      const lo = Math.min(...ids.map((i) => ext(i).l)),
        hi = Math.max(...ids.map((i) => ext(i).r)),
        ys = ids.map((i) => P[i].y),
        cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      for (const i of ids) P[i] = { x: P[i].x - lo + x0, y: P[i].y - cy };
      x0 += hi - lo + 0.55;
    }
    for (let i = 0; i < n; i++) if (labels[i]) Object.assign(labels[i]!, P[i]);
  }

  // rings, for the side of a ring double bond: the smallest ring holding it, then the one with more double bonds
  const rings = m.getRingSet(),
    order = (b: number) => m.getBondOrder(b);
  const ringOf = (b: number) => {
    let best = -1,
      key = [Infinity, -1];
    for (let r = 0; r < rings.getSize(); r++) {
      if (!rings.isBondMember(r, b)) continue;
      const k = [rings.getRingSize(r), rings.getRingBonds(r).filter((x) => order(x) === 2).length];
      if (k[0] < key[0] || (k[0] === key[0] && k[1] > key[1])) {
        best = r;
        key = k;
      }
    }
    return best;
  };
  const centre = (r: number) => {
    const a = rings.getRingAtoms(r);
    return { x: a.reduce((s, i) => s + P[i].x, 0) / a.length, y: a.reduce((s, i) => s + P[i].y, 0) / a.length };
  };

  const lines: Seg[] = [];
  const cut = (i: number) => (labels[i] ? STYLE.trim : 0);
  /** A line from a to b, moved sideways by `off`, shortened at each end. */
  const seg = (a: number, b: number, off: number, sa: number, sb: number) => {
    const A = P[a],
      B = P[b],
      len = Math.hypot(B.x - A.x, B.y - A.y) || 1,
      ux = (B.x - A.x) / len,
      uy = (B.y - A.y) / len,
      nx = -uy * off,
      ny = ux * off;
    if (sa + sb >= len - 0.05) return;
    lines.push({ x1: A.x + ux * sa + nx, y1: A.y + uy * sa + ny, x2: B.x - ux * sb + nx, y2: B.y - uy * sb + ny });
  };
  const side = (a: number, b: number, p: { x: number; y: number }) =>
    Math.sign((P[b].x - P[a].x) * (p.y - P[a].y) - (P[b].y - P[a].y) * (p.x - P[a].x));
  for (let b = 0; b < nb; b++) {
    const a = m.getBondAtom(0, b),
      c = m.getBondAtom(1, b),
      o = order(b),
      g = STYLE.gap;
    if (o === 3) {
      for (const k of [-1, 0, 1]) seg(a, c, k * g * 0.85, cut(a), cut(c));
      continue;
    }
    if (o !== 2) {
      seg(a, c, 0, cut(a), cut(c));
      continue;
    }
    const r = m.isRingBond(b) ? ringOf(b) : -1;
    let s = 0;
    if (r >= 0) s = side(a, c, centre(r)) || 1;
    else if (nbr[a].length > 1 && nbr[c].length > 1) {
      // a chain double bond: the second line on the side with more neighbours
      s = [...nbr[a].filter((x) => x !== c), ...nbr[c].filter((x) => x !== a)].reduce(
        (t, x) => t + side(a, c, P[x]),
        0,
      );
      s = Math.sign(s) || 1;
    }
    if (!s) {
      // one end has nothing else on it (C=O, S=O): both lines centred on the bond, as in the picture
      seg(a, c, g / 2, cut(a), cut(c));
      seg(a, c, -g / 2, cut(a), cut(c));
    } else {
      seg(a, c, 0, cut(a), cut(c));
      seg(a, c, s * g, Math.max(cut(a), STYLE.inner), Math.max(cut(c), STYLE.inner));
    }
  }

  // bounds with the labels, then everything moved so the drawing starts at (pad, pad)
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const e = ext(i),
      hh = labels[i] ? STYLE.font * 0.45 : 0;
    x0 = Math.min(x0, e.l);
    x1 = Math.max(x1, e.r);
    y0 = Math.min(y0, P[i].y - hh);
    y1 = Math.max(y1, P[i].y + hh);
  }
  const pad = STYLE.pad,
    mx = pad - x0,
    my = pad - y0;
  return {
    w: x1 - x0 + 2 * pad,
    h: y1 - y0 + 2 * pad,
    lines: lines.map((l) => ({ x1: l.x1 + mx, y1: l.y1 + my, x2: l.x2 + mx, y2: l.y2 + my })),
    labels: labels.filter((l): l is Label => !!l).map((l) => ({ ...l, x: l.x + mx, y: l.y + my })),
  };
}

let ocl: Promise<typeof import('openchemlib')> | null = null;
const cache = new Map<string, Drawing | null>();
/**
 * The drawing for a SMILES, or null when it cannot be read. OpenChemLib (about 1 MB) is loaded the first time a structure is
 * shown, not with the app.
 */
export async function structureOf(smiles: string): Promise<Drawing | null> {
  const s = smiles.trim();
  if (!s) return null;
  if (cache.has(s)) return cache.get(s)!;
  ocl ??= import('openchemlib');
  const { Molecule } = await ocl;
  let d: Drawing | null;
  try {
    const m = Molecule.fromSmiles(s);
    d = m.getAllAtoms() ? draw(m) : null;
  } catch {
    d = null;
  }
  cache.set(s, d);
  return d;
}

/** The formula a SMILES holds (0.57), Hill order (C16H18NO5P), or null when it cannot be read. */
export async function formulaOf(smiles: string): Promise<string | null> {
  const s = smiles.trim();
  if (!s) return null;
  ocl ??= import('openchemlib');
  const { Molecule } = await ocl;
  try {
    return Molecule.fromSmiles(s).getMolecularFormula().formula || null;
  } catch {
    return null;
  }
}
