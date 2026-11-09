import { useEffect, useState } from 'react';
import { DEFAULT_HOURS, type WorkDay } from '@psc/core';
import { api } from '../api';

/**
 * The lab's working days and hours (Lab setup), fetched once and shared by the calendar, the booking form and the Overview.
 * Until they arrive: Monday to Friday, 08–18.
 */
let cache: WorkDay[] | null = null,
  pending: Promise<WorkDay[]> | null = null;
const listeners = new Set<(h: WorkDay[]) => void>();
export function refreshHours() {
  pending = api<{ hours: WorkDay[] }>('/lab')
    .then((l) => (cache = l.hours))
    .catch(() => (cache = DEFAULT_HOURS))
    .then((h) => {
      listeners.forEach((f) => f(h));
      return h;
    });
  return pending;
}
export function useHours(): WorkDay[] {
  const [h, setH] = useState<WorkDay[]>(cache ?? DEFAULT_HOURS);
  useEffect(() => {
    listeners.add(setH);
    if (!cache && !pending) refreshHours();
    return () => {
      listeners.delete(setH);
    };
  }, []);
  return h;
}

/** Birthdays (day and month) of the people who show theirs, keyed "MM-DD". */
export type Birthday = { id: number; name: string; md: string };
let bdays: Promise<Birthday[]> | null = null;
export function useBirthdays(): Map<string, Birthday[]> {
  const [m, setM] = useState<Map<string, Birthday[]>>(new Map());
  useEffect(() => {
    bdays ??= api<Birthday[]>('/lab/birthdays').catch(() => []);
    bdays.then((l) => {
      const x = new Map<string, Birthday[]>();
      for (const b of l) x.set(b.md, [...(x.get(b.md) ?? []), b]);
      setM(x);
    });
  }, []);
  return m;
}
export const mdOf = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const firstName = (n: string) => n.replace(/^(Prof\.?|Dr\.?)\s+/i, '').split(/\s+/)[0];
