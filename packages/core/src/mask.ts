// Metal mask layouts: electrical checks, mask-making checks, and STL / SVG / DXF export. Units mm, y down (as drawn).
import pc from 'polygon-clipping';
import earcut from 'earcut';
import { allPolys, isConvex, outline, polyArea, polys, regionArea, union, type Poly, type Pt, type Shape } from './geom';

export interface SubstrateGeom { w: number; h: number; ito: Shape[]; rs?: number; marker?: string }
export interface PlateOpts {
  t: number;          // plate thickness (mm)
  margin: number;     // plate border around the glass (mm)
  pocket: boolean;    // recess on the underside that holds the substrate
  pocketDepth: number;
  clearance: number;  // gap around the glass in the pocket (mm)
  minFeature: number; // smallest opening width / bridge the mask maker can produce (mm)
  mirror: boolean;    // mirror left-right for substrates mounted face down above the source
}
export interface MaskD {
  subId: string; subName: string; sub: SubstrateGeom;
  active: Shape[];   // intended active areas (pixels)
  conn: Shape[];     // connection strips, pads, counter electrode (metal that is not meant to be active)
  scrape: Shape[];   // where the deposited layers are removed to expose ITO
  plate: PlateOpts; notes: string;
  /** Pixel area used in outputs: the recalculated device area (metal over unscraped ITO, including connection metal; default) or the drawn active area. */
  useActual?: boolean;
}
export type MaskKind = 'aperture' | 'evaporation' | 'scrape';
export const MASK_LABEL: Record<MaskKind, string> = { aperture: 'Aperture (active areas)', evaporation: 'Evaporation (all metal)', scrape: 'Scrape stencil' };
export const DEFAULT_PLATE: PlateOpts = { t: 0.5, margin: 3, pocket: false, pocketDepth: 1.1, clearance: 0.15, minFeature: 0.3, mirror: false };

type MP = pc.MultiPolygon;
const geom = (ps: Poly[]): pc.Polygon[] => ps.filter((p) => polyArea(p) > 1e-12).map((p) => [[...p, p[0]] as pc.Ring]);
const inter = (a: MP, b: MP): MP => (a.length && b.length ? pc.intersection(a, b) : []);
const diff = (a: MP, b: MP): MP => (!a.length ? [] : !b.length ? a : pc.difference(a, b));
const ringPoly = (r: pc.Ring): Poly => r.slice(0, -1) as Poly;

/** Smallest width of a convex outline (rotating calipers over its edges). */
export function minWidth(p: Poly) {
  let best = Infinity;
  for (let i = 0; i < p.length; i++) {
    const [a, b] = [p[i], p[(i + 1) % p.length]], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const far = Math.max(...p.map((q) => Math.abs((b[0] - a[0]) * (a[1] - q[1]) - (a[0] - q[0]) * (b[1] - a[1])) / len));
    best = Math.min(best, far);
  }
  return best;
}
const segDist = (p: Pt, a: Pt, b: Pt) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
/** Closest distance between two outlines that do not overlap. */
export function gap(p: Poly, q: Poly) {
  let d = Infinity;
  for (const [s, t] of [[p, q], [q, p]]) for (const v of s) for (let i = 0; i < t.length; i++) d = Math.min(d, segDist(v, t[i], t[(i + 1) % t.length]));
  return d;
}
const centroid = (p: Poly): Pt => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];

/** `area` is the pixel area the outputs use: `actual` (recalculated) or `intended` (drawn), as chosen in the mask. */
export interface Pixel { n: number; at: Pt; shape: Pt[]; intended: number; actual: number; area: number; parasitic: number; pad: number; short: boolean; overIto: boolean }
export interface Issue { level: 'error' | 'warn' | 'info'; text: string }

/**
 * Electrical reading of the layout. The device area of a pixel is where its connected metal lies over ITO that is not scraped
 * (the full stack is present there). Metal that reaches exposed ITO (scrape area) contacts the bottom electrode: wanted for the
 * counter electrode, a short circuit when the same metal also carries a pixel.
 */
