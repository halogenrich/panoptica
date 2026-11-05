import { buildStack, legacyGeometry, metalStages, newId, type MaskD, type StackLayerIn, type SubstrateGeom } from '@psc/core';
import type { Ctx, Rec } from '../recipes/types';
import type { ViewSlab } from './Viewer3D';
import type { Appearance } from './appearance';

export type Method = 'Substrate' | 'Spin' | 'Organic evap' | 'Metal evap' | 'Manual';
export const METHODS: Method[] = ['Substrate', 'Spin', 'Organic evap', 'Metal evap', 'Manual'];
/** One layer of a stack: method + preset ids (`a`; for spin coating `a` = solution, `b` = spin program), thickness for films. */
/** `ap`: look of the layer in the 3D view (for the substrate slot: the ITO; `apGlass`: the glass). */
export interface Slot { id?: string; n: string; m: Method; a: string; b: string; t: string; th?: number; ap?: Appearance; apGlass?: Appearance }
export interface StackD { arch: string; sl: Slot[]; thumb?: string; bid?: string }

export const TEMPLATES: Record<string, [string, Method][]> = {
  'p-i-n': [['Substrate', 'Substrate'], ['HTL / SAM', 'Spin'], ['Perovskite', 'Spin'], ['Passivation', 'Spin'], ['ETL (C60)', 'Organic evap'], ['BCP', 'Organic evap'], ['Metal contact', 'Metal evap']],
  'n-i-p': [['Substrate', 'Substrate'], ['ETL', 'Spin'], ['Perovskite', 'Spin'], ['HTL', 'Spin'], ['Metal contact', 'Metal evap']],
};
export const slotsFor = (arch: string): Slot[] => TEMPLATES[arch].map(([n, m]) => ({ id: newId(), n, m, a: '', b: '', t: '' }));
export const SEG: Record<Method, string | null> = { Substrate: 's0', Spin: 's1', 'Organic evap': 's3', 'Metal evap': 's4', Manual: null };
export const slotKey = (s: Slot, i: number) => s.id ?? 's' + i;

const get = (ctx: Ctx, id: string) => (id ? ctx.all.find((p) => String(p.id) === id) : undefined);
export const presetName = (ctx: Ctx, id: string) => get(ctx, id)?.name ?? '';

/** A slot has content to draw once its main preset (or, for manual steps, a thickness) is chosen. */
export const slotReady = (s: Slot) => (s.m === 'Manual' ? !!s.th || !!s.t : !!s.a);

/** Default film thickness when the user has not entered one (spin coating has no thickness in its recipe). */
function thickness(s: Slot, ctx: Ctx) {
  const d = get(ctx, s.a)?.data;
  if (s.m === 'Organic evap') return d?.th ?? 30;
  if (s.m === 'Metal evap') return d?.st ? metalStages(d.st).final : 100;
  return s.th || (/perovskite/i.test(s.n) ? 500 : /sam|pacz/i.test(s.n + ' ' + (get(ctx, s.a)?.name ?? '')) ? 2 : 50);
}
export function slotMaterial(s: Slot, ctx: Ctx) {
  const p = get(ctx, s.a), d = p?.data;
  if (!d) return s.n;
  if (s.m === 'Organic evap') return d.mat ?? p!.name;
  if (s.m === 'Metal evap') return d.met ?? 'Metal';
  if (s.m === 'Spin') return d.mode === 'Perovskite' ? p!.name : d.sol || p!.name;
  return s.n;
}

/** The substrate and mask the stack uses: from the substrate prep and metal recipes, falling back to the earlier fixed geometry. */
export function geometryOf(st: StackD, ctx: Ctx): { sub: SubstrateGeom; mask: Pick<MaskD, 'active' | 'conn' | 'scrape'> | null; subId: string; maskSubId: string } {
  const prep = st.sl.find((s) => s.m === 'Substrate'), met = st.sl.find((s) => s.m === 'Metal evap');
  const pd = prep && get(ctx, prep.a)?.data, md = met && get(ctx, met.a)?.data;
  const mask: MaskD | null = md?.mask ?? null;
  const sub = pd?.design ?? mask?.sub ?? null;
  if (sub) return { sub, mask, subId: pd?.subId ?? mask?.subId ?? '', maskSubId: mask?.subId ?? '' };
  const lg = legacyGeometry(pd?.sub ?? md?.sub ?? '1.2 × 1.2 cm', md?.pat);
  return { sub: lg.sub, mask: md ? lg.mask : null, subId: '', maskSubId: '' };
}

/**
 * 3D layers with their state. Slots before `placed` are solid; the slot being edited (index `current`) is a ghost preview
 * if it is not placed yet; later slots are hidden. Glass and ITO follow the substrate slot.
 */
export function viewSlabs(st: StackD, ctx: Ctx, placed = Infinity, current = -1) {
  const g = geometryOf(st, ctx);
  const state = (i: number): 'solid' | 'ghost' | null => (i < placed ? 'solid' : i === current ? 'ghost' : null);
  const layers: (StackLayerIn & { state: 'solid' | 'ghost' })[] = [];
  st.sl.forEach((s, i) => {
    const stt = state(i);
    if (!stt || s.m === 'Substrate' || !slotReady(s)) return;
    layers.push({ key: slotKey(s, i), name: s.n, kind: s.m === 'Metal evap' ? 'metal' : 'film', mat: slotMaterial(s, ctx), nm: thickness(s, ctx), state: stt });
  });
  const b = buildStack(g.sub, g.mask, layers);
  const subIdx = st.sl.findIndex((s) => s.m === 'Substrate'), subState = subIdx < 0 ? 'solid' : state(subIdx);
  const slabs: ViewSlab[] = b.slabs.flatMap((s) => {
    const sub = subIdx >= 0 ? st.sl[subIdx] : undefined;
    if (s.kind === 'glass' || s.kind === 'ito') return subState ? [{ ...s, state: subState, ap: s.kind === 'glass' ? sub?.apGlass : sub?.ap }] : [];
    const i = st.sl.findIndex((x, j) => slotKey(x, j) === s.key);
    return [{ ...s, state: layers.find((l) => l.key === s.key)!.state, ap: st.sl[i]?.ap }];
  });
  return { slabs, w: b.w, h: b.h, mismatch: !!(g.subId && g.maskSubId && g.subId !== g.maskSubId) };
}

/** Name of the substrate design a recipe preset is tied to (for blocking a metal recipe made for another substrate). */
export const substrateOfPreset = (p: Rec | undefined): string => (p?.data?.mask?.subId ?? p?.data?.subId ?? '') as string;
