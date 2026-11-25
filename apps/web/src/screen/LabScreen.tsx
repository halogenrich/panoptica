import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import type { WorkDay } from '@psc/core';
import type { LabPublic } from '../ctx';
import { MODULES } from '../modules/installed';
import { SignInFrame } from '../start/Login';
import { blocksOf, scaleOf, ticks, weekDays } from '../phone/Week';
import { dmy, hm, startOfDay, weekday } from '../phone/parts';
import type { Booking } from '../views/Calendar';
import { AtmoChart, type Glovebox } from './AtmoChart';

/**
 * The lab screen (0.59): a TV in the lab, opened from the sign-in screen with the screen password an admin sets. Its screens take
 * turns (0.60.1, Richard, from photos of the TV): the equipment (in use in a light shade of its colour) and the week's bookings;
 * the best device of the week (from Electronic Devices) above today's bookings, one column per equipment with the now line kept
 * in the middle; and the gloveboxes' O₂ and H₂O (today, then the last 7 days) with the month's birthdays. Which screens show,
 * for how long, the theme and the top left are set in Admin settings › Display mode; a bar under the dots fills up until the next
 * screen. The time and date stay at the top middle on every screen. Everything is sized from the window (a 1920 × 1080 TV,
 * scaled for 720p and 4K), and it reads the server again on every change and every minute, so it never needs touching.
 */
type Eq = {
  id: number;
  name: string;
  color: string;
  state: 'use' | 'free' | 'off';
  until?: string;
  by?: string;
  /** everyone using it now (equipment several people use at once, 0.60.1) */
  users?: { by: string; end: string }[];
  reason?: string;
  next: { start: string; end: string; by: string } | null;
};
export type ScreenData = {
  version: string;
  now: string;
  name: string;
  hasLogo: boolean;
  bgV: number;
  interval: number;
  theme: 'system' | 'light' | 'dark';
  atmoSwitch: number;
  pages: (1 | 2 | 3)[];
  labShow: 'logo' | 'name' | 'both';
  inst: { show: 'none' | 'logo' | 'name' | 'both'; name: string; hasLogo: boolean };
  hours: WorkDay[];
  weekFrom: string;
  equipment: Eq[];
  week: Booking[];
  birthdays: { name: string; day: number }[];
  atmosphere: Glovebox[];
  modules: Record<string, unknown>;
};

async function get(): Promise<{ data?: ScreenData; on?: boolean }> {
  const r = await fetch('/api/screen', { credentials: 'same-origin' });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) return { on: !!d.on };
  if (!r.ok) throw new Error(d.error || r.statusText);
  return { data: d };
}

export default function LabScreen({
  lab,
  onLeave,
  inApp = false,
}: {
  lab: LabPublic;
  onLeave: () => void;
  /** opened from the app's side menu (Display mode, 0.60.1): a way back while the pointer moves */
  inApp?: boolean;
}) {
  const [data, setData] = useState<ScreenData | null>(null),
    [need, setNeed] = useState<'password' | 'off' | null>(null),
    [lost, setLost] = useState(false);
  const loaded = useRef('');
  const load = () =>
    get()
      .then((r) => {
        setLost(false);
        if (!r.data) {
          setData(null);
          setNeed(r.on ? 'password' : 'off');
          return;
        }
        // a new PANOPTICA on the server: the TV takes the new page by itself
        if (loaded.current && loaded.current !== r.data.version) return window.location.reload();
        loaded.current = r.data.version;
        setNeed(null);
        setData(r.data);
      })
      .catch(() => setLost(true));
  useEffect(() => {
    load();
  }, []);
  const on = !!data;
  // read again every minute (bookings start and end with time), and at once when something changes in the lab
  useEffect(() => {
    if (!on) return;
    const t = setInterval(load, 60e3);
    const es = new EventSource('/api/screen/events');
    let wait: ReturnType<typeof setTimeout> | undefined;
    es.onmessage = () => {
      clearTimeout(wait);
      wait = setTimeout(load, 800); // a burst of changes is read once
    };
    return () => {
      clearInterval(t);
      clearTimeout(wait);
      es.close();
    };
  }, [on]);
  // the screen's own theme, whatever the browser had
  useEffect(() => {
    if (!data) return;
    const el = document.documentElement,
      was = el.dataset.theme;
    el.dataset.theme = data.theme === 'system' ? '' : data.theme;
    return () => {
      el.dataset.theme = was ?? '';
    };
  }, [data?.theme]);
  useEffect(() => {
    document.title = 'Lab screen';
  }, []);

  if (need)
    return (
      <SignInFrame lab={lab}>
        {need === 'off' ? (
          <>
            <h1>Lab screen</h1>
            <p>The lab screen is off. An admin turns it on in Admin settings › Display mode.</p>
            <button type="button" className="link" onClick={onLeave}>
              Back to sign in
            </button>
          </>
        ) : (
          <Password onOpen={load} onLeave={onLeave} />
        )}
      </SignInFrame>
    );
  if (!data) return null;
  return <Screen d={data} lost={lost} onLeave={inApp ? onLeave : undefined} />;
}

