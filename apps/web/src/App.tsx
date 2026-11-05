import { useEffect, useState } from 'react';
import { api } from './api';
import { MeCtx, PrefCtx, type Me, type Prefs } from './ctx';
import Shell from './Shell';

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined), [prefs, setPrefs] = useState<Prefs>({ theme: 'system', vis: 'shared' });
  const loadPrefs = () => api<Partial<Prefs>>('/prefs').then((p) => setPrefs((x) => ({ ...x, ...p }))).catch(() => {});
  useEffect(() => { api<Me>('/me').then(async (m) => { await loadPrefs(); setMe(m); }).catch(() => setMe(null)); }, []);
  useEffect(() => { document.documentElement.dataset.theme = prefs.theme === 'system' ? '' : prefs.theme; }, [prefs.theme]);
  const set = (p: Partial<Prefs>) => { setPrefs((x) => ({ ...x, ...p })); api('/prefs', 'PUT', p).catch(() => {}); };
  if (me === undefined) return null;
  return (
    <PrefCtx.Provider value={{ prefs, set }}>
      {me && me.mustChange ? <NewPassword me={me} onDone={() => setMe({ ...me, mustChange: 0 })} onLogout={() => api('/logout', 'POST').finally(() => setMe(null))} />
        : me ? <MeCtx.Provider value={{ me, reload: () => api<Me>('/me').then(setMe).catch(() => {}) }}><Shell me={me} onLogout={() => api('/logout', 'POST').finally(() => setMe(null))} /></MeCtx.Provider>
        : <Login onLogin={async (m) => { await loadPrefs(); setMe(await api<Me>('/me').catch(() => m)); /* the full profile: tags, photo */ }} />}
    </PrefCtx.Provider>
  );
}

function Login({ onLogin }: { onLogin: (m: Me) => void }) {
  const [u, setU] = useState(''), [p, setP] = useState(''), [err, setErr] = useState('');
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    try { onLogin(await api<Me>('/login', 'POST', { username: u, password: p })); } catch (x) { setErr((x as Error).message); }
  };
  return (
    <main className="login">
      <form className="card" onSubmit={go}>
        <h1>Perovskite Lab</h1>
        <p className="mut">Sign in to continue</p>
        <input autoFocus placeholder="Username" autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} />
        <input type="password" placeholder="Password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} />
        {err && <p className="err">{err}</p>}
        <button className="btn" disabled={!u || !p}>Sign in</button>
      </form>
    </main>
  );
}

/** First sign-in with a temporary password (new account, password reset by an admin, generated admin password): choose your own. */
function NewPassword({ me, onDone, onLogout }: { me: Me; onDone: () => void; onLogout: () => void }) {
  const [cur, setCur] = useState(''), [nw, setNw] = useState(''), [again, setAgain] = useState(''), [err, setErr] = useState('');
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nw !== again) return setErr('The two new passwords are different.');
    try { await api('/me/password', 'POST', { current: cur, next: nw }); onDone(); } catch (x) { setErr((x as Error).message); }
  };
  return (
    <main className="login">
      <form className="card" onSubmit={go}>
        <h1>Choose your password</h1>
        <p className="mut">Hello {me.name}. You signed in with a temporary password; choose your own to continue.</p>
        <input type="password" placeholder="Temporary password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        <input type="password" placeholder="New password (at least 10 characters)" autoComplete="new-password" value={nw} onChange={(e) => setNw(e.target.value)} />
        <input type="password" placeholder="New password again" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        {err && <p className="err">{err}</p>}
        <button className="btn" disabled={!cur || nw.length < 10 || !again}>Save and continue</button>
        <button type="button" className="link" onClick={onLogout}>Sign out</button>
      </form>
    </main>
  );
}
