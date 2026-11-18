import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Booking, Data } from '../views/Calendar';

/** Pieces the phone layout's tabs share (0.55): times, days, the calendar of a period, a booking's card. */

const pad = (n: number) => String(n).padStart(2, '0');
export const hm = (s: string | Date) => {
  const d = new Date(s);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const dmy = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
/** yyyy-mm-dd of the local day (for date inputs) */
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const weekday = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'long' });
/** "Today", "Tomorrow", "Thursday 20/11/2026" */
export function dayName(d: Date) {
  const t = startOfDay(new Date()),
    diff = Math.round((startOfDay(d).getTime() - t.getTime()) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return `${weekday(d)} ${dmy(d)}`;
}

/** The same inside a sentence: "today", "tomorrow", "Thursday 20/11/2026". */
export const dayIn = (d: Date) => dayName(d).replace(/^(Today|Tomorrow|Yesterday)$/, (w) => w.toLowerCase());

export type Cal = Data;
/** The calendar from `from` for `days` days; read again when bookings change, here or on another screen (live updates). */
export function useCal(from: Date, days: number) {
  const [d, setD] = useState<Cal | null>(null),
    [err, setErr] = useState('');
  const load = () =>
    api<Cal>(`/calendar?from=${from.toISOString()}&to=${addDays(from, days).toISOString()}`)
      .then((x) => {
        setD(x);
        setErr('');
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    const f = () => load();
    window.addEventListener('psc-bookings', f);
    return () => window.removeEventListener('psc-bookings', f);
  }, [from.getTime(), days]);
  return { d, err, load };
}

/** What a booking is for: the batch and its step, or the purpose written for it. */
export const forWhat = (k: Booking) =>
  k.subject ? [k.subject_name || k.subject_code, k.step].filter(Boolean).join(', ') : k.purpose || k.note || '';

const OUTCOME: Record<string, string> = { done: 'Concluded', postponed: 'Postponed', canceled: 'Canceled' };

/** A booking on the phone: its time in large figures, the equipment (its colour as a bar under the name), what it is for. */
export function BookingRow({ k, big, who }: { k: Booking; big?: boolean; who?: boolean }) {
  const ended = new Date(k.end).getTime() < Date.now();
  return (
    <div className={'ph-book' + (big ? ' big' : '') + (k.outcome === 'canceled' ? ' gone' : '')}>
      <div className="ph-time">
        {hm(k.start)}
        {/* stacked in lists (start over end), on one line in large figures */}
        <span>
          {big ? '–' : ''}
          {hm(k.end)}
        </span>
      </div>
      <div className="ph-book-b">
        <b className="ph-eq" style={{ '--c': k.color } as React.CSSProperties}>
          {k.equipment}
        </b>
        <div className="ph-what">{forWhat(k)}</div>
        {(who || k.outcome || (ended && k.mine)) && (
          <div className="mut small">
            {[who ? k.user_name : '', k.outcome ? OUTCOME[k.outcome] : ended && k.mine ? 'Ended, not answered yet' : '']
              .filter(Boolean)
              .join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}
