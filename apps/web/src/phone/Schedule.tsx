import { useMemo, useState, type ReactNode } from 'react';
import type { PhoneProps } from '../modules/types';
import { Seg } from '../lib/ui';
import { useHours } from '../lib/hours';
import { Picker } from '../views/Picker';
import { BookingForm, type Booking, type Draft } from '../views/Calendar';
import { BookingRow, addDays, dayIn, dayName, dmy, isoDay, monday, startOfDay, useCal, weekday } from './parts';
import { Week, weekDays } from './Week';

/**
 * Schedule on the phone (0.55): my bookings for the next 14 days, a day by equipment, or the week (0.56); book a slot. The
 * booking form is the Calendar's own, so the rules are the same (training, cleanup, clashes, out of service, working hours).
 * Ended bookings are answered Concluded / Postponed / Canceled in the question that opens by itself, followed by the run data.
 * By equipment and Week open on All equipment (0.56): the lab's bookings together, each in its equipment's colour.
 */
const DAYS = 14;
type Mode = 'mine' | 'eq' | 'week';
/** The equipment picker's value for every piece of equipment together (0.56). */
const ALL = 'all';

/** The next quarter hour from now, for an hour (or the equipment's shortest booking). */
function slot(day: Date, minutes = 60) {
  const now = new Date(),
    s = startOfDay(day).getTime() === startOfDay(now).getTime() ? new Date(now) : new Date(day.setHours(9, 0, 0, 0));
  s.setMinutes(Math.ceil(s.getMinutes() / 15) * 15, 0, 0);
  return { start: s.toISOString(), end: new Date(s.getTime() + minutes * 6e4).toISOString() };
}

/**
 * ‹ day or week › with the date as our own text over a transparent date field (0.55.4: Safari drew the field at its own width,
 * past the › button, and in its own format). Tapping the text opens the phone's date picker.
 */
function DateNav({
  label,
  sub,
  value,
  unit,
  onPick,
  onStep,
}: {
  label: ReactNode;
  sub: string;
  value: Date;
  unit: 'Day' | 'Week';
  onPick: (d: Date) => void;
  onStep: (n: number) => void;
}) {
  return (
    <div className="ph-daynav">
      <button className="btn secondary" aria-label={`${unit} before`} onClick={() => onStep(-1)}>
        ‹
      </button>
      <label className="ph-day">
        <b>{label}</b>
        {sub && <span>{sub}</span>}
        <input
          type="date"
          aria-label={unit}
          value={isoDay(value)}
          onChange={(e) => e.target.value && onPick(startOfDay(new Date(e.target.value + 'T00:00')))}
        />
      </label>
      <button className="btn secondary" aria-label={`${unit} after`} onClick={() => onStep(1)}>
        ›
      </button>
    </div>
  );
}

/** "This week", "Next week", "Last week", or nothing. */
function weekName(from: Date) {
  const diff = Math.round((from.getTime() - monday(new Date()).getTime()) / (7 * 864e5));
  return diff === 0 ? 'This week' : diff === 1 ? 'Next week' : diff === -1 ? 'Last week' : '';
}
/** "16/11–22/11/2026"; across a new year "29/12/2026–04/01/2027". */
function weekLabel(from: Date) {
  const to = addDays(from, 6);
  return from.getFullYear() === to.getFullYear() ? `${dmy(from).slice(0, 5)}–${dmy(to)}` : `${dmy(from)}–${dmy(to)}`;
}

