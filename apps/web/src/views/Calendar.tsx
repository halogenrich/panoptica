import EquipmentArt, { artOf } from '../lib/EquipmentArt';
import { Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { MeCtx } from '../ctx';
import { Seg } from '../lib/ui';
import { showToast, useRefresh } from '../lib/trash';
import { firstName, mdOf, useBirthdays, useHours } from '../lib/hours';
import { minutesOf, stepLabel, withinHours, workDayOf, type WorkDay } from '@psc/core';
import { batchesChanged } from './Batches';
import { ROLE_NAME, autoSplit, bundlesOf, eqCandidates, placedOf, type Bundle } from '../lib/bundles';
import type { StackD } from '../stacks/model';

export type Eq = {
  id: number;
  name: string;
  color: string;
  pos: number;
  active: boolean | number;
  role: string;
  /** booked by itself (false: inside other equipment, or used freely) */
  booked?: boolean;
  /** the steps it can do (0.38) */
  steps?: string[];
  parent_id?: number | null;
  place_id?: number | null;
  /** shortest booking, minutes */
  min_booking?: number;
  /** O₂ and H₂O are recorded after each booking */
  atmosphere?: boolean;
  people?: { id: number; name: string }[];
  /** minutes blocked after each booking for cleaning (gloveboxes: 20) */
  cleanup?: number;
  /** the drawing ('' = from its use and name) */
  art?: string;
};
export type Booking = {
  id: number;
  equipment_id: number;
  /** what it is for (0.41): a subject a module defines ('batch'), or '' for a booking outside one, for `purpose` */
  subject: string;
  subject_id: number | null;
  purpose: string;
  user_id: number;
  step: string;
  note: string;
  start: string;
  end: string;
  forced: boolean;
  equipment: string;
  color: string;
  subject_code: string;
  subject_name: string;
  subject_status: string;
  /** what the subject is called ('batch') */
  subject_noun: string;
  /** booked on measuring equipment (J–V measurement, say) */
  measuring?: boolean;
  user_name: string;
  mine: boolean;
  editable: boolean;
  outcome?: 'done' | 'postponed' | 'canceled' | null;
  reason?: string;
};
/** Something bookings can be for, from a module: a batch, say. */
type Choice = { subject: string; noun: string; id: number; code: string; name: string; status?: string };
/** A step equipment can do, from a module. */
export type StepDef = { key: string; label: string; group: string; module: string; measures?: boolean };
type Data = {
  equipment: Eq[];
  steps: StepDef[];
  bookings: Booking[];
  /** what this person can book for: open subjects, and finished ones (for measuring equipment) */
  open: Choice[];
  /** equipment this user is trained on (0.38), and out-of-service periods in view */
  trained: number[];
  off: Off[];
  finished: Choice[];
};
type View = 'day' | 'week' | 'month';
type Draft = Partial<Booking> & { start: string; end: string };

// ------------------------------------------------------------------ dates (local time)
const DAY = 864e5,
  HOUR_PX = 44,
  SNAP = 15,
  /** shortest booking, in minutes (the server refuses shorter ones) */
  MIN_BOOK = 60;
/**
 * The booking of the same equipment that a new time would clash with, if any. The cleanup after each booking counts as taken,
 * both after the existing booking and after the new one.
 */
type Off = { id: number; equipment_id: number; start: string; end: string; reason: string };
/** An out-of-service period of the equipment over a time (0.38). */
const offOf = (off: Off[] | undefined, eq: number | undefined, s: number, e: number) =>
  (off ?? []).find((o) => o.equipment_id === eq && new Date(o.end).getTime() > s && new Date(o.start).getTime() < e);
function clashOf(list: Booking[], eqs: Eq[], eq: number | undefined, s: number, e: number, except?: number) {
  const cl = (eqs.find((x) => x.id === eq)?.cleanup ?? 0) * 6e4;
  return list.find(
    (o) =>
      o.equipment_id === eq &&
      o.id !== except &&
      new Date(o.end).getTime() + cl > s &&
      new Date(o.start).getTime() < e + cl,
  );
}
const sod = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monday = (d: Date) => addDays(sod(d), -((d.getDay() + 6) % 7));
const sameDay = (a: Date, b: Date) => sod(a).getTime() === sod(b).getTime();
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; // 24 h, as on the time axis
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const at = (day: string, time: string) => new Date(`${day}T${time}`);
function range(v: View, d: Date): [Date, Date] {
  if (v === 'day') return [sod(d), addDays(sod(d), 1)];
  if (v === 'week') return [monday(d), addDays(monday(d), 7)];
  const first = monday(new Date(d.getFullYear(), d.getMonth(), 1));
  return [first, addDays(first, 42)];
}
function title(v: View, d: Date, short = false) {
  if (short && v === 'day') return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  if (short && v === 'week') {
    const [a, b] = range('week', d);
    return `${a.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} – ${addDays(b, -1).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
  }
  if (v === 'day')
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (v === 'month') return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const [a, b] = range('week', d),
    e = addDays(b, -1);
  return a.getMonth() === e.getMonth()
    ? `${a.getDate()}–${e.getDate()} ${e.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`
    : `${a.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} – ${e.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}
/** First name, or first and second name when two people in view share the first one. */
function namer(list: Booking[]) {
  const full = [...new Set(list.map((b) => b.user_name))],
    first = (n: string) => n.replace(/^(Prof\.?|Dr\.?)\s+/i, '').split(/\s+/);
  return (n: string) => {
    const p = first(n);
    return full.some((o) => o !== n && first(o)[0] === p[0]) ? p.slice(0, 2).join(' ') : p[0];
  };
}
/** Bookings start from now on: a minute of grace for the time it takes to drop a block. */
const PAST_GRACE = 60_000;
const PAST = 'That time has passed: bookings start from now on';
const what = (b: Booking) => (b.subject ? `${b.subject_code}${b.step ? ` (${b.step})` : ''}` : b.purpose);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** Equipment that can do a measuring step (J–V measurement, say) takes finished work. */
const measuringEq = (e: Eq | undefined, steps: StepDef[]) =>
  !!e && (e.steps ?? []).some((k) => steps.find((s) => s.key === k)?.measures);
/** Short equipment names for small blocks: "Evaporator 2 (organic)" → "Evaporator 2". The full name is in headers and the hover card. */
const shortEq = (n: string) => n.replace(/\s*\(.*\)\s*$/, '').trim() || n;
/** The first time from `t` at which a 1-hour booking fits in the working hours (looks a week ahead; else `t`). */
function nextWorking(h: WorkDay[], t: Date): Date {
  for (let i = 0; i < 8; i++) {
    const d = addDays(sod(t), i),
      w = workDayOf(h, d);
    if (!w.on) continue;
    const from = minutesOf(w.from),
      to = minutesOf(w.to),
      now = i ? 0 : t.getHours() * 60 + t.getMinutes(),
      m = Math.max(now, from);
    if (m + 60 <= to) return new Date(d.getTime() + m * 6e4);
  }
  return t;
}
/** A small cake, for birthdays in the calendar. */
const Cake = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <path d="M2.5 14h11V9a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 9z" />
    <path d="M2.5 11c1.2 0 1.6-1 2.75-1S6.9 11 8 11s1.6-1 2.75-1 1.55 1 2.75 1M8 7.5V5.5" />
    <path d="M8 2.2c.7.8.9 1.5 0 2.3-.9-.8-.7-1.5 0-2.3z" fill="currentColor" />
  </svg>
);
/** Booked, or moved, outside the lab's working days and hours: allowed, and the admins are told (the server does). */
const OFF_HOURS = 'Outside working hours: booked, and the admins were told';
/** The stretches of a day outside working hours, in minutes from midnight (the whole day when it is not a working day). */
const offStretches = (w: WorkDay): [number, number][] =>
  !w.on
    ? [[0, 24 * 60]]
    : (
        [
          [0, minutesOf(w.from)],
          [minutesOf(w.to), 24 * 60],
        ] as [number, number][]
      ).filter(([a, b]) => b > a);
const ended = (b: Booking) => new Date(b.end) < new Date();

/** Side-by-side lanes for overlapping bookings in one column. */
function lanes(list: Booking[]) {
  const s = [...list].sort((a, b) => a.start.localeCompare(b.start)),
    out = new Map<number, { lane: number; of: number }>();
  let group: Booking[] = [],
    end = '';
  const flush = () => {
    const ends: string[] = [];
    const idx = new Map<number, number>();
    for (const b of group) {
      let l = ends.findIndex((e) => e <= b.start);
      if (l < 0) {
        l = ends.length;
        ends.push('');
      }
      ends[l] = b.end;
      idx.set(b.id, l);
    }
    for (const b of group) out.set(b.id, { lane: idx.get(b.id)!, of: ends.length });
    group = [];
  };
  for (const b of s) {
    if (group.length && b.start >= end) flush();
    group.push(b);
    end = !end || b.end > end || group.length === 1 ? b.end : end;
  }
  if (group.length) flush();
  return out;
}

/** Equipment calendar: day (one column per equipment), week and month. Drag across empty time to book. */
type Drag =
  | { kind: 'bundle'; bundle: Bundle; eq: number; dur: number; color: string; label: string; grab: number }
  | { kind: 'move'; booking: Booking; eq: number; dur: number; color: string; label: string; grab: number };
export type Preview = {
  day: string;
  eq: number;
  start: number;
  dur: number;
  color: string;
  label: string;
  ok: boolean;
  /** the slot starts before now */
  past?: boolean;
};

/**
 * Equipment calendar: day (one column per equipment), week and month. Drag across empty time to book; drag your own booking to
 * move it. With `scheduling` (a batch id, computer only), a tray under the calendar holds that batch's equipment blocks, to be
 * dragged onto their day and time.
 */
export default function Calendar({
  onOpenBatch,
  scheduling = null,
  onEndScheduling,
}: {
  onOpenBatch?: (id: number) => void;
  scheduling?: number | null;
  onEndScheduling?: (backToBatch: boolean) => void;
}) {
  const { me } = useContext(MeCtx);
  const narrow = typeof window !== 'undefined' && window.innerWidth < 760;
  const [view, setView] = useState<View>(() => {
    try {
      return (localStorage.getItem('psc-cal-view') as View) || (narrow ? 'day' : 'week');
    } catch {
      return 'week';
    }
  });
  const [date, setDate] = useState(() => sod(new Date())),
    [data, setData] = useState<Data | null>(null),
    [err, setErr] = useState('');
  const [hidden, setHidden] = useState<number[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('psc-cal-hide') ?? '[]');
    } catch {
      return [];
    }
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    justDragged = useRef(false);
  const [sb, setSb] = useState<{
      id: number;
      code: string;
      snapshot: { stack: StackD };
      status: string;
      plan_split?: string;
    } | null>(null),
    [sbBooks, setSbBooks] = useState<Booking[]>([]);
  const loadSb = () => {
    if (scheduling) {
      api<any>('/batches/' + scheduling)
        .then((b) => {
          setSb(b);
          // tell the server the plan's blocks: the batch is not Done until each of them is booked and answered
          if (b?.status !== 'done') {
            const split: string[] = JSON.parse(b.plan_split || '[]');
            api(`/batches/${b.id}/plan`, 'PUT', {
              steps: bundlesOf(b.snapshot.stack, b.snapshot.resolved, split).map((x) => x.step),
              split,
            }).catch(() => {});
          }
        })
        .catch(() => setSb(null));
      api<Booking[]>(`/batches/${scheduling}/bookings`)
        .then(setSbBooks)
        .catch(() => {});
    } else {
      setSb(null);
      setSbBooks([]);
    }
  };
  useEffect(loadSb, [scheduling]);
  useEffect(() => {
    if (scheduling && view === 'month') setView('week');
  }, [scheduling]);
  const [from, to] = range(view, date);
  const load = () =>
    api<Data>(`/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)
      .then((d) => {
        setData(d);
        setErr('');
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, [view, from.getTime()]);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  });
  useRefresh(() => {
    load();
    loadSb();
  }, ['calendar', 'batches']);
  const pickView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem('psc-cal-view', v);
    } catch {
      /* ignore */
    }
  };
  const toggleEq = (id: number) => {
    const n = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
    setHidden(n);
    try {
      localStorage.setItem('psc-cal-hide', JSON.stringify(n));
    } catch {
      /* ignore */
    }
  };
  const step = (k: number) =>
    setDate(
      view === 'day'
        ? addDays(date, k)
        : view === 'week'
          ? addDays(date, 7 * k)
          : new Date(date.getFullYear(), date.getMonth() + k, 1),
    );
  // the calendar shows what is booked by itself (not what sits inside a glovebox)
  const eqs = (data?.equipment ?? []).filter((e) => e.active && e.booked !== false),
    shown = eqs.filter((e) => !hidden.includes(e.id));
  const list = (data?.bookings ?? []).filter((b) => shown.some((e) => e.id === b.equipment_id));
  const work = useHours();
  // ---- dragging a tray block or a booking onto the grid
  const slotAt = (x: number, y: number, d: Drag): Preview | null => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('.tg-col') as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect(),
      colEq = el.dataset.eq ? +el.dataset.eq : 0;
    const m = Math.max(0, Math.min(24 * 60 - d.dur, Math.round((((y - r.top) / HOUR_PX) * 60 - d.grab) / SNAP) * SNAP));
    const day = el.dataset.day!,
      start = at(day, '00:00').getTime() + m * 6e4,
      end = start + d.dur * 6e4;
    const clash =
      !!clashOf(data?.bookings ?? [], eqs, d.eq, start, end, d.kind === 'move' ? d.booking.id : undefined) ||
      !!offOf(data?.off, d.eq, start, end);
    return {
      day,
      eq: d.eq,
      start: m,
      dur: d.dur,
      color: d.color,
      label: d.label,
      ok: (!colEq || colEq === d.eq) && !clash && start >= Date.now() - PAST_GRACE,
      past: start < Date.now() - PAST_GRACE,
    };
  };
  useEffect(() => {
    if (!drag) return;
    const mv = (e: PointerEvent) => setPreview(slotAt(e.clientX, e.clientY, drag));
    const up = (e: PointerEvent) => {
      const p = slotAt(e.clientX, e.clientY, drag);
      setDrag(null);
      setPreview(null);
      justDragged.current = true;
      setTimeout(() => {
        justDragged.current = false;
      }, 0);
      if (!p?.ok) {
        if (p?.past) showToast(PAST);
        else if (p) showToast(`${data?.equipment.find((q) => q.id === drag.eq)?.name} is not free there`);
        return;
      }
      const start = at(p.day, '00:00').getTime() + p.start * 6e4,
        body = { start: new Date(start).toISOString(), end: new Date(start + p.dur * 6e4).toISOString() };
      const req =
        drag.kind === 'bundle'
          ? api('/bookings', 'POST', {
              equipment_id: drag.eq,
              subject: 'batch',
              subject_id: scheduling,
              step: drag.bundle.step,
              ...body,
            })
          : api('/bookings/' + drag.booking.id, 'PUT', {
              equipment_id: drag.booking.equipment_id,
              subject: drag.booking.subject,
              subject_id: drag.booking.subject_id,
              purpose: drag.booking.purpose || undefined,
              step: drag.booking.step,
              note: drag.booking.note,
              ...body,
            });
      req
        .then((r: { offHours?: boolean }) => {
          load();
          loadSb();
          batchesChanged();
          showToast(
            (drag.kind === 'bundle'
              ? `${drag.label} placed, ${hm(new Date(start))}`
              : `Moved to ${hm(new Date(start))}`) + (r?.offHours ? `. ${OFF_HOURS}` : ''),
          );
        })
        .catch((x) => showToast(x.message));
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrag(null);
        setPreview(null);
      }
    };
    document.body.classList.add('dragging-block');
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', esc);
    return () => {
      document.body.classList.remove('dragging-block');
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', esc);
    };
  }, [drag]);
  // ---- resizing a booking by its top or bottom edge (own bookings without an outcome)
  const [resize, setResize] = useState<{ b: Booking; edge: 'start' | 'end'; col: HTMLElement; day: string } | null>(
    null,
  );
  const resized = (r: NonNullable<typeof resize>, y: number) => {
    const rect = r.col.getBoundingClientRect(),
      d0 = at(r.day, '00:00').getTime(),
      m = Math.max(0, Math.min(24 * 60, Math.round((((y - rect.top) / HOUR_PX) * 60) / SNAP) * SNAP));
    let s = new Date(r.b.start).getTime(),
      e = new Date(r.b.end).getTime();
    // never shorter than the equipment's shortest booking
    const least = (eqs.find((x) => x.id === r.b.equipment_id)?.min_booking ?? MIN_BOOK) * 6e4;
    if (r.edge === 'start') s = Math.min(d0 + m * 6e4, e - least);
    else e = Math.max(d0 + m * 6e4, s + least);
    const clash =
      !!clashOf(data?.bookings ?? [], eqs, r.b.equipment_id, s, e, r.b.id) ||
      !!offOf(data?.off, r.b.equipment_id, s, e);
    // an edge can only move to a time still to come (the start of a booking that has begun stays where it is)
    const past = (s !== new Date(r.b.start).getTime() && s < Date.now() - PAST_GRACE) || e < Date.now() - PAST_GRACE;
    return { s, e, clash, past };
  };
  useEffect(() => {
    if (!resize) return;
    const show = (y: number) => {
      const { s, e, clash, past } = resized(resize, y),
        d0 = at(resize.day, '00:00').getTime();
      setPreview({
        day: resize.day,
        eq: resize.b.equipment_id,
        start: Math.round((s - d0) / 6e4),
        dur: Math.round((e - s) / 6e4),
        color: resize.b.color,
        label: resize.b.equipment,
        ok: !clash && !past,
      });
    };
    const mv = (ev: PointerEvent) => show(ev.clientY);
    const up = (ev: PointerEvent) => {
      const { s, e, clash, past } = resized(resize, ev.clientY),
        b = resize.b;
      setResize(null);
      setPreview(null);
      justDragged.current = true;
      setTimeout(() => {
        justDragged.current = false;
      }, 0);
      if (s === new Date(b.start).getTime() && e === new Date(b.end).getTime()) return;
      if (past) return showToast(PAST);
      if (clash) return showToast(`${b.equipment} is not free then`);
      api('/bookings/' + b.id, 'PUT', {
        equipment_id: b.equipment_id,
        subject: b.subject,
        subject_id: b.subject_id,
        purpose: b.purpose || undefined,
        step: b.step,
        note: b.note,
        start: new Date(s).toISOString(),
        end: new Date(e).toISOString(),
      })
        .then((r: { offHours?: boolean }) => {
          load();
          loadSb();
          batchesChanged();
          showToast(
            `${b.equipment}: now ${hm(new Date(s))}–${hm(new Date(e))}` + (r?.offHours ? `. ${OFF_HOURS}` : ''),
          );
        })
        .catch((x) => showToast(x.message));
    };
    const esc = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setResize(null);
        setPreview(null);
      }
    };
    document.body.classList.add('resizing-block');
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', esc);
    return () => {
      document.body.classList.remove('resizing-block');
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', esc);
    };
  }, [resize]);
  const startResize = (b: Booking, edge: 'start' | 'end', e: React.PointerEvent) => {
    if (e.button !== 0 || !b.editable || b.outcome || narrow) return;
    e.stopPropagation();
    e.preventDefault();
    const col = (e.currentTarget as HTMLElement).closest('.tg-col') as HTMLElement | null;
    if (col?.dataset.day) setResize({ b, edge, col, day: col.dataset.day });
  };
  /** Pressing on a booking: a click opens it; moving 5 px starts dragging it (own bookings without an outcome). */
  const grab = (b: Booking, e: React.PointerEvent) => {
    if (e.button !== 0 || !b.editable || b.outcome || narrow) return;
    const x0 = e.clientX,
      y0 = e.clientY,
      r = (e.currentTarget as HTMLElement).getBoundingClientRect(),
      g = Math.round((((y0 - r.top) / HOUR_PX) * 60) / SNAP) * SNAP;
    const mv = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 5) {
        stop();
        setDrag({
          kind: 'move',
          booking: b,
          eq: b.equipment_id,
          // an older booking shorter than an hour becomes an hour when moved
          dur: Math.max(MIN_BOOK, Math.round((new Date(b.end).getTime() - new Date(b.start).getTime()) / 6e4)),
          color: b.color,
          label: b.equipment,
          grab: g,
        });
      }
    };
    const stop = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', stop);
  };
  const open = (d: Draft) => setDraft(d);
  const newAt = (start: Date, end: Date, eq?: number) =>
    open({
      start: start.toISOString(),
      end: end.toISOString(),
      equipment_id: eq ?? (shown.length === 1 ? shown[0].id : undefined),
    });
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,select,textarea') || draft) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key.toLowerCase() === 't') setDate(sod(new Date()));
      else if (e.key.toLowerCase() === 'd') pickView('day');
      else if (e.key.toLowerCase() === 'w') pickView('week');
      else if (e.key.toLowerCase() === 'm') pickView('month');
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  return (
    <div className="cal">
      <div className="cal-bar">
        <div className="cal-nav">
          <button className="btn secondary" onClick={() => setDate(sod(new Date()))} title="Today (T)">
            Today
          </button>
          <button className="iconbtn" aria-label="Previous" title="Previous (←)" onClick={() => step(-1)}>
            ‹
          </button>
          <button className="iconbtn" aria-label="Next" title="Next (→)" onClick={() => step(1)}>
            ›
          </button>
          <h2 className="cal-title">{title(view, date, narrow)}</h2>
        </div>
        <div className="grow" />
        <Seg
          value={view}
          on={pickView}
          small
          opts={[
            ['day', 'Day'],
            ['week', 'Week'],
            ['month', 'Month'],
          ]}
        />
        <button
          className="btn"
          onClick={() => {
            const s = new Date();
            s.setMinutes(Math.ceil(s.getMinutes() / 30) * 30, 0, 0);
            if (!sameDay(s, date) && view === 'day') s.setTime(sod(date).getTime());
            const w = nextWorking(work, s);
            newAt(w, new Date(w.getTime() + 3.6e6));
          }}
        >
          New booking
        </button>
      </div>
      {view !== 'day' && eqs.length > 1 && (
        <div className="eq-filter" role="group" aria-label="Show equipment">
          {eqs.map((e) => {
            const on = !hidden.includes(e.id);
            return (
              <button
                key={e.id}
                className={'eq-chip' + (on ? ' on' : '')}
                aria-pressed={on}
                style={{ '--eq': e.color } as React.CSSProperties}
                onClick={() => toggleEq(e.id)}
              >
                {e.name}
                <i />
              </button>
            );
          })}
        </div>
      )}
      {err && <p className="err">{err}</p>}
      {!data ? (
        <p className="mut">Loading…</p>
      ) : !eqs.length ? (
        <div className="cal-empty">
          <p>No equipment yet.</p>
          <p className="mut">The lab’s equipment is added under Lab › Equipment.</p>
        </div>
      ) : view === 'month' ? (
        <Month
          date={date}
          list={list}
          onDay={(d) => {
            setDate(d);
            pickView('day');
          }}
          onOpen={open}
        />
      ) : (
        <TimeGrid
          view={view}
          date={date}
          eqs={view === 'day' ? eqs : shown}
          list={view === 'day' ? data.bookings : list}
          onNew={newAt}
          onOpen={(b) => !justDragged.current && open(b)}
          onGrab={grab}
          onResize={startResize}
          busy={!!drag || !!resize}
          activeId={resize?.b.id ?? (drag?.kind === 'move' ? drag.booking.id : undefined)}
          preview={preview}
          off={(data.off ?? []).filter((o) => (view === 'day' ? eqs : shown).some((e) => e.id === o.equipment_id))}
        />
      )}
      {scheduling && !narrow && data && (
        <Tray
          batch={sb}
          books={sbBooks}
          eqs={eqs}
          trained={data?.trained ?? []}
          isAdmin={me.role === 'admin'}
          onSplit={(split) =>
            sb &&
            api(`/batches/${sb.id}/plan`, 'PUT', {
              steps: bundlesOf(sb.snapshot.stack, (sb.snapshot as any).resolved, split).map((x) => x.step),
              split,
            })
              .then(loadSb)
              .catch((e) => showToast(e.message))
          }
          onStart={(d) => {
            if (view === 'month') pickView('week');
            setDrag(d);
          }}
          onEnd={onEndScheduling}
        />
      )}
      {scheduling && narrow && (
        <p className="mut small cal-hint">
          Scheduling a batch is done on a computer: open the Calendar there to place its equipment blocks.
        </p>
      )}
      {data && !data.open.length && (
        <p className="mut small cal-hint">
          Bookings for a batch need a Planned batch: start one from a stack. Equipment can also be booked outside a
          batch, saying what for.
        </p>
      )}
      {draft && data && (
        <BookingForm
          draft={draft}
          data={data}
          isAdmin={me.role === 'admin'}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            load();
            batchesChanged();
          }}
          onOpenBatch={onOpenBatch}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ day and week
const OUTCOME: Record<string, string> = { done: 'Concluded', postponed: 'Postponed', canceled: 'Canceled' };
/** Everything about a booking, next to its block (right of it, or left when there is no room). */
function HoverCard({ b, r, cleanup = 0, eq }: { b: Booking; r: DOMRect; cleanup?: number; eq?: Eq }) {
  const W = 270,
    s = new Date(b.start),
    e = new Date(b.end),
    mins = Math.round((e.getTime() - s.getTime()) / 6e4);
  const left = r.right + 10 + W < window.innerWidth ? r.right + 10 : Math.max(8, r.left - 10 - W),
    top = Math.max(8, Math.min(r.top, window.innerHeight - 220));
  return (
    <div className="bk-card" style={{ left, top, width: W, '--eq': b.color } as React.CSSProperties} role="tooltip">
      <div className="bk-card-h">
        {eq && <EquipmentArt kind={artOf(eq)} size={40} />}
        <span>
          <b>{b.equipment}</b>
          <i className="cbar" />
        </span>
      </div>
      <dl>
        <dt>{b.subject ? 'Experiment' : 'Purpose'}</dt>
        <dd>{what(b)}</dd>
        <dt>Booked by</dt>
        <dd>{b.user_name}</dd>
        <dt>When</dt>
        <dd>
          {s.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, {hm(s)}–{hm(e)}{' '}
          <span className="mut">
            ({mins >= 60 ? `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ''}` : `${mins} min`})
          </span>
        </dd>
        {cleanup > 0 && (
          <>
            <dt>Cleanup</dt>
            <dd>
              until {hm(new Date(e.getTime() + cleanup * 6e4))} <span className="mut">({cleanup} min)</span>
            </dd>
          </>
        )}
        {b.note && (
          <>
            <dt>Note</dt>
            <dd>{b.note}</dd>
          </>
        )}
        {b.outcome && (
          <>
            <dt>Outcome</dt>
            <dd>
              {OUTCOME[b.outcome] ?? b.outcome}
              {b.reason ? `: ${b.reason}` : ''}
            </dd>
          </>
        )}
      </dl>
      {b.editable && !b.outcome && (
        <p className="mut small">Drag to move · drag the top or bottom edge to change the time</p>
      )}
    </div>
  );
}

function TimeGrid({
  view,
  date,
  eqs,
  list,
  onNew,
  onOpen,
  onGrab,
  onResize,
  busy,
  activeId,
  preview,
  off = [],
}: {
  /** out-of-service periods (0.38), drawn hatched in their equipment's columns */
  off?: Off[];
  view: 'day' | 'week';
  date: Date;
  eqs: Eq[];
  list: Booking[];
  onNew: (s: Date, e: Date, eq?: number) => void;
  onOpen: (b: Draft) => void;
  onGrab?: (b: Booking, e: React.PointerEvent) => void;
  onResize?: (b: Booking, edge: 'start' | 'end', e: React.PointerEvent) => void;
  /** a block is being moved or resized: no hover card */
  busy?: boolean;
  /** the booking being moved or resized: drawn faded under its preview */
  activeId?: number;
  preview?: Preview | null;
}) {
  const cols =
    view === 'day'
      ? eqs.map((e) => ({ key: 'e' + e.id, day: sod(date), eq: e }))
      : Array.from({ length: 7 }, (_, i) => ({
          key: 'd' + i,
          day: addDays(monday(date), i),
          eq: undefined as Eq | undefined,
        }));
  const scroller = useRef<HTMLDivElement>(null),
    [now, setNow] = useState(new Date()),
    [drag, setDrag] = useState<{ col: number; a: number; b: number } | null>(null);
  const hours = useHours(),
    bdays = useBirthdays();
  // hover card: all the details of a booking whose block is too small (or too narrow) to show them in full
  const [card, setCard] = useState<{ b: Booking; r: DOMRect } | null>(null),
    hoverT = useRef<number>(0);
  const hoverIn = (b: Booking, el: HTMLElement) => {
    window.clearTimeout(hoverT.current);
    const cut =
      el.scrollHeight > el.clientHeight + 1 ||
      Array.from(el.querySelectorAll<HTMLElement>('b, .bk-s, .bk-t')).some((c) => c.scrollWidth > c.clientWidth + 1);
    if (!cut) return setCard(null);
    hoverT.current = window.setTimeout(() => setCard({ b, r: el.getBoundingClientRect() }), 250);
  };
  const hoverOut = () => {
    window.clearTimeout(hoverT.current);
    setCard(null);
  };
  useEffect(() => {
    if (busy) hoverOut();
  }, [busy]);
  // the working day in view: from an hour before the earliest start of the days shown
  const firstHour = Math.min(
    ...cols
      .map((c) => workDayOf(hours, c.day))
      .filter((w) => w.on)
      .map((w) => Math.floor(minutesOf(w.from) / 60)),
    8,
  );
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = Math.max(0, firstHour - 1) * HOUR_PX;
  }, [view, firstHour]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const minAt = (e: React.PointerEvent, el: HTMLElement) =>
    Math.max(
      0,
      Math.min(24 * 60, Math.round((((e.clientY - el.getBoundingClientRect().top) / HOUR_PX) * 60) / SNAP) * SNAP),
    );
  const toDate = (day: Date, m: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m);
  const finish = () => {
    if (!drag) return;
    const c = cols[drag.col],
      lo = Math.min(drag.a, drag.b),
      hi = Math.max(drag.a, drag.b);
    const s = lo,
      e = Math.min(24 * 60, Math.max(hi, lo + MIN_BOOK)); // a click, or a short drag, books the shortest booking (1 h)
    setDrag(null);
    onNew(toDate(c.day, s), toDate(c.day, e), c.eq?.id);
  };
  const today = sod(new Date());
  // empty days that are not working days are narrow, so the working days get the room
  const busyCol = cols.map(
    (c) =>
      view === 'day' ||
      workDayOf(hours, c.day).on ||
      list.some(
        (b) => new Date(b.end).getTime() > c.day.getTime() && new Date(b.start).getTime() < c.day.getTime() + DAY,
      ),
  );
  const template = `52px ${cols.map((_, i) => (busyCol[i] ? `minmax(${view === 'day' ? 140 : 96}px, 1fr)` : 'minmax(48px, 0.4fr)')).join(' ')}`;
  return (
    <div className={'tg tg-' + view}>
      {card &&
        createPortal(
          <HoverCard
            b={card.b}
            r={card.r}
            eq={eqs.find((x) => x.id === card.b.equipment_id)}
            cleanup={eqs.find((x) => x.id === card.b.equipment_id)?.cleanup ?? 0}
          />,
          document.body,
        )}
      <div className="tg-scroll" ref={scroller}>
        <div className="tg-head" style={{ gridTemplateColumns: template }}>
          <span />
          {cols.map((c) =>
            c.eq ? (
              <div key={c.key} className="tg-col-h eq">
                <EquipmentArt kind={artOf(c.eq)} color={c.eq.color} size={44} />
                <b>{c.eq.name}</b>
              </div>
            ) : (
              <div
                key={c.key}
                className={
                  'tg-col-h day' + (sameDay(c.day, today) ? ' today' : '') + (busyCol[cols.indexOf(c)] ? '' : ' slim')
                }
              >
                <span className="mut small wd">{c.day.toLocaleDateString('en-GB', { weekday: 'long' })}</span>
                <b>{c.day.getDate()}</b>
                {bdays.get(mdOf(c.day)) && (
                  <span
                    className="bday"
                    title={`Birthday: ${bdays
                      .get(mdOf(c.day))!
                      .map((x) => x.name)
                      .join(', ')}`}
                  >
                    <Cake />{' '}
                    {bdays
                      .get(mdOf(c.day))!
                      .map((x) => firstName(x.name))
                      .join(', ')}
                  </span>
                )}
              </div>
            ),
          )}
        </div>
        <div
          className="tg-body"
          style={{
            gridTemplateColumns: template,
            height: 24 * HOUR_PX,
          }}
        >
          <div className="tg-hours">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ top: h * HOUR_PX }}>
                {h ? `${String(h).padStart(2, '0')}:00` : ''}
              </span>
            ))}
          </div>
          {cols.map((c, ci) => {
            const d0 = c.day.getTime(),
              d1 = d0 + DAY;
            const mine = list.filter(
              (b) =>
                (!c.eq || b.equipment_id === c.eq.id) &&
                new Date(b.end).getTime() > d0 &&
                new Date(b.start).getTime() < d1,
            );
            const lay = lanes(mine),
              nm = namer(list);
            return (
              <div
                key={c.key}
                className={'tg-col' + (sameDay(c.day, today) ? ' today' : '')}
                data-day={ymd(c.day)}
                data-eq={c.eq?.id ?? ''}
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest('.bk, .bk-clean') || e.button !== 0) return;
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  const m = minAt(e, e.currentTarget);
                  setDrag({ col: ci, a: m, b: m });
                }}
                onPointerMove={(e) => drag && drag.col === ci && setDrag({ ...drag, b: minAt(e, e.currentTarget) })}
                onPointerUp={finish}
                onPointerCancel={() => setDrag(null)}
              >
                {offStretches(workDayOf(hours, c.day)).map(([a, z]) => (
                  <div
                    key={'off' + a}
                    className="tg-off"
                    style={{ top: (a / 60) * HOUR_PX, height: ((z - a) / 60) * HOUR_PX }}
                    aria-hidden
                  />
                ))}
                {off
                  .filter(
                    (o) =>
                      (!c.eq || o.equipment_id === c.eq.id) &&
                      new Date(o.end).getTime() > d0 &&
                      new Date(o.start).getTime() < d1,
                  )
                  .map((o) => {
                    const s = Math.max(d0, new Date(o.start).getTime()),
                      e = Math.min(d1, new Date(o.end).getTime()),
                      name = eqs.find((x) => x.id === o.equipment_id)?.name ?? '';
                    return (
                      <div
                        key={'oos' + o.id}
                        className="bk-oos"
                        style={{ top: ((s - d0) / 3.6e6) * HOUR_PX, height: ((e - s) / 3.6e6) * HOUR_PX }}
                        title={`${name} out of service${o.reason ? `: ${o.reason}` : ''}`}
                      >
                        <span>
                          {c.eq ? '' : name + ' · '}Out of service{o.reason ? `: ${o.reason}` : ''}
                        </span>
                      </div>
                    );
                  })}
                {mine.map((b) => {
                  const s = Math.max(d0, new Date(b.start).getTime()),
                    e = Math.min(d1, new Date(b.end).getTime()),
                    L = lay.get(b.id)!;
                  const top = ((s - d0) / 3.6e6) * HOUR_PX,
                    h = Math.max(18, ((e - s) / 3.6e6) * HOUR_PX - 2);
                  const when = `${hm(new Date(b.start))}–${hm(new Date(b.end))}`,
                    who = nm(b.user_name),
                    canEdit = !!onResize && b.editable && !b.outcome,
                    size = h >= 66 ? 'tall' : h >= 34 ? 'mid' : 'short',
                    mark =
                      b.outcome === 'done' ? (
                        <span className="bk-mark" aria-label="concluded">
                          ✓{' '}
                        </span>
                      ) : !b.outcome && ended(b) ? (
                        <span className="bk-mark" aria-label="waiting for its outcome">
                          ?{' '}
                        </span>
                      ) : null;
                  // cleanup after the booking (gloveboxes): the equipment stays taken, drawn hatched in its colour
                  const cl = eqs.find((x) => x.id === b.equipment_id)?.cleanup ?? 0,
                    ce = new Date(b.end).getTime(),
                    cs2 = Math.max(d0, ce),
                    ce2 = Math.min(d1, ce + cl * 6e4);
                  const clean =
                    cl > 0 && ce2 > cs2 ? (
                      <div
                        className="bk-clean"
                        aria-hidden
                        title={`${cl} min of cleanup after this booking, until ${hm(new Date(ce + cl * 6e4))}: leave it clean for the next person`}
                        style={
                          {
                            // starts 1 px inside the booking so the two read as one block
                            top: ((cs2 - d0) / 3.6e6) * HOUR_PX - 1,
                            height: Math.max(4, ((ce2 - cs2) / 3.6e6) * HOUR_PX - 1),
                            left: `calc(${(L.lane / L.of) * 100}% + 2px)`,
                            width: `calc(${100 / L.of}% - 4px)`,
                            '--eq': b.color,
                          } as React.CSSProperties
                        }
                      >
                        {((ce2 - cs2) / 3.6e6) * HOUR_PX >= 13 && <span>Cleanup</span>}
                      </div>
                    ) : null;
                  return (
                    <Fragment key={b.id}>
                      {clean}
                      <button
                        className={
                          'bk bk-' +
                          size +
                          (b.mine ? ' mine' : '') +
                          (canEdit ? ' can-edit' : '') +
                          (b.id === activeId ? ' bk-dim' : '') +
                          (clean && e === ce ? ' has-clean' : '') +
                          (b.outcome ? ' bk-' + b.outcome : ended(b) ? ' bk-wait' : '')
                        }
                        style={
                          {
                            top,
                            height: h,
                            left: `calc(${(L.lane / L.of) * 100}% + 2px)`,
                            width: `calc(${100 / L.of}% - 4px)`,
                            '--eq': b.color,
                          } as React.CSSProperties
                        }
                        onPointerDown={(ev) => {
                          hoverOut();
                          onGrab?.(b, ev);
                        }}
                        onPointerEnter={(ev) => !busy && hoverIn(b, ev.currentTarget)}
                        onPointerLeave={hoverOut}
                        onClick={() => onOpen(b)}
                        aria-label={`${b.equipment}, ${b.user_name}, ${what(b)}, ${when}`}
                      >
                        {size === 'tall' ? (
                          <>
                            <b>
                              {mark}
                              {what(b)}
                            </b>
                            <span className="bk-s">{b.mine ? 'You' : who}</span>
                            <span className="bk-s">{shortEq(b.equipment)}</span>
                            <span className="bk-t">{when}</span>
                          </>
                        ) : size === 'mid' ? (
                          <>
                            <span className="bk-l">
                              <b>
                                {mark}
                                {what(b)}
                              </b>
                              <span className="bk-t">{hm(new Date(b.start))}</span>
                            </span>
                            <span className="bk-s">
                              {shortEq(b.equipment)}, {b.mine ? 'you' : who}
                            </span>
                          </>
                        ) : (
                          <>
                            <b>
                              {mark}
                              {what(b)}
                            </b>
                            <span className="bk-s">
                              {shortEq(b.equipment)}, {b.mine ? 'you' : who}
                            </span>
                            <span className="bk-t">{hm(new Date(b.start))}</span>
                          </>
                        )}
                        {canEdit && s === new Date(b.start).getTime() && (
                          <span
                            className="bk-edge bk-edge-s"
                            aria-hidden
                            title="Drag to change the start"
                            onPointerDown={(ev) => onResize!(b, 'start', ev)}
                            onClick={(ev) => ev.stopPropagation()}
                          />
                        )}
                        {canEdit && e === new Date(b.end).getTime() && (
                          <span
                            className="bk-edge bk-edge-e"
                            aria-hidden
                            title="Drag to change the end"
                            onPointerDown={(ev) => onResize!(b, 'end', ev)}
                            onClick={(ev) => ev.stopPropagation()}
                          />
                        )}
                      </button>
                    </Fragment>
                  );
                })}
                {drag &&
                  drag.col === ci &&
                  (() => {
                    const lo = Math.min(drag.a, drag.b),
                      hi = Math.max(drag.a, drag.b, lo + SNAP);
                    return (
                      <div
                        className="bk-ghost"
                        style={{ top: (lo / 60) * HOUR_PX, height: ((hi - lo) / 60) * HOUR_PX }}
                      >
                        {hhmm(toDate(c.day, lo))}–{hhmm(toDate(c.day, hi))}
                      </div>
                    );
                  })()}
                {preview && preview.day === ymd(c.day) && (!c.eq || c.eq.id === preview.eq) && (
                  <div
                    className={'bk-drop' + (preview.ok ? '' : ' no')}
                    style={
                      {
                        top: (preview.start / 60) * HOUR_PX,
                        height: (preview.dur / 60) * HOUR_PX - 2,
                        '--eq': preview.color,
                      } as React.CSSProperties
                    }
                  >
                    <b>{preview.label}</b>
                    <span>
                      {hhmm(toDate(c.day, preview.start))}–{hhmm(toDate(c.day, preview.start + preview.dur))}
                    </span>
                    {!preview.ok && <span>Not free</span>}
                  </div>
                )}
                {preview &&
                  preview.day === ymd(c.day) &&
                  (!c.eq || c.eq.id === preview.eq) &&
                  (eqs.find((x) => x.id === preview.eq)?.cleanup ?? 0) > 0 && (
                    <div
                      className={'bk-clean bk-clean-drop' + (preview.ok ? '' : ' no')}
                      style={
                        {
                          top: ((preview.start + preview.dur) / 60) * HOUR_PX,
                          height: ((eqs.find((x) => x.id === preview.eq)!.cleanup ?? 0) / 60) * HOUR_PX - 2,
                          left: 2,
                          right: 2,
                          '--eq': preview.color,
                        } as React.CSSProperties
                      }
                    >
                      <span>Cleanup</span>
                    </div>
                  )}
                {sameDay(c.day, now) && (
                  <div
                    className="now-line"
                    style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ month
function Month({
  date,
  list,
  onDay,
  onOpen,
}: {
  date: Date;
  list: Booking[];
  onDay: (d: Date) => void;
  onOpen: (b: Draft) => void;
}) {
  const [first] = range('month', date),
    today = sod(new Date()),
    nm = namer(list),
    work = useHours(),
    bdays = useBirthdays();
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  return (
    <div className="month">
      {days.slice(0, 7).map((d) => (
        <div key={'h' + d.getDay()} className="month-h">
          {d.toLocaleDateString('en-GB', { weekday: 'long' })}
        </div>
      ))}
      {days.map((d) => {
        const t0 = d.getTime(),
          t1 = t0 + DAY,
          here = list.filter((b) => new Date(b.end).getTime() > t0 && new Date(b.start).getTime() < t1);
        return (
          <div
            key={d.toISOString()}
            className={
              'month-cell' +
              (d.getMonth() !== date.getMonth() ? ' out' : '') +
              (sameDay(d, today) ? ' today' : '') +
              (workDayOf(work, d).on ? '' : ' off')
            }
            onClick={() => onDay(d)}
          >
            <span className="month-top">
              <span className="month-d">{d.getDate()}</span>
              {bdays.get(mdOf(d)) && (
                <span
                  className="bday"
                  title={`Birthday: ${bdays
                    .get(mdOf(d))!
                    .map((x) => x.name)
                    .join(', ')}`}
                >
                  <Cake />{' '}
                  {bdays
                    .get(mdOf(d))!
                    .map((x) => firstName(x.name))
                    .join(', ')}
                </span>
              )}
            </span>
            {here.slice(0, 3).map((b) => (
              <button
                key={b.id}
                className={'month-bk' + (b.mine ? ' mine' : '')}
                style={{ '--eq': b.color } as React.CSSProperties}
                title={`${b.equipment}\n${b.user_name}\n${what(b)}\n${hm(new Date(b.start))}–${hm(new Date(b.end))}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(b);
                }}
              >
                <i />
                <span className="month-t">{hm(new Date(b.start))}</span>
                {shortEq(b.equipment)}
                <span>{b.mine ? 'you' : nm(b.user_name)}</span>
              </button>
            ))}
            {here.length > 3 && <span className="month-more">{here.length - 3} more</span>}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ booking dialog
