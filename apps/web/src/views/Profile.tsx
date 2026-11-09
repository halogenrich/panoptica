import { useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { MeCtx, PrefCtx, type Prefs } from '../ctx';
import Avatar from '../lib/Avatar';
import { Seg } from '../lib/ui';
import { shiftHeld } from '../lib/shift';
import Cropper from '../lib/Cropper';
import { PasswordRules, passwordOk, todayIso } from '../start/parts';
import { ageOn } from '@psc/core';
import { LabCtx } from '../ctx';

function PwForm() {
  const [cur, setCur] = useState(''),
    [nw, setNw] = useState(''),
    [again, setAgain] = useState(''),
    [msg, setMsg] = useState('');
  const save = () =>
    api('/me/password', 'POST', { current: cur, next: nw })
      .then(() => {
        setMsg('Password changed');
        setCur('');
        setNw('');
        setAgain('');
      })
      .catch((e) => setMsg(e.message));
  return (
    <div className="pw-form">
      <input
        type="password"
        placeholder="Current password"
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
      {nw && <PasswordRules pw={nw} again={again} />}
      <div className="inline">
        <button className="btn secondary" disabled={!cur || !passwordOk(nw, again)} onClick={save}>
          Change password
        </button>
        {msg && <span className="mut small">{msg}</span>}
      </div>
    </div>
  );
}

/** Your profile: photo, display name, tags (set by an admin) and settings. */
export default function Profile({ onInvite }: { onInvite: () => void }) {
  const { me, reload } = useContext(MeCtx),
    { prefs, set } = useContext(PrefCtx);
  const [funny] = useState(shiftHeld),
    [name, setName] = useState(me.name),
    [msg, setMsg] = useState(''),
    [crop, setCrop] = useState<string | null>(null),
    file = useRef<HTMLInputElement>(null);
  useEffect(() => setName(me.name), [me.name]);
  const save = (b: object, done: string) =>
    api('/me', 'PATCH', b)
      .then(() => {
        setMsg(done);
        reload();
      })
      .catch((e) => setMsg(e.message));
  const pick = (f?: File) => {
    if (!f) return;
    if (!/^image\//.test(f.type)) return setMsg('Choose an image file (JPEG, PNG…).');
    const r = new FileReader();
    r.onload = () => setCrop(r.result as string);
    r.readAsDataURL(f);
  };
  return (
    <div className="profile">
      <section className="group profile-head">
        <button
          className="photo-frame"
          aria-label={me.photoV ? 'Change photo' : 'Add a photo'}
          title={me.photoV ? 'Change photo' : 'Add a photo'}
          onClick={() => file.current?.click()}
        >
          <Avatar id={me.id} name={me.name} photoV={me.photoV} size={96} />
          <span className="photo-hover" aria-hidden>
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </span>
        </button>
        <div className="profile-id">
          <h2>{me.name}</h2>
          <div className="mut">
            @{me.username} · {me.role === 'admin' ? 'Admin' : 'Member'}
          </div>
          {!!me.tags?.length && (
            <div className="chips">
              {me.tags.map((t) => (
                <span key={t.id} className="tag" style={{ '--tag': t.color } as React.CSSProperties}>
                  {t.name}
                </span>
              ))}
            </div>
          )}
          <div className="inline">
            {!!me.photoV && (
              <button className="link danger-link" onClick={() => save({ photo: '' }, 'Photo removed')}>
                Remove photo
              </button>
            )}
            <input
              ref={file}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </section>
      {crop && (
        <section className="group">
          <Cropper
            src={crop}
            onCancel={() => setCrop(null)}
            onSave={(d) => {
              setCrop(null);
              save({ photo: d }, 'Photo saved');
            }}
          />
        </section>
      )}
      {msg && <p className="mut small">{msg}</p>}

      <h3 className="sub">Name</h3>
      <section className="group">
        <div className="inline name-row">
          <input
            aria-label="Display name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && save({ name: name.trim() }, 'Name saved')}
          />
          <button
            className="btn"
            disabled={!name.trim() || name.trim() === me.name}
            onClick={() => save({ name: name.trim() }, 'Name saved')}
          >
            Save
          </button>
        </div>
        <p className="mut small">
          Shown on your presets, batches, measurements and comments. Tags are given by an admin.
        </p>
      </section>

      <h3 className="sub">About you</h3>
      <AboutYou />

      <h3 className="sub">Settings</h3>
      <section className="group settings">
        <div className="row">
          <span>Default visibility of new presets</span>
          <Seg<Prefs['vis']>
            small
            value={prefs.vis}
            opts={[
              ['private', 'Private'],
              ['shared', 'Shared'],
            ]}
            on={(v) => set({ vis: v })}
          />
        </div>
        <div className="row">
          <span>Theme</span>
          <Seg<Prefs['theme']>
            small
            value={prefs.theme}
            opts={[
              ['system', 'System'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ]}
            on={(v) => set({ theme: v })}
          />
        </div>
      </section>

      {funny && (
        <>
          <h3 className="sub">Funny settings</h3>
          <section className="group settings funny">
            {!me.professor && (
              <label className="row">
                <span>Show the eye next to search while the Professor is online</span>
                <input type="checkbox" checked={!!prefs.eye} onChange={(e) => set({ eye: e.target.checked })} />
              </label>
            )}
            <label className="row">
              <span>Breaking news in the top bar</span>
              <input type="checkbox" checked={!!prefs.news} onChange={(e) => set({ news: e.target.checked })} />
            </label>
            {me.role === 'admin' && <NewsGap />}
          </section>
        </>
      )}

      <h3 className="sub">Password</h3>
      <section className="group">
        <PwForm />
      </section>

      <h3 className="sub">Other devices</h3>
      <section className="group">
        <div className="inline">
          <span className="mut">Open the app on a phone in the lab network</span>
          <div className="grow" />
          <button className="btn secondary" onClick={onInvite}>
            Invite a phone (QR code)
          </button>
        </div>
      </section>
    </div>
  );
}

/** Admin: seconds between breaking-news headlines, for everyone. */
function NewsGap() {
  const [v, setV] = useState<number | ''>(''),
    [msg, setMsg] = useState('');
  useEffect(() => {
    api<{ newsGap: number }>('/fun')
      .then((f) => setV(f.newsGap))
      .catch(() => {});
  }, []);
  const save = () =>
    v !== '' &&
    api('/fun', 'PUT', { newsGap: v })
      .then(() => setMsg('Saved for everyone'))
      .catch((e) => setMsg(e.message));
  return (
    <div className="row">
      <span>
        Pause between headlines, for everyone<span className="mut small">{msg ? ` · ${msg}` : ''}</span>
      </span>
      <span className="inline">
        <input
          type="number"
          min={5}
          max={3600}
          value={v}
          aria-label="Seconds between headlines"
          onChange={(e) => setV(e.target.value === '' ? '' : Math.round(+e.target.value))}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <span className="mut small">s</span>
      </span>
    </div>
  );
}

/** Email, birth date, department and supervisors: for the lab's records; the email and birth date also prove who you are when you
 * choose a new password after a reset. */
function AboutYou() {
  const { me, reload } = useContext(MeCtx),
    { lab } = useContext(LabCtx);
  const init = () => ({
    email: me.email ?? '',
    birthDate: me.birthDate ?? '',
    department: me.department ?? '',
    supervisor: me.supervisor ?? '',
    cosupervisor: me.cosupervisor ?? '',
  });
  const [v, setV] = useState(init),
    [msg, setMsg] = useState('');
  useEffect(() => setV(init()), [me.email, me.birthDate, me.department, me.supervisor, me.cosupervisor]);
  const changed = (Object.keys(v) as (keyof typeof v)[]).some((k) => v[k] !== (init()[k] ?? ''));
  const save = () =>
    api('/me', 'PATCH', { ...v, birthDate: v.birthDate || undefined })
      .then(() => {
        setMsg('Saved');
        reload();
      })
      .catch((e) => setMsg(e.message));
  const depts = lab?.departments ?? [];
  const age = me.birthDate ? ageOn(me.birthDate) : null;
  return (
    <section className="group about-you">
      <div className="grid2">
        <label className="fld">
          <span>Institutional email</span>
          <input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </label>
        <label className="fld">
          <span>Birth date{age !== null ? ` (${age} years)` : ''}</span>
          <input
            type="date"
            max={todayIso()}
            value={v.birthDate}
            onChange={(e) => setV({ ...v, birthDate: e.target.value })}
          />
        </label>
        <label className="fld">
          <span>Department</span>
          {depts.length ? (
            <select value={v.department} onChange={(e) => setV({ ...v, department: e.target.value })}>
              <option value="">Choose…</option>
              {[...new Set([...depts, ...(v.department ? [v.department] : [])])].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          ) : (
            <input value={v.department} onChange={(e) => setV({ ...v, department: e.target.value })} />
          )}
        </label>
        <span />
        <label className="fld">
          <span>Supervisor</span>
          <input value={v.supervisor} onChange={(e) => setV({ ...v, supervisor: e.target.value })} />
        </label>
        <label className="fld">
          <span>Co-supervisor</span>
          <input value={v.cosupervisor} onChange={(e) => setV({ ...v, cosupervisor: e.target.value })} />
        </label>
      </div>
      <div className="inline">
        <button className="btn" disabled={!changed || !v.email} onClick={save}>
          Save
        </button>
        {msg && <span className="mut small">{msg}</span>}
      </div>
      <label className="inline small">
        <input
          type="checkbox"
          checked={me.showBirthday !== false}
          onChange={(e) =>
            api('/me', 'PATCH', { showBirthday: e.target.checked })
              .then(reload)
              .catch((x) => setMsg(x.message))
          }
        />
        Show my birthday (day and month) in the calendar
      </label>
      {me.visitorUntil && <p className="mut small">Visitor until {me.visitorUntil.split('-').reverse().join('/')}.</p>}
    </section>
  );
}