export default function Schedule({ me, view }: PhoneProps) {
  const [mode, setMode] = useState<Mode>('mine'),
    [eqId, setEqId] = useState(0),
    [day, setDay] = useState(() => startOfDay(new Date())),
    [form, setForm] = useState<Draft | null>(null);
  const hours = useHours();
  const from = useMemo(
    () => (mode === 'mine' ? startOfDay(new Date()) : mode === 'week' ? monday(day) : day),
    [mode, day],
  );
  const { d, err, load } = useCal(from, mode === 'mine' ? DAYS : mode === 'week' ? 7 : 1);
  const bookable = (d?.equipment ?? []).filter((e) => e.active && e.booked !== false);
  // 0 = All equipment
  const eq = bookable.find((e) => e.id === eqId) ?? null;
  const list = (d?.bookings ?? [])
    .filter((k) =>
      mode === 'mine'
        ? k.mine && k.outcome !== 'canceled' && new Date(k.end) > new Date()
        : (!eq || k.equipment_id === eq.id) && (mode === 'eq' || k.outcome !== 'canceled'),
    )
    .sort((x, y) => +new Date(x.start) - +new Date(y.start));
  // my bookings grouped by day
  const days = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const k of list) {
      const key = isoDay(new Date(k.start));
      m.set(key, [...(m.get(key) ?? []), k]);
    }
    return [...m.entries()];
  }, [list]);
  // the day a new booking starts on: the day shown; in Week, today if it is in that week, else its first working day
  const bookDay = () => {
    if (mode === 'eq') return new Date(day);
    if (mode === 'mine') return new Date();
    const t = startOfDay(new Date()),
      shown = weekDays(from, hours);
    return shown.find((x) => x.getTime() >= t.getTime()) ?? shown[0];
  };
  const book = () =>
    setForm({
      equipment_id: mode !== 'mine' && eq ? eq.id : undefined,
      ...slot(bookDay(), eq?.min_booking ?? 60),
    });
  const today = /^(Today|Tomorrow|Yesterday)$/.test(dayName(day)) ? dayName(day) : '';
  return (
    <div className="ph-stack">
      <Seg
        value={mode}
        on={setMode}
        opts={[
          ['mine', 'My bookings'],
          ['eq', 'By equipment'],
          ['week', 'Week'],
        ]}
      />
      {mode !== 'mine' && (
        <section className="group ph-eqday">
          <label className="ph-field">
            <span>Equipment</span>
            <Picker
              label="Equipment"
              value={eq ? String(eq.id) : ALL}
              onChange={(v) => setEqId(v === ALL ? 0 : +v)}
              options={[
                { value: ALL, label: 'All equipment' },
                ...bookable.map((e) => ({ value: String(e.id), label: e.name })),
              ]}
            />
          </label>
          {mode === 'eq' ? (
            <DateNav
              unit="Day"
              value={day}
              label={
                <>
                  <span>{weekday(day)}</span> <span>{dmy(day)}</span>
                </>
              }
              sub={today}
              onPick={setDay}
              onStep={(n) => setDay(addDays(day, n))}
            />
          ) : (
            <DateNav
              unit="Week"
              value={from}
              label={weekLabel(from)}
              sub={weekName(from)}
              onPick={setDay}
              onStep={(n) => setDay(addDays(from, 7 * n))}
            />
          )}
        </section>
      )}
      {d && !bookable.length && (
        <p className="mut ph-hint">No equipment yet, so nothing can be booked. It is added in the full app.</p>
      )}
      <button className="btn ph-wide" disabled={!d || !bookable.length} onClick={book}>
        {mode !== 'mine' && eq ? `Book ${eq.name}` : 'Book equipment'}
      </button>
      {!d ? (
        <p className="mut">{err || 'Loading…'}</p>
      ) : mode === 'week' ? (
        <Week
          from={from}
          hours={hours}
          list={list}
          showLegend={!eq}
          onDay={(x) => {
            setDay(x);
            setMode('eq');
          }}
        />
      ) : mode === 'eq' ? (
        <section className="group">
          {list.length ? (
            <div className="ph-list">
              {list.map((k) => (
                <button key={k.id} className="ph-tap" onClick={() => setForm(k)}>
                  <BookingRow k={k} who />
                </button>
              ))}
            </div>
          ) : (
            <p className="mut">{eq ? `${eq.name} is free ${dayIn(day)}.` : `Nothing booked ${dayIn(day)}.`}</p>
          )}
        </section>
      ) : days.length ? (
        days.map(([key, ks]) => (
          <section key={key} className="group">
            <h3>{dayName(new Date(key + 'T00:00'))}</h3>
            <div className="ph-list">
              {ks.map((k) => (
                <button key={k.id} className="ph-tap" onClick={() => setForm(k)}>
                  <BookingRow k={k} />
                </button>
              ))}
            </div>
          </section>
        ))
      ) : (
        <p className="mut ph-hint">Nothing booked for the next {DAYS} days.</p>
      )}
      {form && d && (
        <BookingForm
          draft={form}
          data={d}
          isAdmin={me.role === 'admin'}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            load();
          }}
          open={(v, id) => {
            setForm(null);
            view(v, id ?? null);
          }}
        />
      )}
    </div>
  );
}
