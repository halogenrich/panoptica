import type { CSSProperties } from 'react';
import { DEFAULT_HOURS, minutesOf, type WorkDay } from '@psc/core';
import type { Booking } from '../views/Calendar';
import { addDays, dmy, hm, startOfDay, weekday } from './parts';

/**
 * The week on the phone (0.56): one row per working day of the lab (days off do not show on the phone: Richard), each a bar over
 * the lab's working hours with every booking as a block in its equipment's colour, so a busy day shows at a glance. Every row
 * shares one time scale, from the earliest working start to the latest working end of the week; a booking that runs past it is
 * cut at the edge and pointed like an arrow. Overlapping bookings (several pieces of equipment at once) take lanes of the bar.
 * Tapping a day opens its list.
 */

/** Height of a bar with one lane, and the narrowest a lane gets before the bar grows (px). */
const BAR = 30,
  LANE_MIN = 8,
  GAP = 2;

type Block = { k: Booking; a: number; z: number; cutL: boolean; cutR: boolean; lane: number };

/** The minutes the week's scale covers: earliest start to latest end of the working days. */
export function scaleOf(hours: WorkDay[]) {
  const on = hours.filter((h) => h.on);
  const days = on.length ? on : DEFAULT_HOURS.filter((h) => h.on);
  const lo = Math.min(...days.map((h) => minutesOf(h.from))),
    hi = Math.max(...days.map((h) => minutesOf(h.to)));
  return hi > lo ? { lo, hi } : { lo: 0, hi: 24 * 60 };
}

/** The days a week shows: the lab's working days, Monday first (all seven if the lab has marked none). */
export function weekDays(from: Date, hours: WorkDay[]) {
  const all = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const on = all.filter((_, i) => hours[i]?.on);
  return on.length ? on : all;
}

/** A day's bookings as blocks on the scale, in percent, each in the first lane free at its start. */
function blocksOf(day: Date, list: Booking[], lo: number, hi: number) {
  const t0 = day.getTime() + lo * 6e4,
    t1 = day.getTime() + hi * 6e4,
    d0 = day.getTime(),
    d1 = addDays(day, 1).getTime(),
    span = t1 - t0;
  const here = list
    .filter((k) => new Date(k.end).getTime() > d0 && new Date(k.start).getTime() < d1)
    .sort((x, y) => +new Date(x.start) - +new Date(y.start));
  const ends: number[] = [];
  return here.map((k): Block => {
    const s = new Date(k.start).getTime(),
      e = new Date(k.end).getTime();
    let a = Math.max(0, Math.min(100, ((s - t0) / span) * 100)),
      z = Math.max(0, Math.min(100, ((e - t0) / span) * 100));
    // a booking wholly outside the scale (an evening run) still shows, as a sliver at the edge it went past
    if (z - a < 2) [a, z] = z >= 100 ? [98, 100] : a <= 0 ? [0, 2] : [a, Math.min(100, a + 2)];
    let lane = ends.findIndex((x) => x <= a);
    if (lane < 0) lane = ends.push(z) - 1;
    else ends[lane] = z;
    return { k, a, z, cutL: s < t0, cutR: e > t1, lane };
  });
}

/** Tick hours for a scale: every hour up to 6 h, every 2 h up to 12 h, else every 4 h. */
function ticks(lo: number, hi: number) {
  const span = (hi - lo) / 60,
    step = span <= 6 ? 1 : span <= 12 ? 2 : 4;
  const out: number[] = [];
  for (let h = Math.ceil(lo / 60 / step) * step; h * 60 <= hi; h += step) out.push(h);
  return out;
}