export function analyzeMask(m: MaskD) {
  const ito = union(allPolys(m.sub.ito)), scrape = union(allPolys(m.scrape)), stack = diff(ito, scrape), exposed = inter(ito, scrape);
  const activeP = allPolys(m.active), metal = union([...activeP, ...allPolys(m.conn)]);
  // pixel numbers follow the order of the active areas in the list (array copies row by row); other metal by position
  const first = (c: MP) => { const i = activeP.findIndex((p) => regionArea(inter(c, geom([p]))) > 1e-9); return i < 0 ? Infinity : i; };
  const comps = metal.map((poly) => [poly] as MP).map((c) => ({ c, k: first(c), at: centroid(ringPoly(c[0][0])) }))
    .sort((a, b) => a.k - b.k || a.at[1] - b.at[1] || a.at[0] - b.at[0]).map((x) => x.c);
  const pixels: Pixel[] = [], counters: { at: Pt; area: number }[] = [], issues: Issue[] = [];
  for (const c of comps) {
    const act = inter(c, union(activeP)), toExposed = regionArea(inter(c, exposed)), at = centroid(ringPoly(c[0][0]));
    if (regionArea(act) < 1e-9) { if (toExposed > 1e-6) counters.push({ at, area: toExposed }); continue; }
    const intended = regionArea(inter(act, stack)), actual = regionArea(inter(c, stack));
    pixels.push({ n: pixels.length + 1, at: centroid(ringPoly(act[0][0])), shape: ringPoly(act[0][0]), intended, actual, area: m.useActual === false ? intended : actual, parasitic: actual - intended, pad: regionArea(diff(c, ito)), short: toExposed > 1e-6, overIto: intended > 1e-9 });
  }
  for (const p of pixels) {
    if (!p.overIto) issues.push({ level: 'error', text: `Pixel ${p.n} is not over unscraped ITO, so it has no device area.` });
    if (p.short) issues.push({ level: 'error', text: `Pixel ${p.n} metal reaches exposed ITO in the scrape area: top and bottom electrodes would be shorted.` });
    if (p.intended > 0 && p.parasitic > Math.max(0.01, 0.02 * p.intended)) issues.push({ level: 'warn', text: `Pixel ${p.n}: connection metal over ITO adds ${p.parasitic.toFixed(2)} mm² of device area (${p.intended.toFixed(2)} → ${p.actual.toFixed(2)} mm²). Route the strip over ITO-free glass or scrape under it.` });
    if (p.pad < 0.05) issues.push({ level: 'warn', text: `Pixel ${p.n} has no contact pad on ITO-free glass; probing on top of the stack can punch through.` });
  }
  if (!pixels.length) issues.push({ level: 'info', text: 'No active areas yet.' });
  if (pixels.length && !counters.length) issues.push({ level: 'warn', text: 'No metal contacts the exposed ITO. Add a counter electrode over the scrape area, or plan to probe the scraped ITO directly.' });
  if (pixels.length && !regionArea(scrape)) issues.push({ level: 'warn', text: 'No scrape area: the bottom electrode (ITO) is not exposed anywhere.' });

  // mask-making checks
  const fab: Record<MaskKind, Issue[]> = { aperture: [], evaporation: [], scrape: [] };
  const check = (k: MaskKind, shapes: Shape[]) => {
    const u = union(allPolys(shapes)), holes = u.reduce((a, poly) => a + poly.length - 1, 0);
    if (holes) fab[k].push({ level: 'error', text: `${holes} opening${holes > 1 ? 's enclose' : ' encloses'} a solid island; that part of the plate would fall out. Split the opening with a bridge.` });
    for (const s of shapes) {
      const o = outline(s);
      if (isConvex(o) && minWidth(o) < m.plate.minFeature) fab[k].push({ level: 'warn', text: `An opening is ${minWidth(o).toFixed(2)} mm wide, below the ${m.plate.minFeature} mm minimum feature.` });
    }
    const pcs = u.map((poly) => ringPoly(poly[0]));
    let bridge = Infinity;
    for (let i = 0; i < pcs.length; i++) for (let j = i + 1; j < pcs.length; j++) bridge = Math.min(bridge, gap(pcs[i], pcs[j]));
    if (bridge < m.plate.minFeature) fab[k].push({ level: 'warn', text: `Two openings are ${bridge.toFixed(2)} mm apart; the plate bridge between them is below the ${m.plate.minFeature} mm minimum.` });
    const out = allPolys(shapes).some((p) => p.some(([x, y]) => x < -1e-6 || y < -1e-6 || x > m.sub.w + 1e-6 || y > m.sub.h + 1e-6));
    if (out) fab[k].push({ level: 'warn', text: 'Some openings extend beyond the glass.' });
  };
  check('aperture', m.active); check('evaporation', [...m.active, ...m.conn]); check('scrape', m.scrape);
  if (m.plate.pocket && m.plate.pocketDepth >= m.plate.t) fab.evaporation.push({ level: 'error', text: 'The pocket is as deep as the plate is thick; the openings would have no material around them.' });

  return { pixels, counters, issues, fab, metalArea: regionArea(metal), activeTotal: pixels.reduce((a, p) => a + p.area, 0) };
}