function Password({ onOpen, onLeave }: { onOpen: () => void; onLeave: () => void }) {
  const [pw, setPw] = useState(''),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  const go = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    // full screen needs the click itself; asked before the answer arrives
    document.documentElement.requestFullscreen?.().catch(() => {});
    const r = await fetch('/api/screen/open', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    }).catch(() => null);
    setBusy(false);
    if (r?.ok) return onOpen();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    const d = await r?.json().catch(() => ({}));
    const m = (d?.error as string) || 'PANOPTICA cannot be reached';
    setErr(m.charAt(0).toUpperCase() + m.slice(1) + '.');
  };
  return (
    <>
      <h1>Lab screen</h1>
      <p className="mut">
        Shows the equipment, the week’s bookings and the lab’s news on a TV. It stays open on this browser.
      </p>
      <form className="signin-form" onSubmit={go}>
        <label className="fld">
          <span>Screen password</span>
          <input autoFocus type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        {err && <p className="err small">{err}</p>}
        <button className="btn" disabled={!pw || busy}>
          Open the lab screen
        </button>
      </form>
      <p className="signin-alt">
        <button type="button" className="link" onClick={onLeave}>
          Back to sign in
        </button>
      </p>
    </>
  );
}

/** Ticks once a second; the clock shows minutes, so a change shows within a second of it. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * Which screen shows, and the bar under the dots, from one clock (0.61). Before, a timer switched the screens and a CSS animation
 * filled the bar: two clocks that could drift apart (Richard, 25 Nov: the bar still went wrong after the seconds were changed, on
 * the lab's TV). Now each frame reads how long the current run has lasted and derives both from it. The clock is the browser's
 * monotonic one, so a change of the computer's time does not move the screens; a change of the seconds starts a new run.
 */
