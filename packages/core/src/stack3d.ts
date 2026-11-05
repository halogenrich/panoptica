// Device stack geometry for the 3D view. Each layer is made of parts: regions (mm, polygons with holes) with their own bottom
// height and a common flat top, so a layer fills down onto whatever is beneath it (glass where there is no ITO, ITO in the scrape zone).
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

/** Visual thickness: glass 1 mm; films 100 nm = 0.1 mm, with a minimum so nm-thin layers stay visible. Schematic, not to scale. */
export const VIS = { glass: 1, perNm: 0.001, min: 0.03 };
export const visMm = (nm: number) => Math.max(nm * VIS.perNm, VIS.min);

type MP = pc.MultiPolygon;
const EPS = 1e-6;
const toRegion = (mp: MP): Region => mp.map((poly) => poly.map((ring) => ring.slice(0, -1) as Poly));
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
        parts.push({ region: toRegion(hit), y0: c.top, ...(conformal ? { h } : {}) });
        hits.push({ region: hit, top: c.top });
        base = Math.max(base, c.top);
      }
    }
    if (!parts.length) return null;
    const top = base + h;
    cols = cols.flatMap((c) => {
      const rest = pc.difference(c.region, region);
      return regionArea(rest) > EPS ? [{ region: rest, top: c.top }] : [];
    });
    if (conformal) cols.push(...hits.map((x) => ({ region: x.region, top: x.top + h })));
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
    visMm(sub.t ?? 150),
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
