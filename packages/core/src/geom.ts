// Parametric 2D geometry for substrate and mask designs. Units: mm. Origin top-left, y pointing down (same as SVG).
import pc from 'polygon-clipping';

export type Pt = [number, number];
export type Poly = Pt[];
export interface Repeat { nx: number; ny: number; px: number; py: number } // count and pitch in x and y

interface Base { id: string; repeat?: Repeat }
export interface RectS extends Base { kind: 'rect'; x: number; y: number; w: number; h: number }
/** Bottom edge from (x, y+h) to (x+w, y+h); top edge shifted right by `skew`. */
export interface ParaS extends Base { kind: 'para'; x: number; y: number; w: number; h: number; skew: number }
/** Bottom width `wb` starting at x; top width `wt` starting at x + `off`. */
export interface TrapS extends Base { kind: 'trap'; x: number; y: number; h: number; wb: number; wt: number; off: number }
export interface QuadS extends Base { kind: 'quad'; pts: [Pt, Pt, Pt, Pt] }
export type Shape = RectS | ParaS | TrapS | QuadS;
export type ShapeKind = Shape['kind'];

export const SHAPE_LABEL: Record<ShapeKind, string> = { rect: 'Rectangle', para: 'Parallelogram', trap: 'Trapezoid', quad: 'Quadrilateral' };

let seq = 0;
export const newId = () => Date.now().toString(36) + (seq++).toString(36);

/** A new shape of the given kind filling the box (x, y, w, h). */
export function makeShape(kind: ShapeKind, x: number, y: number, w: number, h: number): Shape {
  const id = newId();
  switch (kind) {
    case 'rect': return { id, kind, x, y, w, h };
    case 'para': return { id, kind, x, y, w: w * 0.8, h, skew: w * 0.2 };
    case 'trap': return { id, kind, x, y, h, wb: w, wt: w * 0.6, off: w * 0.2 };
    case 'quad': return { id, kind, pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] };
  }
}

/** Outline of one shape (without its repeat), clockwise on screen. */
export function outline(s: Shape): Poly {
  switch (s.kind) {
    case 'rect': return [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]];
    case 'para': return [[s.x + s.skew, s.y], [s.x + s.skew + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]];
    case 'trap': return [[s.x + s.off, s.y], [s.x + s.off + s.wt, s.y], [s.x + s.wb, s.y + s.h], [s.x, s.y + s.h]];
    case 'quad': return s.pts.map((p) => [p[0], p[1]] as Pt);
  }
}

/** All outlines of a shape, including its repeated copies. */
export function polys(s: Shape): Poly[] {
  const o = outline(s), r = s.repeat;
  if (!r || (r.nx <= 1 && r.ny <= 1)) return [o];
  const out: Poly[] = [];
  for (let j = 0; j < Math.max(1, r.ny); j++) for (let i = 0; i < Math.max(1, r.nx); i++) out.push(o.map(([x, y]) => [x + i * r.px, y + j * r.py]));
  return out;
}
export const allPolys = (shapes: Shape[]) => shapes.flatMap(polys);

/** Signed area (shoelace); positive for clockwise-on-screen outlines. */
const signed = (p: Poly) => p.reduce((a, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return a + (x * y2 - x2 * y); }, 0) / 2;
export const polyArea = (p: Poly) => Math.abs(signed(p));

type MP = pc.MultiPolygon;
const toGeom = (ps: Poly[]): pc.Polygon[] => ps.filter((p) => polyArea(p) > 1e-12).map((p) => [[...p, p[0]] as pc.Ring]);
const mpArea = (mp: MP) => mp.reduce((a, poly) => a + poly.reduce((b, ring, i) => b + (i === 0 ? 1 : -1) * Math.abs(signed(ring.slice(0, -1) as Poly)), 0), 0);

