import { useRef, useState, type ReactNode } from 'react';
import { surnameChoices } from '@psc/core';
import { api } from '../api';
import type { LabPublic, Me } from '../ctx';
import { fmtDate } from '../lib/ui';
import {
  NameFields,
  PasswordRules,
  PhotoCircle,
  Panopticon,
  Wordmark,
  passwordOk,
  todayIso,
  type NameParts,
} from './parts';

/** The lab's picture on the left (or the panopticon drawing) with its logo where the lab placed it; the panel on the right. */
export function SignInFrame({
  lab,
  wide,
  children,
  preview,
}: {
  lab: LabPublic;
  wide?: boolean;
  children: ReactNode;
  /** images not saved yet (the setup's preview): data URLs, '' for none */
  preview?: { bg: string; logo: string; inst: string };
}) {
  const bg = preview ? preview.bg : lab.hasBackground ? `/api/lab/background?v=${lab.bgV}` : '',
    logo = preview ? preview.logo : lab.hasLogo ? `/api/lab/logo?v=${lab.bgV}` : '',
    inst = preview ? preview.inst : lab.hasInstLogo ? `/api/lab/institution-logo?v=${lab.bgV}` : '';
  const foot = lab.foot ?? 'name',
    showName = !!lab.institution && (foot !== 'logo' || !inst),
    showInst = !!inst && foot !== 'name';
  const Tag = preview ? 'div' : 'main';
  return (
    <Tag className={'signin' + (wide ? ' wide' : '') + (preview ? ' mini' : '')}>
      <div className={'signin-art' + (bg ? ' photo' : '')}>
        {bg ? <img src={bg} alt="" /> : <Panopticon />}
        {logo && (
          <div className={`signin-logo at-${lab.logoPos ?? 'br'}` + (lab.logoPlate === false ? ' bare' : '')}>
            <img src={logo} alt={lab.name ? `${lab.name} logo` : 'Lab logo'} />
          </div>
        )}
      </div>
      <section className="signin-panel">
        <Wordmark lab={lab.name} />
        <div className="signin-body">{children}</div>
        {(showName || showInst) && (
          <div className="signin-foot">
            {showInst && <img src={inst} alt={lab.institution || 'Institution logo'} />}
            {showName && <span className="mut small">{lab.institution}</span>}
          </div>
        )}
      </section>
    </Tag>
  );
}

type Next = {
  next: 'password' | 'set' | 'pending' | 'declined' | 'ended';
  reason?: string;
  since?: string;
  until?: string;
  /** 'set': the account has no birth date (some visitors), so it is confirmed by its email */
  byEmail?: boolean;
  hasPhoto?: boolean;
};
type Mode = 'signin' | 'set' | 'request' | 'sent';

