import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { Seg, fmtDateTime } from '../lib/ui';
import { PasswordRules, passwordOk } from '../start/parts';
import { MODULES } from '../modules/installed';

/**
 * Admin settings › Display mode (0.59 as Lab screen; renamed and extended in 0.60.1, Richard): the sign-in screen's button for the
 * TV (on or off), its password, the screens it shows and for how long, how long O₂ and H₂O show today before the week, the
 * theme (the app's own System / Light / Dark switch; Light by default), what the top left shows (the lab and the institution,
 * logo, name or both; full name or acronym), and the O₂ and H₂O limits. A new password, or turning it off, signs every screen out.
 */
type S = {
  on: boolean;
  hasPassword: boolean;
  interval: number;
  theme: 'system' | 'light' | 'dark';
  limits: Record<string, { o2: number | null; h2o: number | null }>;
  atmoSwitch: number;
  pages: (1 | 2 | 3)[];
  labShow: 'logo' | 'name' | 'both';
  labName: 'name' | 'acronym';
  inst: 'none' | 'logo' | 'name' | 'both';
  has: { acronym: boolean; institution: boolean; instLogo: boolean; logo: boolean };
  screens: number;
  seen: string | null;
  gloveboxes: { id: number; name: string; color: string }[];
};
/** The screens, as the lab screen shows them (core alone: no best device). */
const SCREENS: [1 | 2 | 3, string, string][] = [
  [1, 'Equipment and the week', 'Equipment and the week'],
  [2, 'Best device and today', 'Today'],
  [3, 'O₂, H₂O and birthdays', 'O₂, H₂O and birthdays'],
];
type Lim = Record<string, { o2: string; h2o: string }>;

const toText = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const toNum = (t: string) => {
  const v = t.trim().replace(',', '.');
  return v === '' ? null : Number(v);
};

export default function AdminScreen() {
  // the second screen's best device comes from a module (Electronic Devices); without one it is today alone
  const module = MODULES.some((m) => m.screen);
  const [s, setS] = useState<S | null>(null),
    [atmoSecs, setAtmoSecs] = useState(''),
    [pw, setPw] = useState(''),
    [again, setAgain] = useState(''),
    [secs, setSecs] = useState(''),
    [lim, setLim] = useState<Lim>({}),
    [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const take = (d: S) => {
    setS(d);
    setSecs(String(d.interval));
    setAtmoSecs(String(d.atmoSwitch));
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
    secsOk = Number.isInteger(n) && n >= 10 && n <= 120,
    an = Number(atmoSecs),
    atmoOk = Number.isInteger(an) && an >= 5 && an <= 120;
  const limBad = Object.values(lim).some((l) => [l.o2, l.h2o].some((t) => t.trim() && !(toNum(t)! >= 0)));
  const limSame = s.gloveboxes.every(
    (g) => lim[g.id]?.o2 === toText(s.limits[g.id]?.o2) && lim[g.id]?.h2o === toText(s.limits[g.id]?.h2o),
  );
  const Msg = ({ k }: { k: string }) =>
    msg[k] ? <span className={'small ' + (msg[k].ok ? 'mut' : 'err')}>{msg[k].text}</span> : null;
  return (
    <div className="admin-screen">
      <h3 className="sub">Display mode</h3>
      <section className="group">
        <p className="small">
          A TV in the lab shows the equipment, the week’s bookings, the best device of the week, today’s bookings, the
          gloveboxes’ O₂ and H₂O and the month’s birthdays. It opens from the sign-in screen with its own password.
          Names show on it without anyone signing in.
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
          Show “Open the lab screen” on the sign-in screen
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

      <h3 className="sub">Screens</h3>
      <section className="group">
        <div className="inline">
          <span>Show</span>
          <div className="chips" role="group" aria-label="Screens to show">
            {SCREENS.map(([k, withModule, core]) => {
              const on = s.pages.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  className={'chip' + (on ? ' on' : '')}
                  aria-pressed={on}
                  disabled={on && s.pages.length === 1}
                  title={on && s.pages.length === 1 ? 'At least one screen shows' : undefined}
                  onClick={() => {
                    const pages = on ? s.pages.filter((x) => x !== k) : [...s.pages, k].sort();
                    setS({ ...s, pages });
                    save('pages', { pages }, 'Saved');
                  }}
                >
                  {module ? withModule : core}
                </button>
              );
            })}
          </div>
        </div>
        <form
          className="screen-secs"
          onSubmit={(e) => {
            e.preventDefault();
            save('secs', { interval: n, atmoSwitch: an }, 'Saved');
          }}
        >
          <label className="inline">
            Each screen shows for
            <input
              className="num-in"
              inputMode="numeric"
              value={secs}
              aria-label="Seconds each screen shows"
              onChange={(e) => setSecs(e.target.value.replace(/\D/g, ''))}
            />
            seconds
          </label>
          <label className="inline">
            O₂ and H₂O show today for
            <input
              className="num-in"
              inputMode="numeric"
              value={atmoSecs}
              aria-label="Seconds O₂ and H₂O show today before the last 7 days"
              onChange={(e) => setAtmoSecs(e.target.value.replace(/\D/g, ''))}
            />
            seconds, then the last 7 days
          </label>
          <div className="inline">
            <button
              className="btn secondary"
              disabled={!secsOk || !atmoOk || (n === s.interval && an === s.atmoSwitch)}
            >
              Save
            </button>
            {!secsOk && secs !== '' ? (
              <span className="err small">A screen shows from 10 to 120 seconds.</span>
            ) : !atmoOk && atmoSecs !== '' ? (
              <span className="err small">Today shows from 5 to 120 seconds.</span>
            ) : (
              <Msg k="secs" />
            )}
          </div>
        </form>
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
        <Msg k="pages" />
      </section>

      <h3 className="sub">Top left</h3>
      <section className="group screen-top">
        <div className="inline">
          <span>Lab</span>
          <Seg<S['labShow']>
            value={s.labShow}
            opts={[
              ['logo', 'Logo'],
              ['name', 'Name'],
              ['both', 'Both'],
            ]}
            on={(v) => {
              setS({ ...s, labShow: v });
              save('top', { labShow: v }, 'Saved');
            }}
          />
        </div>
        {s.has.acronym && s.labShow !== 'logo' && (
          <div className="inline">
            <span>Lab name</span>
            <Seg<S['labName']>
              value={s.labName}
              opts={[
                ['name', 'Full name'],
                ['acronym', 'Acronym'],
              ]}
              on={(v) => {
                setS({ ...s, labName: v });
                save('top', { labName: v }, 'Saved');
              }}
            />
          </div>
        )}
        {(s.has.institution || s.has.instLogo) && (
          <div className="inline">
            <span>Institution</span>
            <Seg<S['inst']>
              value={s.inst}
              opts={[
                ['none', 'None'],
                ...(s.has.instLogo ? [['logo', 'Logo'] as [S['inst'], string]] : []),
                ...(s.has.institution ? [['name', 'Name'] as [S['inst'], string]] : []),
                ...(s.has.instLogo && s.has.institution ? [['both', 'Both'] as [S['inst'], string]] : []),
              ]}
              on={(v) => {
                setS({ ...s, inst: v });
                save('top', { inst: v }, 'Saved');
              }}
            />
          </div>
        )}
        {!s.has.logo && s.labShow !== 'name' && (
          <p className="mut small">The lab has no logo yet: add one under Lab setup. Until then the name shows.</p>
        )}
        <Msg k="top" />
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