function BookingForm({
  draft,
  data,
  isAdmin,
  onClose,
  onSaved,
  onOpenBatch,
}: {
  draft: Draft;
  data: Data;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
  onOpenBatch?: (id: number) => void;
}) {
  const existing = !!draft.id,
    ro = existing && (!draft.editable || !!draft.outcome); // answered steps are history
  const s0 = new Date(draft.start),
    e0 = new Date(draft.end);
  // what can be booked: active and booked by itself (not what sits inside a glovebox)
  const eqs = data.equipment.filter((e) => (e.active && e.booked !== false) || e.id === draft.equipment_id);
  /**
   * What this equipment can be booked for (subjects from the modules, a batch say): finished ones for measuring equipment (J–V
   * measurement), open ones otherwise. A choice is "subject:id".
   */
  const key = (c: { subject?: string; id?: number | null }) => (c.subject && c.id ? `${c.subject}:${c.id}` : '');
  const choicesFor = (eqId: number): Choice[] => {
    const list = measuringEq(
      eqs.find((e) => e.id === eqId),
      data.steps,
    )
      ? (data.finished ?? [])
      : data.open;
    return existing &&
      draft.subject &&
      !list.some((b) => key(b) === key({ subject: draft.subject, id: draft.subject_id }))
      ? [
          {
            subject: draft.subject,
            noun: draft.subject_noun ?? '',
            id: draft.subject_id!,
            code: draft.subject_code!,
            name: draft.subject_name ?? '',
          },
          ...list,
        ]
      : list;
  };
  const [f, setF] = useState(() => {
    const eq0 = draft.equipment_id ?? 0;
    return {
      eq: eq0,
      // '' = outside a batch (or anything else a module defines)
      sel: existing ? key({ subject: draft.subject, id: draft.subject_id }) : key(choicesFor(eq0)[0] ?? {}),
      purpose: draft.purpose ?? '',
      step: draft.step ?? '',
      note: draft.note ?? '',
      day: ymd(s0),
      from: hhmm(s0),
      to: hhmm(e0),
      force: false,
    };
  });
  const choices = choicesFor(f.eq),
    measure = measuringEq(
      eqs.find((e) => e.id === f.eq),
      data.steps,
    ),
    picked = choices.find((c) => key(c) === f.sel),
    // what the subjects are called: "batch", or "batch or sample" when another module adds its own
    kinds = [...new Set([...data.open, ...data.finished].map((c) => c.noun))],
    nounText = kinds.join(' or ') || 'batch',
    // the batch picked (its steps are offered); other modules' subjects have none here
    batchId = picked?.subject === 'batch' ? picked.id : 0;
  // another equipment may take other subjects (J–V measurement: finished ones); keep the choice only if it still fits
  const pickEq = (id: number) => {
    const list = choicesFor(id);
    setF({ ...f, eq: id, sel: list.some((b) => key(b) === f.sel) ? f.sel : key(list[0] ?? {}), step: '' });
  };
  const [steps, setSteps] = useState<string[]>([]),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!batchId) return setSteps([]);
    api<any>('/batches/' + batchId)
      .then((b) => setSteps((b.snapshot?.stack?.sl ?? []).map((x: any) => x.n).filter(Boolean)))
      .catch(() => setSteps([]));
  }, [batchId]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const start = at(f.day, f.from),
    end = at(f.to <= f.from ? ymd(addDays(start, 1)) : f.day, f.to); // ending before it starts means the next day
  const clash = useMemo(
    () => clashOf(data.bookings, data.equipment, f.eq, start.getTime(), end.getTime(), draft.id),
    [f.eq, f.day, f.from, f.to, data.bookings],
  );
  const eq = eqs.find((e) => e.id === f.eq),
    hours = (end.getTime() - start.getTime()) / 3.6e6,
    least = eq?.min_booking ?? MIN_BOOK,
    oos = offOf(data.off, f.eq, start.getTime(), end.getTime()),
    untrained = !!eq && !isAdmin && !(data.trained ?? []).includes(eq.id),
    work = useHours();
  // a new booking, or a changed start, cannot be in the past (an ongoing booking keeps its start)
  const past =
    (start.getTime() < Date.now() - PAST_GRACE &&
      (!existing || start.getTime() !== new Date(draft.start!).getTime())) ||
    end.getTime() < Date.now() - PAST_GRACE;
  const ok =
    !!f.eq &&
    (!!f.sel || !!f.purpose.trim()) &&
    hours >= least / 60 &&
    !past &&
    !untrained &&
    (!oos || (isAdmin && f.force)) &&
    (!clash || (isAdmin && f.force));
  const body = () => ({
    equipment_id: f.eq,
    subject: picked?.subject ?? '',
    subject_id: picked?.id ?? null,
    purpose: picked ? undefined : f.purpose.trim(),
    step: picked ? f.step : '',
    note: f.note,
    start: start.toISOString(),
    end: end.toISOString(),
    force: f.force || undefined,
  });
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    (existing ? api('/bookings/' + draft.id, 'PUT', body()) : api('/bookings', 'POST', body()))
      .then((r: { offHours?: boolean }) => {
        showToast(
          (existing ? 'Booking saved' : `Booked ${eq?.name}, ${hm(start)}–${hm(end)}`) +
            (r?.offHours ? `. ${OFF_HOURS}` : ''),
        );
        onSaved();
      })
      .catch((x) => setErr(x.message))
      .finally(() => setBusy(false));
  };
  const remove = () => {
    const b = body();
    api('/bookings/' + draft.id, 'DELETE')
      .then(() => {
        onSaved();
        showToast(`Booking of ${draft.equipment} removed`, () =>
          api('/bookings', 'POST', { ...b, force: isAdmin || undefined }).then(() =>
            window.dispatchEvent(new Event('psc-refresh')),
          ),
        );
      })
      .catch((x) => setErr(x.message));
  };
  const head = existing ? `${draft.equipment}` : 'New booking';
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide bk-dialog" role="dialog" aria-label={head}>
        <div className="dialog-head">
          <h2>{head}</h2>
          <button className="iconbtn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {ro ? (
          <div className="stack-form-sm">
            <p>
              <b>
                {hm(s0)}–{hm(e0)}
              </b>
              , {s0.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <p>
              {draft.subject
                ? `${cap(draft.subject_noun ?? '')} ${draft.subject_code}${draft.step ? `, ${draft.step}` : ''}`
                : draft.purpose}
              . Booked by {draft.user_name}.
            </p>
            {draft.outcome && (
              <p>
                <b>
                  {draft.outcome === 'done' ? 'Concluded' : draft.outcome === 'postponed' ? 'Postponed' : 'Canceled'}
                </b>
                {draft.reason ? `: ${draft.reason}` : ''}
              </p>
            )}
            {draft.note && <p className="mut">{draft.note}</p>}
          </div>
        ) : (
          <form className="box-form" onSubmit={save}>
            <div className="fld">
              <span>Equipment</span>
              <div className="eq-pick" role="radiogroup" aria-label="Equipment">
                {eqs.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    role="radio"
                    aria-checked={f.eq === e.id}
                    className={f.eq === e.id ? 'on' : ''}
                    style={{ '--eq': e.color } as React.CSSProperties}
                    onClick={() => pickEq(e.id)}
                  >
                    <EquipmentArt kind={artOf(e)} size={52} />
                    <span>{e.name}</span>
                    <i />
                  </button>
                ))}
              </div>
            </div>
            <div className="grid2">
              <label className="fld">
                <span>{cap(`${measure ? 'finished ' : ''}${nounText}`)}</span>
                <select value={f.sel} onChange={(e) => setF({ ...f, sel: e.target.value, step: '' })}>
                  {choices.map((b) => (
                    <option key={key(b)} value={key(b)}>
                      {kinds.length > 1 ? `${cap(b.noun)} ` : ''}
                      {b.code}
                      {b.name ? ` (${b.name})` : ''}
                      {b.status === 'running' ? ', running' : ''}
                    </option>
                  ))}
                  <option value="">No {nounText}</option>
                </select>
              </label>
              {picked && (measure || !batchId) ? null : batchId ? (
                <label className="fld">
                  <span>Step</span>
                  <select value={f.step} onChange={(e) => setF({ ...f, step: e.target.value })}>
                    <option value="">Whole batch</option>
                    {steps.map((x, i) => (
                      <option key={i} value={x}>
                        {x}
                      </option>
                    ))}
                    {f.step && !steps.includes(f.step) && <option value={f.step}>{f.step}</option>}
                  </select>
                </label>
              ) : (
                <label className="fld">
                  <span>{measure ? 'Why it is booked' : 'What it is for'}</span>
                  <input
                    value={f.purpose}
                    required
                    maxLength={200}
                    placeholder={measure ? 'For example, lamp calibration' : 'For example, a test run'}
                    onChange={(e) => setF({ ...f, purpose: e.target.value })}
                  />
                </label>
              )}
            </div>
            {measure && !picked && (
              <p className="mut small">
                {eq?.name} measures finished {nounText}
                {kinds.length > 1 ? ' work' : nounText === 'batch' ? 'es' : 's'}. Without one, say why it is booked.
              </p>
            )}
            <div className="grid3 when">
              <label className="fld">
                <span>Day</span>
                <input type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} />
              </label>
              <label className="fld">
                <span>From</span>
                <input type="time" step={900} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
              </label>
              <label className="fld">
                <span>To</span>
                <input type="time" step={900} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
              </label>
            </div>
            <p className="mut small when-sum">
              {hours >= least / 60
                ? `${hours % 1 ? hours.toFixed(2).replace(/0$/, '') : hours} h${!sameDay(start, end) ? ', ending the next day' : ''}${eq?.cleanup ? `, then ${eq.cleanup} min of cleanup` : ''}`
                : `A booking of ${eq?.name ?? 'this equipment'} is at least ${least >= 60 && least % 60 === 0 ? `${least / 60} h` : `${least} min`}.`}
            </p>
            {untrained && (
              <p className="err small" role="alert">
                You are not trained on {eq!.name} yet
                {eq!.people?.length ? `; ask ${eq!.people.map((p) => p.name).join(' or ')}` : '; ask an admin'}.
              </p>
            )}
            {oos && (
              <p className="err small" role="alert">
                {eq?.name} is out of service then{oos.reason ? `: ${oos.reason}` : ''}.
              </p>
            )}
            {past && (
              <p className="err small" role="alert">
                {PAST}.
              </p>
            )}
            {clash && (
              <div className="clash" role="alert">
                <b>{clash.equipment}</b> is booked by {clash.user_name} for{' '}
                {clash.subject ? `${clash.subject_noun} ${clash.subject_code}` : clash.purpose},{' '}
                {hm(new Date(clash.start))}–{hm(new Date(clash.end))}
                {eq?.cleanup ? `, and needs ${eq.cleanup} min of cleanup between bookings` : ''}.
                {isAdmin ? (
                  <label className="inline small">
                    <input
                      type="checkbox"
                      checked={f.force}
                      onChange={(e) => setF({ ...f, force: e.target.checked })}
                    />{' '}
                    Book anyway (admin)
                  </label>
                ) : (
                  ' Pick another time or equipment.'
                )}
              </div>
            )}
            {!ro && !withinHours(work, start, end) && (
              <p className="warn-text small">Outside the lab's working hours. You can book it; the admins are told.</p>
            )}
            <label className="fld">
              <span>Note</span>
              <input
                value={f.note}
                placeholder="Optional, for example needs the N₂ line"
                onChange={(e) => setF({ ...f, note: e.target.value })}
              />
            </label>
            {err && <p className="err small">{err}</p>}
            <div className="dialog-actions">
              {existing && (
                <button type="button" className="link danger-link" onClick={remove}>
                  Remove booking
                </button>
              )}
              {existing && onOpenBatch && draft.subject === 'batch' && !!draft.subject_id && (
                <button type="button" className="link" onClick={() => onOpenBatch(draft.subject_id!)}>
                  Open batch
                </button>
              )}
              <div className="grow" />
              <button type="button" className="link" onClick={onClose}>
                Cancel
              </button>
              <button className="btn" disabled={!ok || busy}>
                {existing ? 'Save changes' : 'Book'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ batch scheduling tray (computer only)
function Tray({
  batch,
  books,
  eqs,
  trained,
  isAdmin,
  onStart,
  onEnd,
  onSplit,
}: {
  batch: {
    id: number;
    code: string;
    snapshot: { stack: StackD; resolved?: Record<number, any> };
    status: string;
    plan_split?: string;
  } | null;
  books: Booking[];
  eqs: Eq[];
  trained: number[];
  isAdmin: boolean;
  onStart: (d: Drag) => void;
  onEnd?: (back: boolean) => void;
  /** the blocks whose annealing goes elsewhere, chosen for this batch */
  onSplit: (split: string[]) => void;
}) {
  // the equipment picked for a block when more than one can take it
  const [pick, setPick] = useState<Record<string, number>>({});
  if (!batch)
    return (
      <div className="tray">
        <p className="mut">Loading the batch…</p>
      </div>
    );
  const chosen: string[] = JSON.parse(batch.plan_split || '[]'),
    split = autoSplit(batch.snapshot.stack, batch.snapshot.resolved, eqs, chosen),
    blocks = bundlesOf(batch.snapshot.stack, batch.snapshot.resolved, split),
    left = blocks.filter((b) => !placedOf(b, books)).length;
  return (
    <section className="tray" aria-label={`Equipment blocks for batch ${batch.code}`}>
      <div className="tray-head">
        <h3>Schedule {batch.code}</h3>
        <span className="mut small">
          {left
            ? `Drag each block to its day and time. ${left} of ${blocks.length} left.`
            : 'Every block is placed. Drag a booking to move it, click it to change its length.'}
        </span>
        <div className="grow" />
        <button className="link" onClick={() => onEnd?.(false)}>
          Close
        </button>
        <button className="btn" onClick={() => onEnd?.(true)}>
          {left ? 'Back to the batch' : 'Done'}
        </button>
      </div>
      <div className="tray-blocks">
        {blocks.map((b) => {
          const cands = eqCandidates(b, eqs, trained),
            eq = cands.find((e) => e.id === pick[b.key]) ?? cands[0],
            placed = placedOf(b, books),
            notTrained = !!eq && !isAdmin && !trained.includes(eq.id),
            least = eq?.min_booking ?? MIN_BOOK,
            dur = Math.max(least, b.minutes), // what will be booked: the recipe's time, at least the equipment's shortest booking
            base = b.key.replace(/-anneal$/, ''),
            movable = !placed && !!b.extra && !(split.includes(b.key) && !chosen.includes(b.key));
          const usable = !!eq && !placed && !notTrained;
          return (
            <div key={b.key} className="tray-cell">
              <button
                type="button"
                className={'tray-block' + (placed ? ' placed' : '') + (usable || placed ? '' : ' missing')}
                style={
                  {
                    '--eq': eq?.color ?? 'var(--sep)',
                    minHeight: Math.max(52, Math.min(110, (dur / 60) * HOUR_PX)), // grows to show its text
                  } as React.CSSProperties
                }
                disabled={!usable}
                title={
                  !eq
                    ? `No equipment can do ${b.needs.map(stepLabel).join(' and ').toLowerCase()} (set up under Lab › Equipment)`
                    : placed
                      ? `Placed: ${new Date(placed.start).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`
                      : notTrained
                        ? `You are not trained on ${eq.name} yet`
                        : 'Drag onto the calendar'
                }
                onPointerDown={(e) => {
                  if (!usable || e.button !== 0) return;
                  e.preventDefault();
                  onStart({
                    kind: 'bundle',
                    bundle: b,
                    eq: eq!.id,
                    dur,
                    color: eq!.color,
                    label: eq!.name,
                    grab: Math.min(30, b.minutes / 2),
                  });
                }}
              >
                <b>{eq?.name ?? (b.role ? ROLE_NAME[b.role] : b.needs.map(stepLabel).join(', '))}</b>
                <span>{b.what ?? b.layers.join(', ')}</span>
                <span className="tray-t">
                  {placed
                    ? `✓ ${new Date(placed.start).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric' })} ${hm(new Date(placed.start))}`
                    : notTrained
                      ? 'Not trained on it'
                      : `${dur >= 60 ? `${Math.floor(dur / 60)} h${dur % 60 ? ` ${dur % 60}` : ''}` : `${dur} min`}`}
                </span>
              </button>
              {!placed && cands.length > 1 && (
                <select
                  className="tray-eq"
                  aria-label={`Equipment for ${b.step}`}
                  value={eq?.id}
                  onChange={(e) => setPick({ ...pick, [b.key]: +e.target.value })}
                >
                  {cands.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {!isAdmin && !trained.includes(c.id) ? ' (not trained)' : ''}
                    </option>
                  ))}
                </select>
              )}
              {movable && (
                <button
                  type="button"
                  className="link small"
                  onClick={() => onSplit(chosen.includes(base) ? chosen.filter((k) => k !== base) : [...chosen, base])}
                >
                  {chosen.includes(base) ? 'Anneal in the same place' : 'Anneal elsewhere'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
