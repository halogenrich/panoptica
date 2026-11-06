import { Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { MeCtx } from '../ctx';
import { Seg } from '../lib/ui';
import { showToast, useRefresh } from '../lib/trash';
import { batchesChanged } from './Batches';
import { ROLE_NAME, bundlesOf, placedOf, type Bundle } from '../lib/bundles';
import type { StackD } from '../stacks/model';
import { DragHandle, useReorder } from './common';

type Eq = {
  id: number;
  name: string;
  color: string;
  place: string;
  pos: number;
  active: number;
  role: string;
  /** minutes blocked after each booking for cleaning (gloveboxes: 20) */
  cleanup?: number;
};
const USED_FOR: [string, string][] = [
  ['', 'Other'],
  ['prep', 'Substrate preparation'],
  ['scale', 'Solution preparation'],
  ['spinner', 'Spin coating'],
  ['organic', 'Organic evaporation'],
  ['metal', 'Metal evaporation'],
];
export type Booking = {
  id: number;
  equipment_id: number;
  batch_id: number;
  user_id: number;
  step: string;
  note: string;
  start: string;
  end: string;
  forced: boolean;
  equipment: string;
  color: string;
  batch_code: string;
  batch_name: string;
  batch_status: string;
  user_name: string;
  mine: boolean;
  editable: boolean;
  outcome?: 'done' | 'postponed' | 'canceled' | null;
  reason?: string;
};
type Data = {
  equipment: Eq[];
  bookings: Booking[];
  batches: { id: number; code: string; name: string; status?: string }[];
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
  if (short && v === 'day') return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  if (short && v === 'week') {
    const [a, b] = range('week', d);
    return `${a.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${addDays(b, -1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  }
  if (v === 'day')
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (v === 'month') return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const [a, b] = range('week', d),
    e = addDays(b, -1);
  return a.getMonth() === e.getMonth()
    ? `${a.getDate()}–${e.getDate()} ${e.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`
    : `${a.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
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
const what = (b: Booking) => `${b.batch_code}${b.step ? ` (${b.step})` : ''}`;
/** Equipment names as said in the lab: "GB: Minivap (Organic Evaporator)" → "Minivap". The full name is in headers and the hover card. */
const shortEq = (n: string) =>
  n
    .replace(/^GB:\s*/i, '')
    .replace(/\s*\(.*\)\s*$/, '')
    .trim() || n;
/** Lab hours (weekdays 08–18): the rest of the day is shaded, as in the Overview's equipment use. */
const LAB_FROM = 8,
  LAB_TO = 18;
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
  const [draft, setDraft] = useState<Draft | null>(null),
    [eqOpen, setEqOpen] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    justDragged = useRef(false);
  const [sb, setSb] = useState<{ id: number; code: string; snapshot: { stack: StackD }; status: string } | null>(null),
    [sbBooks, setSbBooks] = useState<Booking[]>([]);
  const loadSb = () => {
    if (scheduling) {
      api<any>('/batches/' + scheduling)
        .then(setSb)
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
  const eqs = (data?.equipment ?? []).filter((e) => e.active),
    shown = eqs.filter((e) => !hidden.includes(e.id));
  const list = (data?.bookings ?? []).filter((b) => shown.some((e) => e.id === b.equipment_id));
  const canManage = me.role === 'admin';
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
    const clash = !!clashOf(data?.bookings ?? [], eqs, d.eq, start, end, d.kind === 'move' ? d.booking.id : undefined);
    return {
      day,
      eq: d.eq,
      start: m,
      dur: d.dur,
      color: d.color,
      label: d.label,
      ok: (!colEq || colEq === d.eq) && !clash,
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
        if (p) showToast(`${data?.equipment.find((q) => q.id === drag.eq)?.name} is not free there`);
        return;
      }
      const start = at(p.day, '00:00').getTime() + p.start * 6e4,
        body = { start: new Date(start).toISOString(), end: new Date(start + p.dur * 6e4).toISOString() };
      const req =
        drag.kind === 'bundle'
          ? api('/bookings', 'POST', { equipment_id: drag.eq, batch_id: scheduling, step: drag.bundle.step, ...body })
          : api('/bookings/' + drag.booking.id, 'PUT', {
              equipment_id: drag.booking.equipment_id,
              batch_id: drag.booking.batch_id,
              step: drag.booking.step,
              note: drag.booking.note,
              ...body,
            });
      req
        .then(() => {
          load();
          loadSb();
          batchesChanged();
          showToast(
            drag.kind === 'bundle' ? `${drag.label} placed, ${hm(new Date(start))}` : `Moved to ${hm(new Date(start))}`,
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
    // never shorter than the shortest booking
    if (r.edge === 'start') s = Math.min(d0 + m * 6e4, e - MIN_BOOK * 6e4);
    else e = Math.max(d0 + m * 6e4, s + MIN_BOOK * 6e4);
    const clash = !!clashOf(data?.bookings ?? [], eqs, r.b.equipment_id, s, e, r.b.id);
    return { s, e, clash };
  };
  useEffect(() => {
    if (!resize) return;
    const show = (y: number) => {
      const { s, e, clash } = resized(resize, y),
        d0 = at(resize.day, '00:00').getTime();
      setPreview({
        day: resize.day,
        eq: resize.b.equipment_id,
        start: Math.round((s - d0) / 6e4),
        dur: Math.round((e - s) / 6e4),
        color: resize.b.color,
        label: resize.b.equipment,
        ok: !clash,
      });
    };
    const mv = (ev: PointerEvent) => show(ev.clientY);
    const up = (ev: PointerEvent) => {
      const { s, e, clash } = resized(resize, ev.clientY),
        b = resize.b;
      setResize(null);
      setPreview(null);
      justDragged.current = true;
      setTimeout(() => {
        justDragged.current = false;
      }, 0);
      if (s === new Date(b.start).getTime() && e === new Date(b.end).getTime()) return;
      if (clash) return showToast(`${b.equipment} is not free then`);
      api('/bookings/' + b.id, 'PUT', {
        equipment_id: b.equipment_id,
        batch_id: b.batch_id,
        step: b.step,
        note: b.note,
        start: new Date(s).toISOString(),
        end: new Date(e).toISOString(),
      })
        .then(() => {
          load();
          loadSb();
          batchesChanged();
          showToast(`${b.equipment}: now ${hm(new Date(s))}–${hm(new Date(e))}`);
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
      if ((e.target as HTMLElement)?.closest('input,select,textarea') || draft || eqOpen) return;
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
        {canManage && (
          <button className="btn secondary" onClick={() => setEqOpen(true)}>
            Equipment
          </button>
        )}
        <button
          className="btn"
          onClick={() => {
            const s = new Date();
            s.setMinutes(Math.ceil(s.getMinutes() / 30) * 30, 0, 0);
            if (!sameDay(s, date) && view === 'day') {
              s.setTime(date.getTime() + 9 * 3.6e6);
            }
            newAt(s, new Date(s.getTime() + 3.6e6));
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
          {canManage ? (
            <button className="btn" onClick={() => setEqOpen(true)}>
              Add equipment
            </button>
          ) : (
            <p className="mut">An admin or manager adds the lab’s equipment first.</p>
          )}
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
        />
      )}
      {scheduling && !narrow && data && (
        <Tray
          batch={sb}
          books={sbBooks}
          eqs={eqs}
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
      {data && !data.batches.length && (
        <p className="mut small cal-hint">
          To book equipment, plan a batch first: start one from a stack in Planned status. Its bookings then appear
          here, and the batch switches to Running when its first booking starts.
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
      {eqOpen && data && <EquipmentDialog eqs={data.equipment} onClose={() => setEqOpen(false)} reload={load} />}
    </div>
  );
}

// ------------------------------------------------------------------ day and week
const OUTCOME: Record<string, string> = { done: 'Concluded', postponed: 'Postponed', canceled: 'Canceled' };
/** Everything about a booking, next to its block (right of it, or left when there is no room). */
function HoverCard({ b, r, cleanup = 0 }: { b: Booking; r: DOMRect; cleanup?: number }) {
  const W = 270,
    s = new Date(b.start),
    e = new Date(b.end),
    mins = Math.round((e.getTime() - s.getTime()) / 6e4);
  const left = r.right + 10 + W < window.innerWidth ? r.right + 10 : Math.max(8, r.left - 10 - W),
    top = Math.max(8, Math.min(r.top, window.innerHeight - 220));
  return (
    <div className="bk-card" style={{ left, top, width: W, '--eq': b.color } as React.CSSProperties} role="tooltip">
      <div className="bk-card-h">
        <b>{b.equipment}</b>
        <i className="cbar" />
      </div>
      <dl>
        <dt>Experiment</dt>
        <dd>{what(b)}</dd>
        <dt>Booked by</dt>
        <dd>{b.user_name}</dd>
        <dt>When</dt>
        <dd>
          {s.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, {hm(s)}–{hm(e)}{' '}
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
}: {
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
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR_PX;
  }, [view]); // the working day in view
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
  // empty Saturday and Sunday columns are narrow, so the working days get the room
  const busyCol = cols.map(
    (c) =>
      view === 'day' ||
      ![0, 6].includes(c.day.getDay()) ||
      list.some(
        (b) => new Date(b.end).getTime() > c.day.getTime() && new Date(b.start).getTime() < c.day.getTime() + DAY,
      ),
  );
  const template = `52px ${cols.map((_, i) => (busyCol[i] ? `minmax(${view === 'day' ? 140 : 96}px, 1fr)` : 'minmax(48px, 0.4fr)')).join(' ')}`;
  return (
    <div className={'tg tg-' + view}>
      {card &&
        createPortal(
          <HoverCard b={card.b} r={card.r} cleanup={eqs.find((x) => x.id === card.b.equipment_id)?.cleanup ?? 0} />,
          document.body,
        )}
      <div className="tg-scroll" ref={scroller}>
        <div className="tg-head" style={{ gridTemplateColumns: template }}>
          <span />
          {cols.map((c) =>
            c.eq ? (
              <div key={c.key} className="tg-col-h">
                <i style={{ background: c.eq.color }} />
                <b>{c.eq.name}</b>
                {c.eq.place && <span className="mut small">{c.eq.place}</span>}
              </div>
            ) : (
              <div
                key={c.key}
                className={
                  'tg-col-h day' + (sameDay(c.day, today) ? ' today' : '') + (busyCol[cols.indexOf(c)] ? '' : ' slim')
                }
              >
                <span className="mut small">{c.day.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                <b>{c.day.getDate()}</b>
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
                className={
                  'tg-col' +
                  (sameDay(c.day, today) ? ' today' : '') +
                  (c.eq || ![0, 6].includes(c.day.getDay()) ? '' : ' weekend')
                }
                style={
                  {
                    '--lab-from': `${LAB_FROM * HOUR_PX}px`,
                    '--lab-to': `${LAB_TO * HOUR_PX}px`,
                  } as React.CSSProperties
                }
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
    nm = namer(list);
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  return (
    <div className="month">
      {days.slice(0, 7).map((d) => (
        <div key={'h' + d.getDay()} className="month-h">
          {d.toLocaleDateString('en-GB', { weekday: 'short' })}
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
              'month-cell' + (d.getMonth() !== date.getMonth() ? ' out' : '') + (sameDay(d, today) ? ' today' : '')
            }
            onClick={() => onDay(d)}
          >
            <span className="month-d">{d.getDate()}</span>
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
  const batches =
    existing && !data.batches.some((b) => b.id === draft.batch_id)
      ? [{ id: draft.batch_id!, code: draft.batch_code!, name: draft.batch_name ?? '' }, ...data.batches]
      : data.batches;
  const eqs = data.equipment.filter((e) => e.active || e.id === draft.equipment_id);
  const [f, setF] = useState({
    eq: draft.equipment_id ?? 0,
    batch: draft.batch_id ?? batches[0]?.id ?? 0,
    step: draft.step ?? '',
    note: draft.note ?? '',
    day: ymd(s0),
    from: hhmm(s0),
    to: hhmm(e0),
    force: false,
  });
  const [steps, setSteps] = useState<string[]>([]),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (f.batch)
      api<any>('/batches/' + f.batch)
        .then((b) => setSteps((b.snapshot?.stack?.sl ?? []).map((x: any) => x.n).filter(Boolean)))
        .catch(() => setSteps([]));
  }, [f.batch]);
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
    hours = (end.getTime() - start.getTime()) / 3.6e6;
  const ok = !!f.eq && !!f.batch && hours >= MIN_BOOK / 60 && (!clash || (isAdmin && f.force));
  const body = () => ({
    equipment_id: f.eq,
    batch_id: f.batch,
    step: f.step,
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
      .then(() => {
        showToast(existing ? 'Booking saved' : `Booked ${eq?.name}, ${hm(start)}–${hm(end)}`);
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
        {!existing && !batches.length ? (
          <div className="stack-form-sm">
            <p>
              Bookings belong to a batch, and you have no Planned or Running batch. Open a stack and start a batch, then
              book the equipment for it.
            </p>
            <div className="dialog-actions">
              <button className="link" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        ) : ro ? (
          <div className="stack-form-sm">
            <p>
              <b>
                {hm(s0)}–{hm(e0)}
              </b>
              , {s0.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <p>
              Batch {draft.batch_code}
              {draft.step ? `, ${draft.step}` : ''}. Booked by {draft.user_name}.
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
                    onClick={() => setF({ ...f, eq: e.id })}
                  >
                    {e.name}
                    <i />
                  </button>
                ))}
              </div>
            </div>
            <div className="grid2">
              <label className="fld">
                <span>Batch</span>
                <select value={f.batch} onChange={(e) => setF({ ...f, batch: +e.target.value, step: '' })}>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code}
                      {b.name ? ` (${b.name})` : ''}
                      {b.status === 'running' ? ', running' : ''}
                    </option>
                  ))}
                </select>
              </label>
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
            </div>
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
              {hours >= MIN_BOOK / 60
                ? `${hours % 1 ? hours.toFixed(2).replace(/0$/, '') : hours} h${!sameDay(start, end) ? ', ending the next day' : ''}${eq?.cleanup ? `, then ${eq.cleanup} min of cleanup` : ''}`
                : 'A booking is at least 1 hour.'}
            </p>
            {start < new Date() && batches.find((b) => b.id === f.batch)?.status !== 'running' && (
              <p className="mut small">This starts in the past, so the batch switches to Running when you book.</p>
            )}
            {clash && (
              <div className="clash" role="alert">
                <b>{clash.equipment}</b> is booked by {clash.user_name} for batch {clash.batch_code},{' '}
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
            <label className="fld">
              <span>Note</span>
              <input
                value={f.note}
                placeholder="Optional, e.g. needs the N₂ line"
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
              {existing && onOpenBatch && (
                <button type="button" className="link" onClick={() => onOpenBatch(draft.batch_id!)}>
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
  onStart,
  onEnd,
}: {
  batch: { id: number; code: string; snapshot: { stack: StackD }; status: string } | null;
  books: Booking[];
  eqs: Eq[];
  onStart: (d: Drag) => void;
  onEnd?: (back: boolean) => void;
}) {
  if (!batch)
    return (
      <div className="tray">
        <p className="mut">Loading the batch…</p>
      </div>
    );
  const blocks = bundlesOf(batch.snapshot.stack),
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
          const eq = eqs.find((e) => e.role === b.role),
            placed = placedOf(b, books);
          return (
            <button
              key={b.key}
              type="button"
              className={'tray-block' + (placed ? ' placed' : '') + (eq ? '' : ' missing')}
              style={
                {
                  '--eq': eq?.color ?? 'var(--sep)',
                  height: Math.max(52, Math.min(110, (b.minutes / 60) * HOUR_PX)),
                } as React.CSSProperties
              }
              disabled={!eq || !!placed}
              title={
                !eq
                  ? `No equipment is set up for ${ROLE_NAME[b.role].toLowerCase()} (an admin sets the procedure under Equipment)`
                  : placed
                    ? `Placed: ${new Date(placed.start).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                    : 'Drag onto the calendar'
              }
              onPointerDown={(e) => {
                if (!eq || placed || e.button !== 0) return;
                e.preventDefault();
                onStart({
                  kind: 'bundle',
                  bundle: b,
                  eq: eq.id,
                  dur: Math.max(MIN_BOOK, b.minutes),
                  color: eq.color,
                  label: eq.name,
                  grab: Math.min(30, b.minutes / 2),
                });
              }}
            >
              <b>{eq?.name ?? ROLE_NAME[b.role]}</b>
              <span>{b.layers.join(', ')}</span>
              <span className="tray-t">
                {placed
                  ? `✓ ${new Date(placed.start).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })} ${hm(new Date(placed.start))}`
                  : `${b.minutes >= 60 ? `${Math.floor(b.minutes / 60)} h${b.minutes % 60 ? ` ${b.minutes % 60}` : ''}` : `${b.minutes} min`}`}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ equipment (admins)
function EquipmentDialog({ eqs, onClose, reload }: { eqs: Eq[]; onClose: () => void; reload: () => void }) {
  // the order is the order of the Day view's columns and of the pickers; dragged here, saved when the dragging pauses
  const [local, setLocal] = useState<Eq[] | null>(null),
    saveT = useRef(0);
  const list = local ?? eqs;
  const order = useReorder(
    list,
    (l) => {
      setLocal(l);
      window.clearTimeout(saveT.current);
      saveT.current = window.setTimeout(
        () =>
          api('/equipment/order', 'PUT', { ids: l.map((x) => x.id) })
            .then(reload)
            .finally(() => setLocal(null)),
        500,
      );
    },
    'equipment',
  );
  const [name, setName] = useState(''),
    [color, setColor] = useState('#2563eb'),
    [role, setRole] = useState(''),
    [err, setErr] = useState('');
  const run = (p: Promise<unknown>) =>
    p
      .then(() => {
        setErr('');
        reload();
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide eq-dialog" role="dialog" aria-label="Equipment">
        <div className="dialog-head">
          <h2>Equipment</h2>
          <button className="iconbtn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="mut small">
          What can be booked, its colour in the calendar, the procedure it is used for (the batch scheduler books it for
          those steps), and how long it stays taken after each booking to be cleaned (gloveboxes: 20 min). Bookings are
          at least 1 hour.
        </p>
        <div className="eq-table" role="table">
          <div className="eq-h" role="row">
            <span />
            <span>Colour</span>
            <span>Name</span>
            <span>Procedure</span>
            <span title="Minutes the equipment stays taken after each booking, to clean it">Cleanup after</span>
            <span />
          </div>
          {list.map((e, i) => (
            <div key={e.id} className={'eq-r' + (order.drag === i ? ' dragging' : '')} role="row" ref={order.rowRef(i)}>
              <DragHandle h={order.handle(i)} show={list.length > 1} />
              <input
                type="color"
                aria-label={`Colour of ${e.name}`}
                defaultValue={e.color}
                onChange={(x) => run(api('/equipment/' + e.id, 'PATCH', { color: x.target.value }))}
              />
              <input
                aria-label="Name"
                defaultValue={e.name}
                onBlur={(x) =>
                  x.target.value.trim() &&
                  x.target.value.trim() !== e.name &&
                  run(api('/equipment/' + e.id, 'PATCH', { name: x.target.value.trim() }))
                }
              />
              <select
                aria-label="Procedure"
                value={e.role}
                onChange={(x) => run(api('/equipment/' + e.id, 'PATCH', { role: x.target.value }))}
              >
                {USED_FOR.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <label className="eq-clean">
                <input
                  type="number"
                  min={0}
                  max={240}
                  step={5}
                  aria-label={`Cleanup after each booking of ${e.name}, minutes`}
                  defaultValue={e.cleanup ?? 0}
                  onBlur={(x) => {
                    const v = Math.max(0, Math.min(240, Math.round(+x.target.value || 0)));
                    if (v !== (e.cleanup ?? 0)) run(api('/equipment/' + e.id, 'PATCH', { cleanup: v }));
                  }}
                />
                <span className="mut small">min</span>
              </label>
              <button
                className="link small danger-link"
                onClick={() =>
                  window.confirm(`Remove ${e.name}? Past bookings of it are removed too.`) &&
                  run(api('/equipment/' + e.id, 'DELETE'))
                }
              >
                Remove
              </button>
            </div>
          ))}
          <form
            className="eq-r new"
            role="row"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                api('/equipment', 'POST', { name: name.trim(), color, role }).then(() => {
                  setName('');
                  setRole('');
                }),
              );
            }}
          >
            <span />
            <input type="color" aria-label="Colour" value={color} onChange={(e) => setColor(e.target.value)} />
            <input
              aria-label="Name"
              value={name}
              placeholder="New equipment, e.g. Profilometer"
              onChange={(e) => setName(e.target.value)}
            />
            <select aria-label="Procedure" value={role} onChange={(e) => setRole(e.target.value)}>
              {USED_FOR.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <span className="mut small">{/^GB:/i.test(name) ? '20 min' : '—'}</span>
            <button className="btn" disabled={!name.trim()}>
              Add
            </button>
          </form>
        </div>
        {err && <p className="err small">{err}</p>}
      </div>
    </div>
  );
}
