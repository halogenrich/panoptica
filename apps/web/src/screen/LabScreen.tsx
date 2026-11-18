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
 * The lab screen (0.59): a TV in the lab, opened from the sign-in screen with the screen password an admin sets. Two pages take
 * turns: the equipment and the week's bookings; then the best device of the week (from Electronic Devices), the month's
 * birthdays and the gloveboxes' O₂ and H₂O. The time and date stay at the top middle on every page (Richard). Everything is sized
 * from the window (a 1920 × 1080 TV, scaled for 720p and 4K), the theme follows Admin settings › Lab screen (Light by default),
 * and it reads the server again on every change and every minute, so it never needs touching.
 */
type Eq = {
  id: number;
  name: string;
  color: string;
  state: 'use' | 'free' | 'off';
  until?: string;
  by?: string;
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

export default function LabScreen({ lab, onLeave }: { lab: LabPublic; onLeave: () => void }) {
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
            <p>The lab screen is off. An admin turns it on in Admin settings › Lab screen.</p>
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
  return <Screen d={data} lost={lost} />;
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

function Screen({ d, lost }: { d: ScreenData; lost: boolean }) {
  const now = useNow(),
    [page, setPage] = useState(0),
    [idle, setIdle] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setPage((p) => (p + 1) % 2), d.interval * 1000);
    return () => clearInterval(t);
  }, [d.interval]);
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
    window.addEventListener('pointermove', move);
    window.addEventListener('dblclick', dbl);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('dblclick', dbl);
    };
  }, []);
  const logo = d.hasLogo ? `/api/lab/logo?v=${d.bgV}` : '';
  return (
    <main className={'ls' + (idle ? ' idle' : '')} data-page={page + 1}>
      <header className="ls-top">
        <span className="ls-lab">
          {logo ? <img src={logo} alt="" /> : null}
          <span>{d.name}</span>
        </span>
        <div className="ls-clock">
          <time className="ls-time" dateTime={now.toISOString()}>
            {hm(now)}
          </time>
          <span className="ls-date">
            {weekday(now)} {dmy(now)}
          </span>
        </div>
        <div className="ls-pages">
          {lost && <span className="ls-lost">PANOPTICA cannot be reached. Trying again.</span>}
          <span className="ls-dots" aria-label={`Page ${page + 1} of 2`}>
            {[0, 1].map((i) => (
              <i key={i} className={i === page ? 'on' : ''} />
            ))}
          </span>
        </div>
      </header>
      <div className="ls-page" hidden={page !== 0} aria-hidden={page !== 0}>
        <PageOne d={d} now={now} />
      </div>
      <div className="ls-page" hidden={page !== 1} aria-hidden={page !== 1}>
        <PageTwo d={d} now={now} logo={logo} />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- page 1: equipment and the week

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
  const many = d.equipment.length > 7;
  return (
    <div className="ls-p1">
      <section className="ls-panel ls-eqs" aria-label="Equipment">
        <h2>Equipment</h2>
        {!d.equipment.length ? (
          <p className="ls-empty">No equipment is booked in PANOPTICA yet.</p>
        ) : (
          <ul className={many ? 'two' : ''}>
            {d.equipment.map((e) => (
              <li key={e.id} className={'ls-eq ' + e.state}>
                <span className="ls-eq-name" style={{ '--c': e.color } as CSSProperties}>
                  {e.name}
                </span>
                <span className="ls-eq-state">
                  <b>{e.state === 'use' ? 'In use' : e.state === 'off' ? 'Out of service' : 'Free'}</b>
                  <span>
                    {e.state === 'use'
                      ? `${e.by}, until ${when(e.until!, now)}`
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

// ---------------------------------------------------------------- page 2: best device, birthdays, gloveboxes

function PageTwo({ d, now, logo }: { d: ScreenData; now: Date; logo: string }) {
  const parts = MODULES.filter((m) => m.screen && d.modules[m.id]);
  const month = now.toLocaleDateString('en-GB', { month: 'long' }),
    today = now.getDate();
  return (
    <div className={'ls-p2' + (parts.length ? '' : ' core')}>
      {parts.map((m) => {
        const Part = m.screen!;
        return <Part key={m.id} m={d.modules[m.id]} logo={logo} />;
      })}
      <div className="ls-side">
        <section className="ls-panel ls-bdays" aria-label="Birthdays">
          <h2>Birthdays in {month}</h2>
          {!d.birthdays.length ? (
            <p className="ls-empty">No birthdays this month.</p>
          ) : (
            <ul className={d.birthdays.length > 6 ? 'two' : ''}>
              {d.birthdays.map((b) => (
                <li key={b.name + b.day} className={b.day === today ? 'today' : b.day < today ? 'past' : ''}>
                  <span className="ls-bday-d">{String(b.day).padStart(2, '0')}</span>
                  <span>{b.name}</span>
                  {b.day === today && <span className="ls-bday-t">Today</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        {d.atmosphere.length > 0 && (
          <section className="ls-panel ls-atmo" aria-label="Glovebox atmosphere">
            <h2>O₂ and H₂O, last 7 days</h2>
            <div className="ls-atmo-list">
              {d.atmosphere.map((g) => (
                <AtmoChart key={g.id} g={g} now={now} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
