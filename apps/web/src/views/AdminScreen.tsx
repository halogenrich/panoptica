import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { Seg, fmtDateTime } from '../lib/ui';
import { PasswordRules, passwordOk } from '../start/parts';

/**
 * Admin settings › Lab screen (0.59): turn the TV screen on or off, its password, the seconds each page shows, its theme (the
 * app's own System / Light / Dark switch; Light by default, Richard), and the O₂ and H₂O limits of the equipment that records
 * its atmosphere. A new password, or turning it off, signs every screen out.
 */
type S = {
  on: boolean;
  hasPassword: boolean;
  interval: number;
  theme: 'system' | 'light' | 'dark';
  limits: Record<string, { o2: number | null; h2o: number | null }>;
  screens: number;
  seen: string | null;
  gloveboxes: { id: number; name: string; color: string }[];
};
type Lim = Record<string, { o2: string; h2o: string }>;

const toText = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const toNum = (t: string) => {
  const v = t.trim().replace(',', '.');
  return v === '' ? null : Number(v);
};

export default function AdminScreen() {
  const [s, setS] = useState<S | null>(null),
    [pw, setPw] = useState(''),
    [again, setAgain] = useState(''),
    [secs, setSecs] = useState(''),
    [lim, setLim] = useState<Lim>({}),
    [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const take = (d: S) => {
    setS(d);
    setSecs(String(d.interval));
    setLim(
      Object.fromEntries(
        d.gloveboxes.map((g) => [g.id, { o2: toText(d.limits[g.id]?.o2), h2o: toText(d.limits[g.id]?.h2o) }]),
      ),
    );
  };
  useEffect(() => {
    api<S>('/screen/settings').then(take);
  }, []);
  if (!s) return <p className="mut">Loading…</p>;
  const save = (part: string, body: object, ok: string) =>
    api<S>('/screen/settings', 'PUT', body)
      .then((d) => {
        take(d);
        setMsg({ [part]: { ok: true, text: ok } });
      })
      .catch((e) => {
        setMsg({ [part]: { ok: false, text: e.message.replace(/^./, (c: string) => c.toUpperCase()) + '.' } });
        api<S>('/screen/settings').then(take); // a switch shown changed goes back to what is saved
      });
  const n = Number(secs),
    secsOk = Number.isInteger(n) && n >= 10 && n <= 120;
  const limBad = Object.values(lim).some((l) => [l.o2, l.h2o].some((t) => t.trim() && !(toNum(t)! >= 0)));
  const limSame = s.gloveboxes.every(
    (g) => lim[g.id]?.o2 === toText(s.limits[g.id]?.o2) && lim[g.id]?.h2o === toText(s.limits[g.id]?.h2o),
  );
  const Msg = ({ k }: { k: string }) =>
    msg[k] ? <span className={'small ' + (msg[k].ok ? 'mut' : 'err')}>{msg[k].text}</span> : null;
  return (
    <div className="admin-screen">
      <h3 className="sub">Lab screen</h3>
      <section className="group">
        <p className="small">
          A TV in the lab shows the equipment, the week’s bookings, the best device of the week, the month’s birthdays
          and the gloveboxes’ O₂ and H₂O. It opens from the sign-in screen with its own password. Names show on it
          without anyone signing in.
        </p>
        <label className="inline">
          <input
            type="checkbox"
            checked={s.on}
            disabled={!s.hasPassword}
            onChange={(e) => {
              const v = e.target.checked;
              setS({ ...s, on: v }); // the box follows the click at once; the server's answer confirms it
              save(
                'on',
                { on: v },
                v ? 'The sign-in screen now offers the lab screen.' : 'Off. Every screen was signed out.',
              );
            }}
          />
          Show the lab screen
        </label>
        <p className="mut small" data-screen-state>
          {!s.hasPassword
            ? 'Set a password below to turn it on.'
            : !s.on
              ? 'Off. The sign-in screen does not offer it.'
              : s.screens
                ? `Open on ${s.screens === 1 ? '1 screen' : `${s.screens} screens`}${s.seen ? `, last seen ${fmtDateTime(s.seen)}` : ''}.`
                : 'On. No screen has opened it yet.'}
        </p>
        <div className="inline">
          <a className="btn secondary" href="#/screen" target="_blank" rel="noopener">
            Open the lab screen
          </a>
          {s.on && s.screens > 0 && (
            <button
              className="btn secondary"
              onClick={() =>
                api<S>('/screen/close', 'POST')
                  .then((d) => {
                    take(d);
                    setMsg({ on: { ok: true, text: 'Every screen was signed out. They need the password again.' } });
                  })
                  .catch((e) => setMsg({ on: { ok: false, text: e.message } }))
              }
            >
              Sign out the screens
            </button>
          )}
        </div>
        <Msg k="on" />
      </section>

      <h3 className="sub">Password</h3>
      <section className="group">
        <p className="mut small">
          Typed once on each TV.{s.hasPassword ? ' A new password signs every screen out.' : ''}
        </p>
        <form
          className="box-form"
          onSubmit={(e) => {
            e.preventDefault();
            save(
              'pw',
              { password: pw },
              s.hasPassword ? 'Password changed. Type it on each screen.' : 'Password set.',
            ).then(() => {
              setPw('');
              setAgain('');
            });
          }}
        >
          <label className="fld">
            <span>New screen password</span>
            <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </label>
          <label className="fld">
            <span>Type it again</span>
            <input
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </label>
          <PasswordRules pw={pw} again={again} />
          <div className="inline">
            <button className="btn" disabled={!passwordOk(pw, again)}>
              {s.hasPassword ? 'Change password' : 'Set password'}
            </button>
            <Msg k="pw" />
          </div>
        </form>
      </section>

      <h3 className="sub">Pages</h3>
      <section className="group">
        <div className="inline">
          <span>Theme</span>
          <Seg<S['theme']>
            value={s.theme}
            opts={[
              ['system', 'System'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ]}
            on={(v) => {
              setS({ ...s, theme: v });
              save('pages', { theme: v }, 'Saved');
            }}
          />
        </div>
        <div className="inline">
          <label className="inline">
            Each page shows for
            <input
              className="num-in"
              inputMode="numeric"
              value={secs}
              aria-label="Seconds each page shows"
              onChange={(e) => setSecs(e.target.value.replace(/\D/g, ''))}
            />
            seconds
          </label>
          <button
            className="btn secondary"
            disabled={!secsOk || n === s.interval}
            onClick={() => save('pages', { interval: n }, 'Saved')}
          >
            Save
          </button>
          {!secsOk && secs !== '' ? <span className="err small">From 10 to 120 seconds.</span> : <Msg k="pages" />}
        </div>
      </section>

      <h3 className="sub">O₂ and H₂O limits</h3>
      <section className="group">
        {!s.gloveboxes.length ? (
          <p className="mut small">
            No equipment records O₂ and H₂O. Turn on “Record O₂ and H₂O (ppm) after each booking” in the equipment’s
            settings.
          </p>
        ) : (
          <>
            <p className="mut small">
              The line on the lab screen turns red above its limit. Leave a limit empty for none.
            </p>
            <table className="list screen-limits">
              <thead>
                <tr>
                  <th>Equipment</th>
                  <th>O₂ limit (ppm)</th>
                  <th>H₂O limit (ppm)</th>
                </tr>
              </thead>
              <tbody>
                {s.gloveboxes.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <span className="eq-name" style={{ '--eq': g.color } as CSSProperties}>
                        {g.name}
                      </span>
                    </td>
                    {(['o2', 'h2o'] as const).map((k) => (
                      <td key={k}>
                        <input
                          inputMode="decimal"
                          aria-label={`${g.name}, ${k === 'o2' ? 'O₂' : 'H₂O'} limit in ppm`}
                          value={lim[g.id]?.[k] ?? ''}
                          onChange={(e) => setLim({ ...lim, [g.id]: { ...lim[g.id], [k]: e.target.value } })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="inline">
              <button
                className="btn"
                disabled={limBad || limSame}
                onClick={() =>
                  save(
                    'lim',
                    {
                      limits: Object.fromEntries(
                        Object.entries(lim).map(([id, l]) => [id, { o2: toNum(l.o2), h2o: toNum(l.h2o) }]),
                      ),
                    },
                    'Saved',
                  )
                }
              >
                Save limits
              </button>
              {limBad ? <span className="err small">Limits are numbers of 0 or more.</span> : <Msg k="lim" />}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