// ---------------- export ----------------
const shapesFor = (m: MaskD, k: MaskKind) => (k === 'aperture' ? m.active : k === 'scrape' ? m.scrape : [...m.active, ...m.conn]);

/** Plate outline and openings in plate coordinates (origin at the plate corner, y down, mm). */
export function plateGeometry(m: MaskD, k: MaskKind) {
  const { margin: g, mirror, clearance } = m.plate, W = m.sub.w + 2 * g, H = m.sub.h + 2 * g;
  const tf = ([x, y]: Pt): Pt => [g + (mirror ? m.sub.w - x : x), g + y];
  const openings = union(polys2(shapesFor(m, k)).map((p) => p.map(tf)));
  const plate: Poly = [[0, 0], [W, 0], [W, H], [0, H]];
  const pocket: Poly = [[g - clearance, g - clearance], [g + m.sub.w + clearance, g - clearance], [g + m.sub.w + clearance, g + m.sub.h + clearance], [g - clearance, g + m.sub.h + clearance]];
  return { W, H, plate, openings, pocket, solid: diff(geom([plate]), openings) };
}
const polys2 = (shapes: Shape[]) => shapes.flatMap(polys);
const r4 = (v: number) => +v.toFixed(4);

/** 2D profile: plate with holes, filled with even-odd rule (Tinkercad extrudes the filled area). Units mm. */
export function maskSvg(m: MaskD, k: MaskKind) {
  const g = plateGeometry(m, k);
  const d = (r: Poly) => 'M' + r.map(([x, y]) => `${r4(x)},${r4(y)}`).join('L') + 'Z';
  const rings = [g.plate, ...g.openings.flatMap((poly) => poly.map(ringPoly))];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${r4(g.W)}mm" height="${r4(g.H)}mm" viewBox="0 0 ${r4(g.W)} ${r4(g.H)}">
  <title>${esc(MASK_LABEL[k])}, ${esc(m.subName)}${m.plate.mirror ? ', mirrored' : ''}</title>
  <path fill="#000" fill-rule="evenodd" d="${rings.map(d).join(' ')}"/>
</svg>
`;
}
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/** AutoCAD R12 DXF (widest compatibility): plate outline on layer PLATE, openings on layer OPENINGS, closed polylines, mm, y up. */
export function maskDxf(m: MaskD, k: MaskKind) {
  const g = plateGeometry(m, k), out: string[] = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const poly = (layer: string, r: Poly) => {
    out.push('0', 'POLYLINE', '8', layer, '66', '1', '70', '1');
    for (const [x, y] of r) out.push('0', 'VERTEX', '8', layer, '10', String(r4(x)), '20', String(r4(g.H - y)));
    out.push('0', 'SEQEND', '8', layer);
  };
  poly('PLATE', g.plate);
  if (m.plate.pocket) poly('POCKET', g.pocket);
  for (const p of g.openings) for (const r of p) poly('OPENINGS', ringPoly(r));
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n') + '\n';
}

type Tri = [number, number, number][];
/** Triangulated prism of a region between z0 and z1 (y flipped so the part reads the right way up). */
function extrude(region: MP, H: number, z0: number, z1: number): Tri[] {
  const tris: Tri[] = [];
  for (const poly of region) {
    const rings = poly.map((r) => ringPoly(r).map(([x, y]) => [x, H - y] as Pt));
    const flat: number[] = [], holes: number[] = [];
    rings.forEach((r, i) => { if (i) holes.push(flat.length / 2); r.forEach(([x, y]) => flat.push(x, y)); });
    const idx = earcut(flat, holes), P = (i: number): Pt => [flat[2 * i], flat[2 * i + 1]];
    for (let i = 0; i < idx.length; i += 3) {
      let [a, b, c] = [P(idx[i]), P(idx[i + 1]), P(idx[i + 2])];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0) [b, c] = [c, b]; // counter-clockwise from above
      tris.push([[a[0], a[1], z1], [b[0], b[1], z1], [c[0], c[1], z1]]); // top, normal +z
      tris.push([[a[0], a[1], z0], [c[0], c[1], z0], [b[0], b[1], z0]]); // bottom, normal -z
    }
    rings.forEach((r, i) => {
      const area = r.reduce((s, [x, y], j) => s + x * r[(j + 1) % r.length][1] - r[(j + 1) % r.length][0] * y, 0);
      const ring = (i === 0) === area > 0 ? r : [...r].reverse(); // outer CCW, holes CW: material on the left of each edge
      ring.forEach((a, j) => {
        const b = ring[(j + 1) % ring.length];
        tris.push([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1]], [[a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]]);
      });
    });
  }
  return tris;
}

/** ASCII STL of the mask plate (mm). With a pocket, the underside is a frame around the substrate and the openings go through the rest. */
export function maskStl(m: MaskD, k: MaskKind) {
  const g = plateGeometry(m, k), { t, pocket, pocketDepth } = m.plate;
  const tris = pocket && pocketDepth < t
    ? [...extrude(diff(geom([g.plate]), geom([g.pocket])), g.H, 0, pocketDepth), ...extrude(g.solid, g.H, pocketDepth, t)]
    : extrude(g.solid, g.H, 0, t);
  const f = (v: number) => v.toExponential(6);
  const lines = [`solid ${k}_mask`];
  for (const [a, b, c] of tris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1;
    lines.push(`facet normal ${f(n[0] / l)} ${f(n[1] / l)} ${f(n[2] / l)}`, 'outer loop', ...[a, b, c].map((p) => `vertex ${f(p[0])} ${f(p[1])} ${f(p[2])}`), 'endloop', 'endfacet');
  }
  lines.push(`endsolid ${k}_mask`);
  return { text: lines.join('\n') + '\n', facets: tris.length };
}

/** Volume of a closed triangle mesh (divergence theorem); used to sanity-check STL output. */
export function meshVolume(stl: string) {
  const v = [...stl.matchAll(/vertex (\S+) (\S+) (\S+)/g)].map((x) => [+x[1], +x[2], +x[3]]);
  let s = 0;
  for (let i = 0; i < v.length; i += 3) { const [a, b, c] = [v[i], v[i + 1], v[i + 2]]; s += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]); }
  return s / 6;
}

/** Suggested scrape area: where connection metal that carries no pixel lies over ITO (counter electrode contacts), grown by 0.5 mm. */
export function suggestScrape(m: MaskD): Shape[] {
  const ito = union(allPolys(m.sub.ito)), act = union(allPolys(m.active)), out: Shape[] = [];
  const metal = union([...allPolys(m.active), ...allPolys(m.conn)]); // connected metal pieces; edge-touching shapes merge
  for (const [i, poly] of metal.entries()) {
    const c: MP = [poly];
    if (regionArea(inter(c, act)) > 1e-9) continue; // carries a pixel: must not be scraped under
    const hit = inter(c, ito);
    if (regionArea(hit) < 1e-9) continue;
    const xs = hit.flat(2).map((p) => p[0]), ys = hit.flat(2).map((p) => p[1]);
    const x0 = Math.max(0, Math.min(...xs) - 0.5), y0 = Math.max(0, Math.min(...ys) - 0.5), x1 = Math.min(m.sub.w, Math.max(...xs) + 0.5), y1 = Math.min(m.sub.h, Math.max(...ys) + 0.5);
    out.push({ id: 'scr' + i + Date.now().toString(36), kind: 'rect', x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}
