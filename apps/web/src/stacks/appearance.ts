/** Look of a layer in the 3D view. Missing values use the layer's default. */
export interface Appearance { c?: string; o?: number; r?: number; m?: number }
export type Role = 'glass' | 'ito' | 'perov' | 'htl' | 'etl' | 'bcp' | 'metal' | 'other';

const METALS: Record<string, string> = { au: '#d4af37', ag: '#d0d4da', cu: '#b87333', al: '#b0b6bd' };

export function roleOf(s: { kind: string; name: string; mat: string }): Role {
  if (s.kind !== 'film') return s.kind as Role;
  const k = (s.name + ' ' + s.mat).toLowerCase();
  return /perovskite|pbi|pbbr|fapb|mapb|cs\d/.test(k) ? 'perov' : /htl|sam|pacz|spiro|ptaa|nio|p3ht|cuscn/.test(k) ? 'htl' : /bcp/.test(k) ? 'bcp' : /etl|c60|pcbm|sno2|tio2|icba/.test(k) ? 'etl' : 'other';
}

/** Default realistic look per kind of layer: c colour, o opacity, r roughness, m metallic. */
const DEF: Record<Role, Required<Appearance>> = {
  glass: { c: '#dfeaf2', o: 1, r: 0.06, m: 0 },
  ito: { c: '#7fa8ee', o: 0.4, r: 0.12, m: 0.05 }, // thin, transparent conductor: the glass shows through
  perov: { c: '#2b1b14', o: 1, r: 0.28, m: 0.1 },
  htl: { c: '#d98a2b', o: 1, r: 0.35, m: 0 },
  etl: { c: '#4a3b5c', o: 1, r: 0.4, m: 0 },
  bcp: { c: '#cfc8a8', o: 1, r: 0.5, m: 0 },
  metal: { c: '#cccccc', o: 1, r: 0.22, m: 1 },
  other: { c: '#9aa0a6', o: 1, r: 0.5, m: 0 },
};

export function defaultLook(s: { kind: string; name: string; mat: string }): Required<Appearance> {
  const r = roleOf(s), d = DEF[r];
  return r === 'metal' ? { ...d, c: METALS[s.mat.toLowerCase()] ?? d.c } : d;
}
export const lookOf = (s: { kind: string; name: string; mat: string }, ap?: Appearance): Required<Appearance> => ({ ...defaultLook(s), ...clean(ap) });
const clean = (ap?: Appearance) => Object.fromEntries(Object.entries(ap ?? {}).filter(([, v]) => v !== undefined && v !== null)) as Appearance;
export const isCustom = (ap?: Appearance) => !!ap && Object.keys(clean(ap)).length > 0;
