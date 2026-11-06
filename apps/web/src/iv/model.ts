import {
  SPACERS,
  allPolys,
  analyzeMask,
  boxStats,
  formula,
  layered,
  plan,
  type IvMetrics,
  type MaskD,
  type Pt,
} from '@psc/core';
import { api } from '../api';

export type Dir = 'fwd' | 'rev';
export interface Curve {
  id: number;
  sample: string;
  substrate: string;
  scan: string;
  pixel: string;
  dir: Dir;
  file: string;
  area: number;
  pin: number;
  V: number[];
  J: number[];
  m: IvMetrics;
  inst: { pce?: number | null; ff?: number | null; jsc?: number | null; voc?: number | null } | null;
  use: boolean | null;
  /** 'check': a quick exploratory scan before the real measurement of the pixel (set by the server); never counted unless ticked in */
  kind?: 'check' | null;
}
export type Link = { kind: 'batch' | 'stack'; id: number; label?: string } | null;
export interface IvSet {
  id: number;
  name: string;
  date: string;
  system: 'padrao' | 'sun';
  visibility: 'private' | 'shared';
  owner: string;
  created_at: string;
  samples: string[];
  substrates: number;
  curves: number;
  working: number;
  best: number;
  links: Record<string, Link>;
  mine?: boolean;
  /** per device "sample|substrate": device group and whether it is left out of the plots */
  devices?: Record<string, { g?: string; off?: boolean }>;
  /** Stability test: the first measurement of the series this one follows, when it was measured, and how many follow-ups it has. */
  stabilityOf?: number | null;
  measuredAt?: string;
  followUps?: number;
}
export interface IvSetFull extends Omit<IvSet, 'curves'> {
  notes: string;
  editable: boolean;
  rawLinks: Record<string, Link>;
  curves: Curve[];
}

export const SYSTEM: Record<string, string> = { padrao: '8-pixel system (Padrão)', sun: '1.5 × 2.5 system' };
export const METRICS = [
  { key: 'pce', label: 'PCE', unit: '%', digits: 2 },
  { key: 'voc', label: 'Voc', unit: 'V', digits: 3 },
  { key: 'jsc', label: 'Jsc', unit: 'mA/cm²', digits: 2 },
  { key: 'ff', label: 'FF', unit: '%', digits: 1 },
  { key: 'rs', label: 'Rs', unit: 'Ω·cm²', digits: 1 },
  { key: 'rsh', label: 'Rsh', unit: 'Ω·cm²', digits: 0 },
] as const;
export type MetricKey = (typeof METRICS)[number]['key'];

/** Pixel sort: numbers numerically, then letters (A1, A2, B1…). */
export const pixelOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
export const scanOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export const isCheck = (c: { kind?: string | null }) => c.kind === 'check';
/** May count: ticked in by hand, or (not left out) a working pixel that is not a check sweep. For "best of" picks. */
export const counts = (c: { kind?: string | null; use: boolean | null; m: { status?: string } }) =>
  c.use === true || (c.use === null && c.m.status === 'ok' && !isCheck(c));
/** Counted unless a person decided otherwise: working pixel, not a check sweep. */
const candidate = (c: Curve) => c.use !== false && c.m.status === 'ok' && !isCheck(c) && Number.isFinite(c.m.pce);
/**
 * Whether a curve counts in the statistics. An explicit choice wins; otherwise only working pixels (not dead or shorted), never a
 * check sweep, and when a pixel was measured more than once, its best scan (highest PCE) in each direction.
 */
export function inStats(c: Curve, all: Curve[]): boolean {
  if (c.use !== null) return c.use;
  if (!candidate(c)) return false;
  const same = all.filter(
    (x) => x.sample === c.sample && x.substrate === c.substrate && x.pixel === c.pixel && x.dir === c.dir,
  );
  if (same.some((x) => x.use === true)) return false;
  const best = same
    .filter(candidate)
    .sort((a, b) => a.m.pce - b.m.pce || scanOrder(a.scan, b.scan))
    .pop();
  return best?.id === c.id;
}

/** The curve shown for a pixel on the substrate map: the one used in the statistics, else the latest real (not check) scan. */
export function shownCurve(curves: Curve[], all: Curve[], dir: Dir): Curve | undefined {
  const d = curves.filter((c) => c.dir === dir);
  const late = (xs: Curve[]) => [...xs].sort((a, b) => scanOrder(a.scan, b.scan)).pop();
  return d.find((c) => inStats(c, all)) ?? late(d.filter((c) => !isCheck(c))) ?? late(d);
}

export const groupKey = (l: Link, sample: string) => (l ? `${l.kind}:${l.id}` : `sample:${sample}`);
export const groupLabel = (l: Link, sample: string) =>
  l?.label ? l.label : `${sample.replace(/_/g, ' ')} (not linked)`;

