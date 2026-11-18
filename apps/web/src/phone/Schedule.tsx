import { useMemo, useState } from 'react';
import type { PhoneProps } from '../modules/types';
import { Seg } from '../lib/ui';
import { Picker } from '../views/Picker';
import { BookingForm, type Booking, type Draft } from '../views/Calendar';
import { BookingRow, addDays, dayIn, dayName, dmy, isoDay, startOfDay, useCal, weekday } from './parts';

/**
 * Schedule on the phone (0.55): my bookings for the next 14 days, or one equipment's day; book a slot. The booking form is
 * the Calendar's own, so the rules are the same (training, cleanup, clashes, out of service, working hours). Ended bookings
 * are answered Concluded / Postponed / Canceled in the question that opens by itself, followed by the run data.
 */
const DAYS = 14;

/** The next quarter hour from now, for an hour (or the equipment's shortest booking). */
function slot(day: Date, minutes = 60) {
  const now = new Date(),
    s = startOfDay(day).getTime() === startOfDay(now).getTime() ? new Date(now) : new Date(day.setHours(9, 0, 0, 0));
  s.setMinutes(Math.ceil(s.getMinutes() / 15) * 15, 0, 0);
  return { start: s.toISOString(), end: new Date(s.getTime() + minutes * 6e4).toISOString() };
}

export default function Schedule({ me, view }: PhoneProps) {
  const [mode, setMode] = useState<'mine' | 'eq'>('mine'),
    [eqId, setEqId] = useState(0),
    [day, setDay] = useState(() => startOfDay(new Date())),
    [form, setForm] = useState<Draft | null>(null);
  const from = useMemo(() => (mode === 'mine' ? startOfDay(new Date()) : day), [mode, day]);
  const { d, err, load } = useCal(from, mode === 'mine' ? DAYS : 1);
  const bookable = (d?.equipment ?? []).filter((e) => e.active && e.booked !== false);
  const eq = bookable.find((e) => e.id === eqId) ?? null;
  const list = (d?.bookings ?? []).filter((k) =>
    mode === 'mine' ? k.mine && k.outcome !== 'canceled' && new Date(k.end) > new Date() : k.equipment_id === eqId,
  );
  // my bookings grouped by day
  const days = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const k of list) {
      const key = isoDay(new Date(k.start));
      m.set(key, [...(m.get(key) ?? []), k]);
    }
    return [...m.entries()];
  }, [list]);
  const book = () =>
    setForm({
      equipment_id: mode === 'eq' && eq ? eq.id : undefined,
      ...slot(mode === 'eq' ? new Date(day) : new Date(), eq?.min_booking ?? 60),
    });
  return (
    <div className="ph-stack">
      <Seg
        value={mode}
        on={setMode}
        opts={[
          ['mine', 'My bookings'],
          ['eq', 'By equipment'],
        ]}
      />
      {mode === 'eq' && (
        <section className="group ph-eqday">
          <label className="ph-field">
            <span>Equipment</span>
            <Picker
              label="Equipment"
              value={eqId ? String(eqId) : ''}
              onChange={(v) => setEqId(+v)}
              empty="Choose equipment"
              options={bookable.map((e) => ({ value: String(e.id), label: e.name }))}
            />
          </label>
          <div className="ph-daynav">
            <button className="btn secondary" aria-label="Day before" onClick={() => setDay(addDays(day, -1))}>
              ‹
            </button>
            {/* 0.55.4: our own text (dd/mm/yyyy, full weekday) over a transparent date field. Safari drew the field
                at its own width, past the › button, and in its own format ("18 Nov 2026"). */}
            <label className="ph-day">
              <b>
                {weekday(day)} {dmy(day)}
              </b>
              {/^(Today|Tomorrow|Yesterday)$/.test(dayName(day)) && <span>{dayName(day)}</span>}
              <input
                type="date"
                aria-label="Day"
                value={isoDay(day)}
                onChange={(e) => e.target.value && setDay(startOfDay(new Date(e.target.value + 'T00:00')))}
              />
            </label>
            <button className="btn secondary" aria-label="Day after" onClick={() => setDay(addDays(day, 1))}>
              ›
            </button>
          </div>
        </section>
      )}
      {d && !bookable.length && (
        <p className="mut ph-hint">No equipment yet, so nothing can be booked. It is added in the full app.</p>
      )}
      <button className="btn ph-wide" disabled={!d || !bookable.length} onClick={book}>
        {mode === 'eq' && eq ? `Book ${eq.name}` : 'Book equipment'}
      </button>
      {!d ? (
        <p className="mut">{err || 'Loading…'}</p>
      ) : mode === 'eq' && !eq ? (
        <p className="mut ph-hint">Choose equipment to see its day.</p>
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
            <p className="mut">
              {eq!.name} is free {dayIn(day)}.
            </p>
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
