import { useEffect, useState } from 'react';
import { api } from './api';
import { LabCtx, MeCtx, PrefCtx, brandText, type LabPublic, type Me, type Prefs } from './ctx';
import Shell from './Shell';
import PhoneApp from './phone/PhoneApp';
import { useNarrow, usePhone } from './phone/usePhone';
import { live, stopLive } from './lib/live';
import { setLabUrl } from './lib/route';
import Login from './start/Login';
import LabScreen from './screen/LabScreen';
import Setup, { SetupCode, SetupElsewhere } from './start/Setup';
import { PasswordRules, passwordOk } from './start/parts';

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined),
    [lab, setLab] = useState<LabPublic | null>(null),
    [prefs, setPrefs] = useState<Prefs>({ theme: 'system', vis: 'shared' }),
    [setupCode, setSetupCode] = useState(''),
    // the lab screen on a TV (0.59): its own page at #/screen, signed in with the screen password or as an admin
    [screen, setScreen] = useState(() => window.location.hash.startsWith('#/screen'));
  useEffect(() => {
    const f = () => setScreen(window.location.hash.startsWith('#/screen'));
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  const loadLab = () =>
    api<LabPublic>('/lab/public')
      .then((l) => {
        setLabUrl(l.url);
        setLab(l);
      })
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
  if (screen && !lab.setup)
    return (
      <LabScreen
        lab={lab}
        inApp={!!me}
        onLeave={() => {
          window.history.pushState(null, '', window.location.pathname);
          setScreen(false);
        }}
      />
    );
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
        ) : me && me.recovery ? (
          <RecoveryFile
            onDone={() => setMe({ ...me, recovery: false })}
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
            <Main me={me} onLogout={() => api('/logout', 'POST').finally(() => setMe(null))} />
          </MeCtx.Provider>
        ) : lab.setup === 'here' ? (
          <Setup onDone={signedIn2} net0={lab.network} />
        ) : lab.setup === 'code' ? (
          setupCode ? (
            <Setup onDone={signedIn2} code={setupCode} net0={lab.network} />
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

/**
 * After the first setup, and after a restore that gave this computer a new backup key (0.53): the admin downloads the recovery
 * file and says it is kept somewhere else before going on. Without it, a broken computer can take the lab's encrypted copies with
 * it.
 */
function RecoveryFile({ onDone, onLogout }: { onDone: () => void; onLogout: () => void }) {
  const [got, setGot] = useState(false),
    [saved, setSaved] = useState(false),
    [err, setErr] = useState('');
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    api('/backups/recovery/saved', 'POST')
      .then(onDone)
      .catch((x) => setErr((x as Error).message.replace(/^./, (c) => c.toUpperCase()) + '.'));
  };
  return (
    <main className="login">
      <form className="card recovery-card" onSubmit={go}>
        <h1>Save the recovery file</h1>
        <p>
          It holds the backup key and the lab’s id. If this computer breaks or is replaced, a new PANOPTICA restores the
          lab from its backups with it.
        </p>
        <p className="mut">
          Keep it off this computer: in a password manager, or on a USB stick kept with the lab’s papers. You can
          download it again from Admin settings › Backups.
        </p>
        <a className="btn secondary" href="/api/backups/recovery" download onClick={() => setGot(true)}>
          Download the recovery file
        </a>
        <label className="recovery-check">
          <input type="checkbox" checked={saved} disabled={!got} onChange={(e) => setSaved(e.target.checked)} /> I saved
          it somewhere off this computer
        </label>
        {err && <p className="err">{err}</p>}
        <button className="btn" disabled={!got || !saved}>
          Continue
        </button>
        <button type="button" className="link" onClick={onLogout}>
          Sign out
        </button>
      </form>
    </main>
  );
}

/** The phone layout on a narrow screen (0.55), the full app otherwise or when chosen on that phone. */
function Main({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [phone, setFull] = usePhone(),
    narrow = useNarrow();
  return phone ? (
    <PhoneApp me={me} onFull={() => setFull(true)} onLogout={onLogout} />
  ) : (
    <Shell me={me} onLogout={onLogout} onPhone={narrow ? () => setFull(false) : undefined} />
  );
}