function useRotation(count: number, seconds: number, which: string) {
  const [at, setAt] = useState(0),
    bar = useRef<HTMLElement>(null);
  useEffect(() => {
    setAt(0);
    const ms = Math.max(1, seconds) * 1000,
      t0 = performance.now();
    let shown = 0,
      frame = 0;
    const tick = () => {
      const run = performance.now() - t0,
        i = count > 1 ? Math.floor(run / ms) % count : 0;
      if (i !== shown) setAt((shown = i));
      if (bar.current) bar.current.style.transform = `scaleX(${((run % ms) / ms).toFixed(4)})`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // a hidden tab gets no frames: the next frame catches up from the clock
    return () => cancelAnimationFrame(frame);
  }, [count, seconds, which]);
  return { at, bar };
}

function Screen({ d, lost, onLeave }: { d: ScreenData; lost: boolean; onLeave?: () => void }) {
  const now = useNow(),
    pages = d.pages?.length ? d.pages : [1, 2, 3],
    // a new set of screens starts the rotation again, as a new number of seconds does
    { at, bar } = useRotation(pages.length, d.interval, pages.join()),
    page = pages[at % pages.length],
    [idle, setIdle] = useState(false);
  // the pointer hides when nobody moves it; a double click turns full screen on and off
  useEffect(() => {
    let t = setTimeout(() => setIdle(true), 3000);
    const move = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 3000);
    };
    const dbl = () =>
      document.fullscreenElement
        ? document.exitFullscreen().catch(() => {})
        : document.documentElement.requestFullscreen?.().catch(() => {});
    // in the app, Escape goes back to it
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onLeave?.();
    window.addEventListener('pointermove', move);
    window.addEventListener('dblclick', dbl);
    window.addEventListener('keydown', key);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('dblclick', dbl);
      window.removeEventListener('keydown', key);
    };
  }, [onLeave]);
  const logo = d.hasLogo ? `/api/lab/logo?v=${d.bgV}` : '';
  const at1 = at % pages.length;
  return (
    <main className={'ls' + (idle ? ' idle' : '')} data-page={page}>
      <header className="ls-top">
        <TopLeft d={d} logo={logo} />
        <div className="ls-clock">
          <time className="ls-time" dateTime={now.toISOString()}>
            {hm(now)}
          </time>
          <span className="ls-date">
            {weekday(now)} {dmy(now)}
          </span>
        </div>
        <div className="ls-pages">
          {onLeave && !idle && (
            <button type="button" className="btn secondary ls-back" onClick={onLeave}>
              Back to PANOPTICA
            </button>
          )}
          {lost && <span className="ls-lost">PANOPTICA cannot be reached. Trying again.</span>}
          {pages.length > 1 && (
            <span className="ls-dots-wrap">
              <span className="ls-dots" aria-label={`Screen ${at1 + 1} of ${pages.length}`}>
                {pages.map((p, i) => (
                  <i key={p} className={i === at1 ? 'on' : ''} />
                ))}
              </span>
              {/* fills up until the next screen (Richard) */}
              <span className="ls-timer" aria-hidden="true">
                <i ref={bar} />
              </span>
            </span>
          )}
        </div>
      </header>
      {pages.includes(1) && (
        <div className="ls-page" hidden={page !== 1} aria-hidden={page !== 1}>
          <PageOne d={d} now={now} />
        </div>
      )}
      {pages.includes(2) && (
        <div className="ls-page" hidden={page !== 2} aria-hidden={page !== 2}>
          <PageTwo d={d} now={now} logo={logo} />
        </div>
      )}
      {pages.includes(3) && (
        <div className="ls-page" hidden={page !== 3} aria-hidden={page !== 3}>
          <PageThree d={d} now={now} shown={page === 3} />
        </div>
      )}
    </main>
  );
}