export default function Login({ lab, onLogin }: { lab: LabPublic; onLogin: (m: Me) => void }) {
  const [mode, setMode] = useState<Mode>('signin'),
    [u, setU] = useState(''),
    [p, setP] = useState(''),
    [err, setErr] = useState(''),
    [note, setNote] = useState<ReactNode>(null),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(''),
    [setInfo, setSetInfo] = useState<Next>({ next: 'set' });
  const pwRef = useRef<HTMLInputElement>(null);
  const user = u.trim().replace(/^@/, '');

  /** What this username needs next, said on the screen. */
  const route = (n: Next) => {
    setErr('');
    setNote(null);
    if (n.next === 'set') {
      setSetInfo(n);
      return setMode('set');
    }
    if (n.next === 'password') {
      setErr('Type your password.');
      return pwRef.current?.focus();
    }
    if (n.next === 'pending')
      return setNote(
        <>
          Your request for <b>@{user}</b> is waiting for an admin{n.since ? ` (sent ${fmtDate(n.since)})` : ''}. Once it
          is accepted, sign in here with your username to choose your password.
        </>,
      );
    if (n.next === 'declined')
      return setNote(
        <>
          An admin declined the request for <b>@{user}</b>
          {n.reason ? `: “${n.reason}”` : '.'} Talk to the lab's admins, or{' '}
          <button type="button" className="link" onClick={() => setMode('request')}>
            request access again
          </button>
          .
        </>,
      );
    if (n.next === 'ended')
      setNote(
        <>
          The visit of @{user} ended on {fmtDate(n.until ?? '')}. Ask an admin to extend it.
        </>,
      );
  };
  const check = () =>
    api<Next>('/login/check', 'POST', { username: user })
      .then(route)
      .catch((e) =>
        setErr(/no user/.test(e.message) ? 'There is no user with this name. Check it, or request access.' : e.message),
      );

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      if (!p) await check();
      else
        try {
          onLogin(await api<Me>('/login', 'POST', { username: user, password: p }));
        } catch (x) {
          const m = (x as Error).message;
          // a wrong password, or an account that has none yet / is waiting: the check says which
          if (/wrong username or password/.test(m)) {
            const n = await api<Next>('/login/check', 'POST', { username: user }).catch(() => null);
            if (!n) setErr('There is no user with this name. Check it, or request access.');
            else if (n.next === 'password') setErr('Wrong password.');
            else route(n);
          } else setErr(m);
        }
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'set')
    return (
      <SignInFrame lab={lab}>
        <SetPassword username={user} info={setInfo} onLogin={onLogin} onBack={() => setMode('signin')} />
      </SignInFrame>
    );
  if (mode === 'request')
    return (
      <SignInFrame lab={lab} wide>
        <RequestAccess
          lab={lab}
          onBack={() => setMode('signin')}
          onSent={(name) => {
            setSent(name);
            setMode('sent');
          }}
        />
      </SignInFrame>
    );
  if (mode === 'sent')
    return (
      <SignInFrame lab={lab}>
        <h1>Request sent</h1>
        <p>
          Your username is <b className="big-user">@{sent}</b>
        </p>
        <p className="mut">
          The lab's admins see your request in PANOPTICA. When one of them accepts it, sign in here with your username,
          leave the password empty, and choose your password.
        </p>
        <button
          className="btn"
          onClick={() => {
            setU(sent);
            setP('');
            setNote(null);
            setMode('signin');
          }}
        >
          Back to sign in
        </button>
      </SignInFrame>
    );
  return (
    <SignInFrame lab={lab}>
      <h1>Sign in</h1>
      <form className="signin-form" onSubmit={go}>
        <label className="fld">
          <span>Username</span>
          <input
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={u}
            onChange={(e) => {
              setU(e.target.value);
              setNote(null);
              setErr('');
            }}
          />
        </label>
        <label className="fld">
          <span>Password</span>
          <input
            ref={pwRef}
            type="password"
            autoComplete="current-password"
            value={p}
            onChange={(e) => setP(e.target.value)}
          />
        </label>
        {err && <p className="err small">{err}</p>}
        {note && <p className="signin-note">{note}</p>}
        <button className="btn" disabled={!user || busy}>
          {p ? 'Sign in' : 'Continue'}
        </button>
        <p className="mut small">First time here, or your password was reset? Type your username and continue.</p>
      </form>
      <p className="signin-alt">
        No account yet?{' '}
        <button type="button" className="link" onClick={() => setMode('request')}>
          Request access
        </button>
      </p>
    </SignInFrame>
  );
}

/**
 * First password (accepted request, visitor, reset): proven with the birth date given for the account (its email, for an account
 * without one), with a photo (required: the one sent with the request can be kept or changed).
 */
function SetPassword({
  username,
  info,
  onLogin,
  onBack,
}: {
  username: string;
  info: Next;
  onLogin: (m: Me) => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState(''),
    [birth, setBirth] = useState(''),
    [photo, setPhoto] = useState(''),
    [kept, setKept] = useState(!!info.hasPhoto),
    [pw, setPw] = useState(''),
    [again, setAgain] = useState(''),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    api<Me>('/login/set', 'POST', {
      username,
      ...(info.byEmail ? { email } : { birthDate: birth }),
      ...(photo ? { photo } : {}),
      password: pw,
    })
      .then(onLogin)
      .catch((x) => setErr(x.message.replace(/^./, (c: string) => c.toUpperCase()) + '.'))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <h1>Choose your password</h1>
      <p className="mut">
        For <b>@{username}</b>. Confirm the {info.byEmail ? 'email on your account' : 'birth date you gave'} and add
        your photo.
      </p>
      <form className="signin-form" onSubmit={go}>
        <PhotoCircle
          value={photo}
          set={(v) => {
            setPhoto(v);
            if (!v) setKept(false);
          }}
          shown={info.hasPhoto ? `/api/login/photo/${encodeURIComponent(username)}` : ''}
          required
        />
        {info.byEmail ? (
          <label className="fld">
            <span>Institutional email</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        ) : (
          <label className="fld">
            <span>Birth date</span>
            <input type="date" max={todayIso()} value={birth} onChange={(e) => setBirth(e.target.value)} />
          </label>
        )}
        <label className="fld">
          <span>New password</span>
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <label className="fld">
          <span>New password again</span>
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
        <PasswordRules pw={pw} again={again} />
        {err && <p className="err small">{err}</p>}
        <button
          className="btn"
          disabled={(info.byEmail ? !email : !birth) || !(photo || kept) || !passwordOk(pw, again) || busy}
        >
          Save and sign in
        </button>
        <button type="button" className="link" onClick={onBack}>
          Back
        </button>
      </form>
    </>
  );
}

