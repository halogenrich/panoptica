// Device stack geometry for the 3D view. Each layer is made of parts: regions (mm, polygons with holes) with their own bottom
// height and a common flat top, so a layer fills down onto whatever is beneath it (the metal onto the ITO in the scrape zone).
// The ITO is drawn as a coloured film on the glass, a few micrometres thick in the view; the first layer rests on it as one plain
// flat slab (no step cut out where the ITO is).
import pc from 'polygon-clipping';
import { SUBSTRATES, pattern, type SubKey } from './index';
import { allPolys, regionArea, union, type Poly, type Shape } from './geom';
import type { MaskD, SubstrateGeom } from './mask';

export type Region = Poly[][]; // polygons, each [outer, ...holes], rings without the closing point
export interface StackLayerIn {
  key: string;
  name: string;
  kind: 'film' | 'metal';
  mat: string;
  nm: number;
}
/** A part starts at y0; films end at the layer's common top, metal parts have their own thickness `h` (evaporated metal follows the surface). */
export interface Part {
  region: Region;
  y0: number;
  h?: number;
  /** a band of evaporated metal that coats a step up to the metal on the higher level (0.60.2) */
  wall?: boolean;
}
/** y0 = lowest bottom, h = top − y0 (visual mm). */
export interface Slab3 {
  key: string;
  kind: 'glass' | 'ito' | 'film' | 'metal';
  name: string;
  mat: string;
  label: string;
  y0: number;
  h: number;
  parts: Part[];
}

/**
 * Visual thickness: glass 1 mm; films 100 nm = 0.1 mm, with a minimum so nm-thin layers stay visible; the ITO a thin coloured
 * film whatever its thickness (its nm show in the label). Schematic, not to scale.
 */
export const VIS = { glass: 1, perNm: 0.001, min: 0.03, ito: 0.008 };
/** Steps smaller than this (the ITO edge) are not drawn: a layer over them is one flat slab. */
const STEP = 0.01;
export const visMm = (nm: number) => Math.max(nm * VIS.perNm, VIS.min);

type MP = pc.MultiPolygon;
const EPS = 1e-6;
const toRegion = (mp: MP): Region => mp.map((poly) => poly.map((ring) => ring.slice(0, -1) as Poly));
/** The region grown by d on every side (the union of its copies moved by d along the axes and diagonals). */
const grow = (mp: MP, d: number): MP => {
  const moved = [-d, 0, d].flatMap((dx) =>
    [-d, 0, d].map((dy) =>
      mp.map((poly) => poly.map((ring) => ring.map(([x, y]) => [x + dx, y + dy] as [number, number]))),
    ),
  ) as MP[];
  return pc.union(mp, ...moved);
};
const rect = (id: string, [x, y, w, h]: [number, number, number, number]): Shape => ({ id, kind: 'rect', x, y, w, h });

/** Geometry used by earlier versions (fixed sizes with placeholder pixel patterns), as a substrate + mask. */
export function legacyGeometry(
  sub: SubKey,
  pat?: string,
): { sub: SubstrateGeom; mask: Pick<MaskD, 'active' | 'conn' | 'scrape'> } {
  const k = sub in SUBSTRATES ? sub : '1.2 × 1.2 cm',
    S = SUBSTRATES[k],
    g = pattern(k, pat);
  return {
    sub: { w: S.w, h: S.h, ito: [rect('ito', S.ito)] },
    mask: {
      active: g.metal.map((r, i) => rect('m' + i, r)),
      conn: [],
      scrape: g.scrape.map((r, i) => rect('s' + i, r)),
    },
  };
}

/**
 * Glass, ITO, then the layers bottom to top. Films cover the glass except the scrape area; metal follows the mask (active areas +
 * connections). The surface is tracked as columns (region + height); each new layer starts on the columns below it and ends at one
 * flat top, so it fills steps instead of floating above them or cutting into them.
 */