/** The top left (Display mode, 0.60.1): the lab as logo, name or both, then the institution as logo, name, both or nothing. */
function TopLeft({ d, logo }: { d: ScreenData; logo: string }) {
  const show = d.labShow ?? 'both',
    lab = show !== 'name' && logo,
    // no logo yet: the name, so the corner is never empty
    labName = show !== 'logo' || !logo,
    inst = d.inst ?? { show: 'none', name: '', hasLogo: false },
    instLogo = (inst.show === 'logo' || inst.show === 'both') && inst.hasLogo,
    instName = (inst.show === 'name' || inst.show === 'both') && inst.name;
  return (
    <span className="ls-lab">
      {lab ? <img src={logo} alt={labName ? '' : d.name} /> : null}
      {labName && <span>{d.name}</span>}
      {(instLogo || instName) && (
        <span className="ls-inst">
          {instLogo && <img src={`/api/lab/institution-logo?v=${d.bgV}`} alt={instName ? '' : inst.name} />}
          {instName && <span>{inst.name}</span>}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- screen 1: equipment and the week

const firstName = (n: string) => n.split(/\s+/)[0];
/** Black or white, whichever reads better on an equipment's colour (a name written on its block). */
function inkOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return '#fff';
  const n = parseInt(m[1], 16),
    lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4),
    y = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return y > 0.36 ? '#111' : '#fff';
}
/** "16:00" today, "Thu 09:00" this week, "Mon 24/11 09:00" later */
function when(s: string, now: Date) {
  const d = new Date(s),
    days = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 864e5);
  if (days === 0) return hm(d);
  if (days === 1) return `tomorrow ${hm(d)}`;
  if (days < 7) return `${weekday(d)} ${hm(d)}`;
  return `${weekday(d)} ${dmy(d).slice(0, 5)} ${hm(d)}`;
}

function PageOne({ d, now }: { d: ScreenData; now: Date }) {
  // the rows share the panel's height (0.60.2: the seventh was cut off on the TV); two columns past eight
  const many = d.equipment.length > 8;
  return (
    <div className="ls-p1">
      <section className="ls-panel ls-eqs" aria-label="Equipment">
        <h2>Equipment</h2>
        {!d.equipment.length ? (
          <p className="ls-empty">No equipment is booked in PANOPTICA yet.</p>
        ) : (
          <ul className={many ? 'two' : ''}>
            {d.equipment.map((e) => (
              // in use: the row in a light shade of the equipment's colour (Richard, 0.60.1)
              <li key={e.id} className={'ls-eq ' + e.state} style={{ '--c': e.color } as CSSProperties}>
                <span className="ls-eq-name">{e.name}</span>
                <span className="ls-eq-state">
                  <b>{e.state === 'use' ? 'In use' : e.state === 'off' ? 'Out of service' : 'Free'}</b>
                  <span>
                    {e.state === 'use'
                      ? (e.users?.length ? e.users : [{ by: e.by!, end: e.until! }])
                          .map((u) => `${u.by}, until ${when(u.end, now)}`)
                          .join(' · ')
                      : e.state === 'off'
                        ? `Until ${when(e.until!, now).replace(/^t/, 'T')}`
                        : e.next
                          ? `Next: ${when(e.next.start, now)}, ${firstName(e.next.by)}`
                          : 'Nothing booked'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="ls-panel ls-weekp" aria-label="This week">
        <h2>This week</h2>
        <TvWeek d={d} now={now} />
      </section>
    </div>
  );
}

/** The week as on the phone (0.56), at TV size: one row per working day, the bookings on one time scale, a name on each. */
function TvWeek({ d, now }: { d: ScreenData; now: Date }) {
  const from = startOfDay(new Date(d.weekFrom)),
    { lo, hi } = scaleOf(d.hours),
    days = weekDays(from, d.hours),
    today = startOfDay(now).getTime(),
    nowMin = now.getHours() * 60 + now.getMinutes(),
    pct = (m: number) => `${((m - lo) / (hi - lo)) * 100}%`,
    hrs = ticks(lo, hi);
  // no colour key: the equipment column beside it names each colour (design critique, 0.59)
  const rows = `auto repeat(${days.length}, minmax(0, 1fr))${d.week.length ? '' : ' auto'}`;
  return (
    <div className="ls-week" style={{ gridTemplateRows: rows }}>
      <div className="ls-wk-axis" aria-hidden="true">
        <span />
        <span className="ls-wk-scale">
          {hrs.map((h) => (
            <span key={h} style={{ left: pct(h * 60) }}>
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </span>
      </div>
      {days.map((day) => {
        const bl = blocksOf(day, d.week, lo, hi),
          lanes = Math.max(1, ...bl.map((b) => b.lane + 1)),
          isToday = day.getTime() === today;
        return (
          <div
            key={day.getTime()}
            className={'ls-wk-row' + (isToday ? ' today' : '') + (day.getTime() < today ? ' past' : '')}
          >
            <span className="ls-wk-d">
              <b>{isToday ? 'Today' : weekday(day)}</b>
              <span>{dmy(day).slice(0, 5)}</span>
            </span>
            <span className="ls-wk-bar" style={{ '--lanes': lanes } as CSSProperties}>
              {hrs
                .filter((t) => t * 60 > lo && t * 60 < hi)
                .map((t) => (
                  <i key={t} className="ls-wk-tick" style={{ left: pct(t * 60) }} />
                ))}
              {bl.map((b) => (
                <span
                  key={b.k.id}
                  className={'ls-wk-b' + (b.cutL ? ' cut-l' : '') + (b.cutR ? ' cut-r' : '')}
                  style={
                    {
                      left: `${b.a}%`,
                      width: `${b.z - b.a}%`,
                      top: `calc(${(b.lane / lanes) * 100}% + 1px)`,
                      height: `calc(${100 / lanes}% - 2px)`,
                      '--c': b.k.color,
                      '--ink': inkOn(b.k.color),
                    } as CSSProperties
                  }
                >
                  {/* a name where the block has room for one */}
                  {b.z - b.a >= 7 && lanes <= 3 && <span>{firstName(b.k.user_name)}</span>}
                </span>
              ))}
              {isToday && nowMin > lo && nowMin < hi && <i className="ls-wk-now" style={{ left: pct(nowMin) }} />}
            </span>
          </div>
        );
      })}
      {!d.week.length && <p className="ls-empty">Nothing booked this week.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- screen 2: best device and today; best devices and birthdays

/**
 * The second screen (0.60.2, Richard): laid out as the first, two columns. Left, as wide as This week: the best device of the
 * week above Today. Right, as wide as Equipment: the week's five best devices above the month's birthdays. The core alone has
 * Today and the birthdays.
 */
function PageTwo({ d, now, logo }: { d: ScreenData; now: Date; logo: string }) {
  const parts = MODULES.filter((m) => m.screen && d.modules[m.id]),
    tops = MODULES.filter((m) => m.screenTop && d.modules[m.id]);
  return (
    <div className={'ls-p2' + (parts.length ? '' : ' core')}>
      {parts.map((m) => {
        const Part = m.screen!;
        return <Part key={m.id} m={d.modules[m.id]} logo={logo} />;
      })}
      <section className="ls-panel ls-dayp" aria-label="Today">
        <h2>Today</h2>
        <TvDay d={d} now={now} />
      </section>
      {tops.map((m) => {
        const Top = m.screenTop!;
        return <Top key={m.id} m={d.modules[m.id]} />;
      })}
      <Birthdays d={d} now={now} />
    </div>
  );
}

/**
 * The month's birthdays, a third of the right column (0.60.2, Richard): two columns past four, today and the days to come first;
 * past eight, the rest is counted.
 */
function Birthdays({ d, now }: { d: ScreenData; now: Date }) {
  const month = now.toLocaleDateString('en-GB', { month: 'long' }),
    today = now.getDate(),
    order = [...d.birthdays.filter((b) => b.day >= today), ...d.birthdays.filter((b) => b.day < today)],
    shown = order.slice(0, 8),
    more = order.length - shown.length;
  return (
    <section className="ls-panel ls-bdays" aria-label="Birthdays">
      <h2>Birthdays in {month}</h2>
      {!d.birthdays.length ? (
        <p className="ls-empty">No birthdays this month.</p>
      ) : (
        <>
          <ul className={shown.length > 4 ? 'two' : ''}>
            {shown.map((b) => (
              <li key={b.name + b.day} className={b.day === today ? 'today' : b.day < today ? 'past' : ''}>
                <span className="ls-bday-d">{String(b.day).padStart(2, '0')}</span>
                <span>{b.name}</span>
                {b.day === today && <span className="ls-bday-t">Today</span>}
              </li>
            ))}
          </ul>
          {more > 0 && <p className="ls-mut ls-bday-more">and {more} more</p>}
        </>
      )}
    </section>
  );
}

/** Hours the Today view spans: the now line stays in the middle and the bookings move up as time passes (Richard). */
const SPAN_H = 6;

/**
 * Today as the Calendar's Day view (0.60.1, Richard: "just like we have in the app"): one column per equipment, time going down,
 * the red now line fixed in the middle, so a TV never needs scrolling. Overlapping bookings (equipment several people use) share
 * their column side by side.
 */
function TvDay({ d, now }: { d: ScreenData; now: Date }) {
  const t = now.getTime(),
    w0 = t - (SPAN_H / 2) * 36e5,
    w1 = t + (SPAN_H / 2) * 36e5,
    y = (ms: number) => ((Math.min(Math.max(ms, w0), w1) - w0) / (w1 - w0)) * 100;
  // the hours inside the window
  const hours: number[] = [];
  for (let h = Math.ceil(w0 / 36e5) * 36e5; h < w1; h += 36e5) hours.push(h);
  if (!d.equipment.length) return <p className="ls-empty">No equipment is booked in PANOPTICA yet.</p>;
  return (
    <div className="ls-day" style={{ '--cols': d.equipment.length } as CSSProperties}>
      <div className="ls-day-head">
        <span />
        {d.equipment.map((e) => (
          <span key={e.id} className="ls-eq-name" style={{ '--c': e.color } as CSSProperties}>
            {e.name}
          </span>
        ))}
      </div>
      <div className="ls-day-body">
        <div className="ls-day-hours" aria-hidden="true">
          {hours.map((h) => (
            <span key={h} style={{ top: `${y(h)}%` }}>
              {hm(new Date(h))}
            </span>
          ))}
        </div>
        <div className="ls-day-cols">
          {hours.map((h) => (
            <i key={h} className="ls-day-rule" style={{ top: `${y(h)}%` }} />
          ))}
          <i className="ls-day-past" style={{ height: '50%' }} />
          {d.equipment.map((e, ci) => {
            const mine = d.week
              .filter((k) => k.equipment_id === e.id)
              .map((k) => ({ k, a: new Date(k.start).getTime(), z: new Date(k.end).getTime() }))
              .filter((b) => b.z > w0 && b.a < w1)
              .sort((p, q) => p.a - q.a);
            // side by side where bookings overlap
            const ends: number[] = [],
              lane = new Map<number, number>();
            for (const b of mine) {
              let l = ends.findIndex((z) => z <= b.a);
              if (l < 0) l = ends.push(b.z) - 1;
              else ends[l] = b.z;
              lane.set(b.k.id, l);
            }
            const lanes = Math.max(1, ends.length);
            return (
              <div key={e.id} className="ls-day-col" style={{ gridColumn: ci + 1 }}>
                {mine.map((b) => {
                  const top = y(b.a),
                    h = y(b.z) - top,
                    l = lane.get(b.k.id)!;
                  return (
                    <span
                      key={b.k.id}
                      className={'ls-day-b' + (b.z <= t ? ' done' : '')}
                      style={
                        {
                          top: `${top}%`,
                          height: `${h}%`,
                          left: `${(l / lanes) * 100}%`,
                          width: `${100 / lanes}%`,
                          '--c': e.color,
                          '--ink': inkOn(e.color),
                        } as CSSProperties
                      }
                    >
                      {/* the name from about 40 minutes, the times from about 80 (the panel is shorter since 0.60.2) */}
                      {h >= 11 && <b>{firstName(b.k.user_name)}</b>}
                      {h >= 22 && (
                        <span>
                          {hm(new Date(b.a))}–{hm(new Date(b.z))}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            );
          })}
          <i className="ls-day-now" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- screen 3: O₂ and H₂O

function PageThree({ d, now, shown }: { d: ScreenData; now: Date; shown: boolean }) {
  const [span, setSpan] = useState<'day' | 'week'>('day');
  // today first, then the last 7 days after the seconds set in Display mode, and back (Richard)
  useEffect(() => {
    setSpan('day');
    if (!shown) return;
    const t = setInterval(() => setSpan((s) => (s === 'day' ? 'week' : 'day')), (d.atmoSwitch || 10) * 1000);
    return () => clearInterval(t);
  }, [shown, d.atmoSwitch]);
  const n = d.atmosphere.length,
    // the whole screen (0.60.2: the birthdays moved to the second): up to three charts a row
    cols = n <= 3 ? Math.max(1, n) : n === 4 ? 2 : 3;
  return (
    <div className="ls-p3">
      <section className="ls-panel ls-atmo" aria-label="Glovebox atmosphere">
        <div className="ls-atmo-head">
          <h2>O₂ and H₂O, {span === 'day' ? 'today' : 'last 7 days'}</h2>
          {/* which window is showing, in the look of the app's switches; it follows the timer, nothing to click (0.60.2, Richard) */}
          <span className="seg ls-span" aria-hidden="true">
            <span className={span === 'day' ? 'on' : ''}>Today</span>
            <span className={span === 'week' ? 'on' : ''}>Last 7 days</span>
          </span>
        </div>
        {!n ? (
          <p className="ls-empty">No equipment records O₂ and H₂O.</p>
        ) : (
          <div className="ls-atmo-list" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {d.atmosphere.map((g) => (
              <AtmoChart key={g.id} g={g} now={now} span={span} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