/** Categorical palette (fixed order, validated for colour-blind separation on adjacent slots). */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const seriesColor = (i: number) => `var(--series-${(i % 8) + 1})`;
/** Sequential blue for PCE on the pixel map (light → dark). */
const SEQ = [
  '#cde2fb',
  '#b7d3f6',
  '#9ec5f4',
  '#86b6ef',
  '#6da7ec',
  '#5598e7',
  '#3987e5',
  '#2a78d6',
  '#256abf',
  '#1c5cab',
  '#184f95',
];
export function pceFill(pce: number, max: number) {
  const i = Math.max(0, Math.min(SEQ.length - 1, Math.round((pce / (max || 1)) * (SEQ.length - 1))));
  return { fill: SEQ[i], ink: i >= 6 ? '#fff' : '#0b0b0b' };
}

export const fmt = (x: number | null | undefined, d = 2) =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d);

/** The device as designed: substrate, ITO, scrape area, all metal and the pixels, from the mask used by a batch or stack. */
export interface CellGeom {
  w: number;
  h: number;
  ito: Pt[][];
  scrape: Pt[][];
  metal: Pt[][];
  met: string;
  pixels: { n: number; at: Pt; shape: Pt[] }[];
}
const geomCache = new Map<string, Promise<CellGeom | null>>();
/** Forget the cached cell drawings (after a mask's pixel order was changed). */
export const clearGeomCache = () => geomCache.clear();

/**
 * Pixel numbering from the newest version of the mask. A batch keeps a frozen copy of its mask (and a metal recipe keeps the copy
 * it was made with), but pixel numbers describe how the mask maps to the J–V system, so a later reordering of the same pixels applies
 * to old batches too. Used only when the newest version has the same pixels in the same places; otherwise the frozen order stays.
 */
async function currentOrder<P extends { n: number; at: Pt }>(frozen: P[], maskId?: string): Promise<P[]> {
  if (!maskId) return frozen;
  try {
    const m = await api<any>(`/presets/${maskId}`);
    const versions = [
      ...(m.family ?? []).filter((f: any) => !f.hidden && f.data?.active),
      { ...m, updated_at: m.updated_at },
    ].sort((a: any, b: any) => String(b.updated_at).localeCompare(String(a.updated_at)));
    for (const v of versions) {
      const now = analyzeMask(v.data as MaskD).pixels;
      if (now.length !== frozen.length) continue;
      const match = frozen.map((p) => now.find((q) => Math.hypot(q.at[0] - p.at[0], q.at[1] - p.at[1]) < 0.05));
      if (match.every(Boolean) && new Set(match).size === frozen.length)
        return frozen.map((p, i) => ({ ...p, n: match[i]!.n })).sort((a, b) => a.n - b.n);
    }
  } catch {
    /* mask not visible or deleted: keep the frozen order */
  }
  return frozen;
}
export function cellGeom(l: Link): Promise<CellGeom | null> {
  if (!l) return Promise.resolve(null);
  const k = `${l.kind}:${l.id}`;
  if (!geomCache.has(k))
    geomCache.set(
      k,
      (async () => {
        let rec: { met?: string; mask?: MaskD | null } | null = null;
        if (l.kind === 'batch') {
          const b = await api<any>(`/batches/${l.id}`);
          const i = (b.snapshot?.stack?.sl ?? []).findIndex((s: any) => s.m === 'Metal evap');
          rec = i >= 0 ? (b.snapshot.resolved?.[i]?.a?.data ?? null) : null;
        } else {
          const st = await api<any>(`/presets/${l.id}`),
            slot = (st.data?.sl ?? []).find((s: any) => s.m === 'Metal evap');
          rec = slot?.a ? ((await api<any>(`/presets/${slot.a}`)).data ?? null) : null;
        }
        const mask = rec?.mask;
        if (!mask?.active?.length)
          return rec?.met ? { w: 0, h: 0, ito: [], scrape: [], metal: [], met: rec.met, pixels: [] } : null;
        const pixels = await currentOrder(analyzeMask(mask).pixels, (rec as any)?.maskId);
        return {
          w: mask.sub.w,
          h: mask.sub.h,
          ito: allPolys(mask.sub.ito) as Pt[][],
          scrape: allPolys(mask.scrape) as Pt[][],
          metal: [...allPolys(mask.active), ...allPolys(mask.conn)] as Pt[][],
          met: rec?.met ?? 'Ag',
          pixels: pixels.map((p) => ({ n: p.n, at: p.at, shape: p.shape })),
        };
      })().catch(() => null),
    );
  return geomCache.get(k)!;
}