export function Week({
  from,
  hours,
  list,
  onDay,
  showLegend,
}: {
  from: Date;
  hours: WorkDay[];
  /** the week's bookings to draw (canceled ones left out by the caller) */
  list: Booking[];
  onDay: (d: Date) => void;
  /** a key of the equipment's colours (with All equipment) */
  showLegend: boolean;
}) {
  const { lo, hi } = scaleOf(hours),
    days = weekDays(from, hours),
    today = startOfDay(new Date()).getTime(),
    now = new Date(),
    nowMin = now.getHours() * 60 + now.getMinutes(),
    pct = (m: number) => `${((m - lo) / (hi - lo)) * 100}%`,
    hrs = ticks(lo, hi);
  const shown = new Set(days.map((d) => d.getTime()));
  // bookings on days off: not drawn, but said, so nobody thinks the week is emptier than it is
  const offDays = list.filter((k) => !shown.has(startOfDay(new Date(k.start)).getTime())).length;
  const legend = showLegend
    ? [...new Map(list.map((k) => [k.equipment_id, { name: k.equipment, color: k.color }])).values()]
    : [];
  return (
    <section className="group ph-week" aria-label="Week">
      {/* the key first: on a phone the end of the week is often below the fold, far from the blocks it explains */}
      {legend.length > 1 && (
        <div className="ph-wk-key">
          {legend.map((e) => (
            <span key={e.name} className="ph-eq" style={{ '--c': e.color } as CSSProperties}>
              {e.name}
            </span>
          ))}
        </div>
      )}
      <div className="ph-wk-axis" aria-hidden="true">
        <span />
        <span className="ph-wk-scale">
          {hrs.map((h) => (
            <span key={h} style={{ left: pct(h * 60) }}>
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </span>
      </div>
      {days.map((d) => {
        const bl = blocksOf(d, list, lo, hi),
          lanes = Math.max(1, ...bl.map((b) => b.lane + 1)),
          laneH = Math.max(LANE_MIN, Math.floor((BAR - (lanes - 1) * GAP) / lanes)),
          h = Math.max(BAR, lanes * laneH + (lanes - 1) * GAP),
          isToday = d.getTime() === today,
          n = bl.length;
        return (
          <button
            key={d.getTime()}
            className={'ph-wk-row' + (isToday ? ' today' : '')}
            onClick={() => onDay(d)}
            aria-label={`${weekday(d, true)} ${dmy(d)}${isToday ? ', today' : ''}: ${n ? `${n} booking${n > 1 ? 's' : ''}` : 'nothing booked'}`}
          >
            <span className="ph-wk-d">
              <b>{weekday(d)}</b>
              <span>{dmy(d).slice(0, 5)}</span>
            </span>
            <span className="ph-wk-bar" style={{ height: h }}>
              {/* lines at the inner hours only: the bar's own ends mark the start and end of the day */}
              {hrs
                .filter((t) => t * 60 > lo && t * 60 < hi)
                .map((t) => (
                  <i key={t} className="ph-wk-tick" style={{ left: pct(t * 60) }} />
                ))}
              {bl.map((b) => (
                <span
                  key={b.k.id}
                  className={'ph-wk-b' + (b.cutL ? ' cut-l' : '') + (b.cutR ? ' cut-r' : '')}
                  title={`${hm(b.k.start)}–${hm(b.k.end)} ${b.k.equipment}, ${b.k.user_name}`}
                  style={
                    {
                      left: `${b.a}%`,
                      width: `${b.z - b.a}%`,
                      top: b.lane * (laneH + GAP),
                      height: laneH,
                      '--c': b.k.color,
                    } as CSSProperties
                  }
                />
              ))}
              {isToday && nowMin > lo && nowMin < hi && <i className="ph-wk-now" style={{ left: pct(nowMin) }} />}
            </span>
            <span className="ph-wk-go" aria-hidden="true">
              ›
            </span>
          </button>
        );
      })}
      {!list.length && <p className="mut ph-hint">Nothing booked this week.</p>}
      {offDays > 0 && (
        <p className="mut ph-hint">
          {offDays === 1 ? '1 booking is' : `${offDays} bookings are`} on a day off, so not shown here. By equipment
          lists {offDays === 1 ? 'it' : 'them'}.
        </p>
      )}
    </section>
  );
}