/** Merged region of polygons (overlaps counted once). */
export function union(ps: Poly[]): MP { const g = toGeom(ps); return g.length ? pc.union(g[0], ...g.slice(1)) : []; }
export const unionArea = (ps: Poly[]) => mpArea(union(ps));
/** Area where region A and region B overlap. */
export function overlapArea(a: Poly[], b: Poly[]) { const ua = union(a), ub = union(b); return ua.length && ub.length ? mpArea(pc.intersection(ua, ub)) : 0; }
/** Region A minus region B. */
export function subtract(a: Poly[], b: Poly[]): MP { const ua = union(a), ub = union(b); return !ua.length ? [] : !ub.length ? ua : pc.difference(ua, ub); }
export const regionArea = mpArea;
/** Connected pieces of a region, as outer rings (used to count islands). */
export const pieces = (ps: Poly[]) => union(ps).map((poly) => poly[0].slice(0, -1) as Poly);

export function bbox(ps: Poly[]) {
  const xs = ps.flat().map((p) => p[0]), ys = ps.flat().map((p) => p[1]);
  return xs.length ? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } : { x0: 0, y0: 0, x1: 0, y1: 0 };
}

/** True when the outline has no reflex corner and does not fold over itself. */
export function isConvex(p: Poly) {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const [a, b, c] = [p[i], p[(i + 1) % p.length], p[(i + 2) % p.length]];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-12) continue;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return sign !== 0;
}

export const inside = (ps: Poly[], w: number, h: number, tol = 1e-6) => ps.every((p) => p.every(([x, y]) => x >= -tol && y >= -tol && x <= w + tol && y <= h + tol));

/** Problems a user should see for one shape. */
export function shapeIssues(s: Shape, w: number, h: number): string[] {
  const out: string[] = [], o = outline(s);
  if (polyArea(o) < 1e-6) out.push('has no area');
  else if (!isConvex(o)) out.push('corners cross or fold inward');
  if (!inside(polys(s), w, h)) out.push('extends beyond the glass');
  return out;
}

/**
 * End-to-end resistance of a conducting strip along its longer side: R = Rs · L / W.
 * Uses the bounding box of the shape, which is exact for rectangles and an estimate for slanted shapes.
 */
export function stripResistance(s: Shape, rs: number) {
  const b = bbox([outline(s)]), dx = b.x1 - b.x0, dy = b.y1 - b.y0;
  const L = Math.max(dx, dy), W = (polyArea(outline(s)) / L) || 1;
  return { ohm: rs * (L / W), L, W, axis: dx >= dy ? 'x' : 'y', squares: L / W };
}

/** Move a shape (and its repeats) by dx, dy. */
export function moveShape(s: Shape, dx: number, dy: number): Shape {
  return s.kind === 'quad' ? { ...s, pts: s.pts.map(([x, y]) => [x + dx, y + dy]) as QuadS['pts'] } : { ...s, x: s.x + dx, y: s.y + dy };
}

/** Fit a shape into a new bounding box, keeping its proportions within the box. */
export function fitShape(s: Shape, x0: number, y0: number, x1: number, y1: number): Shape {
  const b = bbox([outline(s)]), sx = (x1 - x0) / ((b.x1 - b.x0) || 1), sy = (y1 - y0) / ((b.y1 - b.y0) || 1);
  const map = ([x, y]: Pt): Pt => [x0 + (x - b.x0) * sx, y0 + (y - b.y0) * sy];
  switch (s.kind) {
    case 'rect': return { ...s, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    case 'para': return { ...s, x: x0, y: y0, w: s.w * sx, h: y1 - y0, skew: s.skew * sx };
    case 'trap': return { ...s, x: x0 + (s.x - b.x0) * sx, y: y0, h: y1 - y0, wb: s.wb * sx, wt: s.wt * sx, off: s.off * sx };
    case 'quad': return { ...s, pts: s.pts.map(map) as QuadS['pts'] };
  }
}

export const round = (v: number, step = 0.01) => Math.round(v / step) * step;

/** The copies of a repeated shape as separate shapes (row by row, left to right), each with its own id. */
export function explode(s: Shape): Shape[] {
  const r = s.repeat;
  if (!r || (r.nx <= 1 && r.ny <= 1)) return [s];
  const base = { ...s, repeat: undefined } as Shape, out: Shape[] = [];
  for (let j = 0; j < Math.max(1, r.ny); j++) for (let i = 0; i < Math.max(1, r.nx); i++) out.push({ ...moveShape(base, i * r.px, j * r.py), id: newId() });
  return out;
}
