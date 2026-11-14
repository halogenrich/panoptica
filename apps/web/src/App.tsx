import { useEffect, useState } from 'react';
import { api } from './api';
import { LabCtx, MeCtx, PrefCtx, brandText, type LabPublic, type Me, type Prefs } from './ctx';
import Shell from './Shell';
import { live, stopLive } from './lib/live';
import Login from './start/Login';
import Setup, { SetupCode, SetupElsewhere } from './start/Setup';
import { PasswordRules, passwordOk } from './start/parts';

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined),
    [lab, setLab] = useState<LabPublic | null>(null),
    [prefs, setPrefs] = useState<Prefs>({ theme: 'system', vis: 'shared' }),
    [setupCode, setSetupCode] = useState('');
  const loadLab = () =>
    api<LabPublic>('/lab/public')
      .then(setLab)
      .catch(() => {});
  useEffect(() => {
    loadLab();
  }, []);
  useEffect(() => {
    document.title = brandText(lab);
  }, [lab?.name]);
  const loadPrefs = () =>
    api<Partial<Prefs>>('/prefs')
      .then((p) => setPrefs((x) => ({ ...x, ...p })))
      .catch(() => {});
  useEffect(() => {
    api<Me>('/me')
      .then(async (m) => {
        await loadPrefs();
        setMe(m);
      })
      .catch(() => setMe(null));
  }, []);
  // live updates while signed in (and the password is not waiting to be changed)
  const signedIn = !!me && !me.mustChange;
  useEffect(() => {
    if (signedIn) live(true);
    else stopLive();
  }, [signedIn]);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme === 'system' ? '' : prefs.theme;
  }, [prefs.theme]);
  const set = (p: Partial<Prefs>) => {
    setPrefs((x) => ({ ...x, ...p }));
    api('/prefs', 'PUT', p).catch(() => {});
  };
  if (me === undefined || !lab) return null;
  const signedIn2 = async () => {
    await loadPrefs();
    loadLab();
    setMe(await api<Me>('/me').catch(() => null)); /* the full profile: tags, photo */
  };
  return (
    <LabCtx.Provider value={{ lab, reload: loadLab }}>
      <PrefCtx.Provider value={{ prefs, set }}>
        {me && me.mustChange ? (
          <NewPassword
            me={me}
            onDone={() => setMe({ ...me, mustChange: 0 })}
            onLogout={() => api('/logout', 'POST').finally(() => setMe(null))}
          />
        ) : me ? (
          <MeCtx.Provider
            value={{
              me,
              reload: () =>
                api<Me>('/me')
                  .then(setMe)
                  .catch(() => {}),
            }}
          >
            <Shell me={me} onLogout={() => api('/logout', 'POST').finally(() => setMe(null))} />
          </MeCtx.Provider>
        ) : lab.setup === 'here' ? (
          <Setup onDone={signedIn2} />
        ) : lab.setup === 'code' ? (
          setupCode ? (
            <Setup onDone={signedIn2} code={setupCode} />
          ) : (
            <SetupCode lab={lab} onOk={setSetupCode} />
          )
        ) : lab.setup === 'elsewhere' ? (
          <SetupElsewhere lab={lab} />
        ) : (
          <Login lab={lab} onLogin={signedIn2} />
        )}
      </PrefCtx.Provider>
    </LabCtx.Provider>
  );
}

/** First sign-in with a temporary password (new account, password reset by an admin, generated admin password): choose your own. */
function NewPassword({ me, onDone, onLogout }: { me: Me; onDone: () => void; onLogout: () => void }) {
  const [cur, setCur] = useState(''),
    [nw, setNw] = useState(''),
    [again, setAgain] = useState(''),
    [err, setErr] = useState('');
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nw !== again) return setErr('The two new passwords are different.');
    try {
      await api('/me/password', 'POST', { current: cur, next: nw });
      onDone();
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  return (
    <main className="login">
      <form className="card" onSubmit={go}>
        <h1>Choose your password</h1>
        <p className="mut">Hello {me.name}. You signed in with a temporary password; choose your own to continue.</p>

        <input
          type="password"
          placeholder="Temporary password"
          autoComplete="current-password"
          value={cur}
          onChange={(e) => setCur(e.target.value)}
        />
        <input
          type="password"
          placeholder="New password"
          autoComplete="new-password"
          value={nw}
          onChange={(e) => setNw(e.target.value)}
        />
        <input
          type="password"
          placeholder="New password again"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
        <PasswordRules pw={nw} again={again} />
        {err && <p className="err">{err}</p>}
        <button className="btn" disabled={!cur || !passwordOk(nw, again)}>
          Save and continue
        </button>
        <button type="button" className="link" onClick={onLogout}>
          Sign out
        </button>
      </form>
    </main>
  );
}
