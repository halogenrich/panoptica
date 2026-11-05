import { useContext, useEffect, useState } from 'react';
import { api } from '../api';
import { PrefCtx } from '../ctx';

/** Group logo and name for exported figures (one for the app, set by an admin). */
export type FigureSettings = { watermark?: string; group?: string };
let cache: Promise<FigureSettings> | null = null;
const subs = new Set<(f: FigureSettings) => void>();
const load = () => (cache ??= api<FigureSettings>('/settings/figure').catch(() => ({})));

export function useFigureSettings(): FigureSettings {
  const [f, setF] = useState<FigureSettings>({});
  useEffect(() => { let on = true; load().then((x) => on && setF(x)); subs.add(setF); return () => { on = false; subs.delete(setF); }; }, []);
  return f;
}
export async function saveFigureSettings(p: FigureSettings) {
  const d = await api<FigureSettings>('/settings/figure', 'PUT', p);
  cache = Promise.resolve(d); subs.forEach((s) => s(d));
  return d;
}

/** Per-user choice whether exported figures carry the group logo (remembered in the user's settings). */
export function useLogoChoice(): [boolean, (v: boolean) => void] {
  const { prefs, set } = useContext(PrefCtx);
  return [prefs.logo !== false, (v) => set({ logo: v })];
}