/** Asking for access: who you are, how to reach you, who supervises you, a photo. */
function RequestAccess({
  lab,
  onBack,
  onSent,
}: {
  lab: LabPublic;
  onBack: () => void;
  onSent: (username: string) => void;
}) {
  const [n, setN] = useState<NameParts>({ firstNames: '', surnames: '', surname: '' }),
    [email, setEmail] = useState(''),
    [birth, setBirth] = useState(''),
    [dept, setDept] = useState(''),
    [sup, setSup] = useState(''),
    [cosup, setCosup] = useState(''),
    [photo, setPhoto] = useState(''),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  const domains = lab.domains.map((d) => '@' + d).join(', ');
  const emailOk =
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) &&
    (!lab.domains.length ||
      lab.domains.some((d) =>
        email
          .trim()
          .toLowerCase()
          .split('@')[1]
          ?.match(new RegExp(`(^|\\.)${d.replace(/\./g, '\\.')}$`)),
      ));
  const ready =
    n.firstNames.trim() && surnameChoices(n.surnames).length && emailOk && birth && dept.trim() && sup.trim();
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    api<{ username: string }>('/access-requests', 'POST', {
      ...n,
      email,
      birthDate: birth,
      department: dept,
      supervisor: sup,
      cosupervisor: cosup,
      photo,
    })
      .then((r) => onSent(r.username))
      .catch((x) => setErr(x.message.replace(/^./, (c: string) => c.toUpperCase()) + '.'))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <h1>Request access</h1>
      <p className="mut">An admin of the lab checks your request. You choose your password once it is accepted.</p>
      <form className="signin-form" onSubmit={send}>
        <PhotoCircle
          value={photo}
          set={setPhoto}
          name={`${n.firstNames} ${n.surnames}`.trim()}
          note="So the lab knows who you are; you can also add it when you choose your password."
        />
        <NameFields
          v={n}
          set={setN}
          check={(first, surname) =>
            api<{ username: string | null }>(
              `/access-requests/username?first=${encodeURIComponent(first)}&surname=${encodeURIComponent(surname)}`,
            )
              .then((r) => r.username)
              .catch(() => null)
          }
        />
        <div className="grid2">
          <label className="fld">
            <span>Institutional email</span>
            <input
              type="email"
              autoComplete="email"
              placeholder={lab.domains[0] ? `name@${lab.domains[0]}` : ''}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {lab.domains.length > 0 && email.includes('@') && !emailOk && (
              <span className="err small">Use your institutional email ({domains}).</span>
            )}
          </label>
          <label className="fld">
            <span>Birth date</span>
            <input type="date" max={todayIso()} value={birth} onChange={(e) => setBirth(e.target.value)} />
          </label>
        </div>
        <label className="fld">
          <span>Department</span>
          {lab.departments.length ? (
            <select value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">Choose…</option>
              {lab.departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          ) : (
            <input value={dept} onChange={(e) => setDept(e.target.value)} />
          )}
        </label>
        <div className="grid2">
          <label className="fld">
            <span>Supervisor</span>
            <input list="signin-profs" value={sup} onChange={(e) => setSup(e.target.value)} />
          </label>
          <label className="fld">
            <span>Co-supervisor, if any</span>
            <input list="signin-profs" value={cosup} onChange={(e) => setCosup(e.target.value)} />
          </label>
        </div>
        <datalist id="signin-profs">
          {lab.professors.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <p className="mut small">
          Your birth date is used for the lab's statistics and to show your birthday (day and month) in the calendar;
          you can hide it in your profile.
        </p>
        {err && <p className="err small">{err}</p>}
        <button className="btn" disabled={!ready || busy}>
          {busy ? 'Sending…' : 'Send request'}
        </button>
        <button type="button" className="link" onClick={onBack}>
          Back to sign in
        </button>
      </form>
    </>
  );
}