export function buildStack(
  sub: SubstrateGeom & { t?: number },
  mask: Pick<MaskD, 'active' | 'conn' | 'scrape'> | null,
  layers: StackLayerIn[],
) {
  const glassP: Poly = [
      [0, 0],
      [sub.w, 0],
      [sub.w, sub.h],
      [0, sub.h],
    ],
    glass = union([glassP]);
  let cols: { region: MP; top: number }[] = [{ region: glass, top: VIS.glass }];
  const out: Slab3[] = [
    {
      key: 'glass',
      kind: 'glass',
      name: 'Glass',
      mat: 'Glass',
      label: `Glass · ${sub.w} × ${sub.h} mm`,
      y0: 0,
      h: VIS.glass,
      parts: [{ region: toRegion(glass), y0: 0 }],
    },
  ];
  /** conformal: each part keeps the layer thickness on what is under it (evaporated metal); otherwise one flat top (spin-coated films fill steps). */
  const place = (region: MP, h: number, conformal = false) => {
    const parts: Part[] = [];
    let base = -Infinity;
    const hits: { region: MP; top: number }[] = [];
    for (const c of cols) {
      const hit = pc.intersection(c.region, region);
      if (regionArea(hit) > EPS) {
        hits.push({ region: hit, top: c.top });
        base = Math.max(base, c.top);
      }
    }
    if (!hits.length) return null;
    // parts by bottom height; heights within STEP of each other are one part, with one flat bottom at the highest of them: a
    // film over the ITO edge rests on the ITO (a hair above the bare glass beside it, too thin to see) instead of sharing the
    // ITO's bottom plane, which flickered when the device was seen from below
    const levels: { y0: number; lo: number; region: MP }[] = [];
    for (const x of [...hits].sort((a, b) => a.top - b.top)) {
      const l = levels.find((v) => x.top - v.lo < STEP);
      if (l) {
        l.region = pc.union(l.region, x.region);
        l.y0 = Math.max(l.y0, x.top);
      } else levels.push({ y0: x.top, lo: x.top, region: x.region });
    }
    // 0.60.2: evaporated metal also coats the step where it goes down from one level to a lower one (the edge of the films at a
    // scrape area). Without it the metal stopped at the edge and started again at the bottom, so a contact pad looked cut in two.
    // The coat is a band of the lower part, as wide as the metal is thick, along the higher part's edge, up to its metal top.
    const walls: { region: MP; y0: number; h: number }[] = [];
    if (conformal)
      for (let j = levels.length - 1; j > 0; j--) {
        const near = grow(levels[j].region, h);
        for (let i = 0; i < j; i++) {
          const band = pc.intersection(levels[i].region, near);
          if (regionArea(band) <= EPS) continue;
          levels[i].region = pc.difference(levels[i].region, band);
          walls.push({ region: band, y0: levels[i].y0, h: levels[j].y0 + h - levels[i].y0 });
        }
      }
    for (const l of levels)
      if (regionArea(l.region) > EPS) parts.push({ region: toRegion(l.region), y0: l.y0, ...(conformal ? { h } : {}) });
    for (const w of walls) parts.push({ region: toRegion(w.region), y0: w.y0, h: w.h, wall: true });
    const top = base + h;
    cols = cols.flatMap((c) => {
      const rest = pc.difference(c.region, region);
      return regionArea(rest) > EPS ? [{ region: rest, top: c.top }] : [];
    });
    if (conformal)
      cols.push(
        ...levels.filter((l) => regionArea(l.region) > EPS).map((l) => ({ region: l.region, top: l.y0 + h })),
        ...walls.map((w) => ({ region: w.region, top: w.y0 + w.h })),
      );
    else cols.push({ region: pc.intersection(region, glass), top });
    const y0 = Math.min(...parts.map((p) => p.y0));
    return { parts, y0, h: top - y0 };
  };
  const add = (s: Omit<Slab3, 'y0' | 'h' | 'parts'>, region: MP, h: number, conformal = false) => {
    const p = place(region, h, conformal);
    if (p) out.push({ ...s, ...p });
  };

  add(
    { key: 'ito', kind: 'ito', name: 'ITO', mat: 'ITO', label: `ITO${sub.t ? ' · ' + sub.t + ' nm' : ''}` },
    union(allPolys(sub.ito)),
    VIS.ito,
  );
  const scrape = mask ? union(allPolys(mask.scrape)) : [];
  const film = scrape.length ? pc.difference(glass, scrape) : glass;
  const metal = mask ? union([...allPolys(mask.active), ...allPolys(mask.conn)]) : [];
  for (const l of layers) {
    add(
      {
        key: l.key,
        kind: l.kind,
        name: l.name,
        mat: l.mat,
        label: `${l.name}${l.mat && l.mat !== l.name ? ' · ' + l.mat : ''} · ${l.nm} nm`,
      },
      l.kind === 'metal' ? metal : film,
      visMm(l.nm),
      l.kind === 'metal',
    );
  }
  const height = Math.max(...out.map((s) => s.y0 + s.h));
  return { w: sub.w, h: sub.h, slabs: out, height };
}