/** Rows for statistics: one per curve in the statistics, with its group. */
export interface StatRow {
  set: string;
  date: string;
  group: string;
  gkey: string;
  sample: string;
  substrate: string;
  pixel: string;
  scan: string;
  dir: Dir;
  m: IvMetrics;
}
export function statRows(sets: IvSetFull[], dir: Dir | 'both'): StatRow[] {
  return sets.flatMap((s) =>
    s.curves
      .filter(
        (c) =>
          (dir === 'both' || c.dir === dir) && inStats(c, s.curves) && !s.devices?.[`${c.sample}|${c.substrate}`]?.off,
      )
      .map((c) => {
        const l = s.links[c.sample] ?? null,
          g = s.devices?.[`${c.sample}|${c.substrate}`]?.g?.trim();
        return {
          set: s.name,
          date: s.date,
          group: g || groupLabel(l, c.sample),
          gkey: g ? `group:${g.toLowerCase()}` : groupKey(l, c.sample),
          sample: c.sample,
          substrate: c.substrate,
          pixel: c.pixel,
          scan: c.scan,
          dir: c.dir,
          m: c.m,
        };
      }),
  );
}
/** A pixel has a usable value for this parameter (Rs/Rsh can be missing; Rsh is plotted on a log axis, so it must be positive). */
export const hasValue = (r: StatRow, k: MetricKey) => {
  const v = r.m[k];
  return typeof v === 'number' && Number.isFinite(v) && (k !== 'rsh' || v > 0);
};
export const summarize = (rows: StatRow[], k: MetricKey) => boxStats(rows.map((r) => r.m[k] as number));

export function toCsv(rows: StatRow[]): string {
  const h = [
    'group',
    'measurement',
    'date',
    'sample',
    'substrate',
    'pixel',
    'scan',
    'direction',
    'PCE (%)',
    'Voc (V)',
    'Jsc (mA/cm2)',
    'FF (%)',
    'Vmp (V)',
    'Jmp (mA/cm2)',
    'Rs (Ohm cm2)',
    'Rsh (Ohm cm2)',
  ];
  const q = (v: unknown) => {
    const s = v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    h,
    ...rows.map((r) => [
      r.group,
      r.set,
      r.date,
      r.sample,
      r.substrate,
      r.pixel,
      r.scan,
      r.dir === 'rev' ? 'backward' : 'forward',
      r.m.pce,
      r.m.voc,
      r.m.jsc,
      r.m.ff,
      r.m.vmp,
      r.m.jmp,
      r.m.rs,
      r.m.rsh,
    ]),
  ]
    .map((r) => r.map(q).join(','))
    .join('\n');
}
export function download(name: string, text: string, type = 'text/csv') {
  const a = document.createElement('a'),
    url = URL.createObjectURL(new Blob([text], { type }));
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Layer order of the device (bottom → top) and its architecture, from the linked batch (frozen) or stack. */
export interface DeviceInfo {
  arch: string;
  layers: string[];
}
const infoCache = new Map<string, Promise<DeviceInfo | null>>();
const layerName = (slot: any, a: any, _b: any): string => {
  switch (slot.m) {
    case 'Substrate':
      return 'ITO';
    case 'Spin': {
      if (!(a?.mode === 'Perovskite' && a.A && a.X)) return a?.sol || slot.n;
      const fits = (x: (typeof SPACERS)[number]) => x.z === (a.dim === 'DJ' ? 2 : 1);
      const sp = ['RP', 'DJ'].includes(a.dim)
        ? (SPACERS.find((x) => x.ion === a.L && fits(x)) ?? SPACERS.find(fits))
        : undefined;
      return sp ? layered({ A: a.A, X: a.X, L: sp, n: Math.max(1, a.n || 1) }) : formula(plan({ A: a.A, X: a.X }));
    }
    case 'Organic evap':
      return a?.mat || slot.n;
    case 'Metal evap':
      return a?.met || slot.n;
    default:
      return slot.n;
  }
};
export function deviceInfo(l: Link): Promise<DeviceInfo | null> {
  if (!l) return Promise.resolve(null);
  const k = `${l.kind}:${l.id}`;
  if (!infoCache.has(k))
    infoCache.set(
      k,
      (async () => {
        if (l.kind === 'batch') {
          const b = await api<any>(`/batches/${l.id}`),
            st = b.snapshot?.stack;
          return {
            arch: st?.arch ?? '',
            layers: (st?.sl ?? []).map((s: any, i: number) =>
              layerName(s, b.snapshot.resolved?.[i]?.a?.data, b.snapshot.resolved?.[i]?.b?.data),
            ),
          };
        }
        const st = (await api<any>(`/presets/${l.id}`)).data;
        const get = (id: string) =>
          id
            ? api<any>(`/presets/${id}`)
                .then((p) => p.data)
                .catch(() => null)
            : Promise.resolve(null);
        const layers = await Promise.all(
          (st?.sl ?? []).map(async (s: any) => layerName(s, await get(s.a), await get(s.b))),
        );
        return { arch: st?.arch ?? '', layers };
      })().catch(() => null),
    );
  return infoCache.get(k)!;
}
