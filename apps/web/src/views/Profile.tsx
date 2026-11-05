import { useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { MeCtx, PrefCtx, type Prefs } from '../ctx';
import Avatar from '../lib/Avatar';
import { Seg } from '../lib/ui';
import { shiftHeld } from '../lib/shift';

const OUT = 256; // stored photo size (px, square)

/** Square crop of a chosen picture: drag to move, slider to zoom, saved as a 256 px JPEG. */
function Cropper({ src, onSave, onCancel }: { src: string; onSave: (dataUrl: string) => void; onCancel: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null), img = useRef<HTMLImageElement | null>(null);
  const [z, setZ] = useState(1), [off, setOff] = useState<[number, number]>([0, 0]), [ready, setReady] = useState(false), drag = useRef<[number, number] | null>(null);
  useEffect(() => { const i = new Image(); i.onload = () => { img.current = i; setReady(true); }; i.src = src; }, [src]);
  // the picture covers the square at zoom 1; offsets are kept inside so no empty edge shows
  const geom = () => {
    const i = img.current!, base = OUT / Math.min(i.width, i.height), s = base * z, w = i.width * s, h = i.height * s;
    const cx = Math.max(-(w - OUT) / 2, Math.min((w - OUT) / 2, off[0])), cy = Math.max(-(h - OUT) / 2, Math.min((h - OUT) / 2, off[1]));
    return { w, h, x: (OUT - w) / 2 + cx, y: (OUT - h) / 2 + cy, cx, cy };
  };
  useEffect(() => {
    if (!ready || !cv.current) return;
    const g = cv.current.getContext('2d')!, { w, h, x, y } = geom();
    g.fillStyle = '#fff'; g.fillRect(0, 0, OUT, OUT); g.drawImage(img.current!, x, y, w, h);
  });
  const k = () => OUT / (cv.current?.getBoundingClientRect().width || OUT);
  return (
    <div className="cropper">
      <canvas ref={cv} width={OUT} height={OUT} className="crop-canvas" aria-label="Photo crop: drag to move"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = [e.clientX, e.clientY]; }}
        onPointerMove={(e) => { if (!drag.current) return; const [x0, y0] = drag.current, { cx, cy } = geom(); drag.current = [e.clientX, e.clientY]; setOff([cx + (e.clientX - x0) * k(), cy + (e.clientY - y0) * k()]); }}
        onPointerUp={() => { drag.current = null; }} />
      <label className="inline small">Zoom <input type="range" min={1} max={4} step={0.01} value={z} onChange={(e) => setZ(+e.target.value)} /></label>
      <div className="inline">
        <button className="btn" disabled={!ready} onClick={() => onSave(cv.current!.toDataURL('image/jpeg', 0.86))}>Use this photo</button>
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function PwForm() {
  const [cur, setCur] = useState(''), [nw, setNw] = useState(''), [msg, setMsg] = useState('');
  const save = () => api('/me/password', 'POST', { current: cur, next: nw }).then(() => { setMsg('Password changed'); setCur(''); setNw(''); }).catch((e) => setMsg(e.message));
  return (
    <div className="pw-form">
      <input type="password" placeholder="Current password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
      <input type="password" placeholder="New password (at least 8 characters)" autoComplete="new-password" value={nw} onChange={(e) => setNw(e.target.value)} />
      <div className="inline"><button className="btn secondary" disabled={!cur || nw.length < 8} onClick={save}>Change password</button>{msg && <span className="mut small">{msg}</span>}</div>
    </div>
  );
}

/** Your profile: photo, display name, tags (set by an admin) and settings. */
export default function Profile({ onInvite }: { onInvite: () => void }) {
  const { me, reload } = useContext(MeCtx), { prefs, set } = useContext(PrefCtx);
  const [funny] = useState(shiftHeld), [name, setName] = useState(me.name), [msg, setMsg] = useState(''), [crop, setCrop] = useState<string | null>(null), file = useRef<HTMLInputElement>(null);
  useEffect(() => setName(me.name), [me.name]);
  const save = (b: object, done: string) => api('/me', 'PATCH', b).then(() => { setMsg(done); reload(); }).catch((e) => setMsg(e.message));
  const pick = (f?: File) => {
    if (!f) return;
    if (!/^image\//.test(f.type)) return setMsg('Choose an image file (JPEG, PNG…).');
    const r = new FileReader(); r.onload = () => setCrop(r.result as string); r.readAsDataURL(f);
  };
  return (
    <div className="profile">
      <section className="group profile-head">
        <button className="photo-frame" aria-label={me.photoV ? 'Change photo' : 'Add a photo'} title={me.photoV ? 'Change photo' : 'Add a photo'} onClick={() => file.current?.click()}>
          <Avatar id={me.id} name={me.name} photoV={me.photoV} size={96} />
          <span className="photo-hover" aria-hidden><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg></span>
        </button>
        <div className="profile-id">
          <h2>{me.name}</h2>
          <div className="mut">@{me.username} · {me.role === 'admin' ? 'Admin' : 'Member'}</div>
          {!!me.tags?.length && <div className="chips">{me.tags.map((t) => <span key={t.id} className="tag" style={{ '--tag': t.color } as React.CSSProperties}>{t.name}</span>)}</div>}
          <div className="inline">
            {!!me.photoV && <button className="link danger-link" onClick={() => save({ photo: '' }, 'Photo removed')}>Remove photo</button>}
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        </div>
      </section>
      {crop && <section className="group"><Cropper src={crop} onCancel={() => setCrop(null)} onSave={(d) => { setCrop(null); save({ photo: d }, 'Photo saved'); }} /></section>}
      {msg && <p className="mut small">{msg}</p>}

      <h3 className="sub">Name</h3>
      <section className="group">
        <div className="inline name-row">
          <input aria-label="Display name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && save({ name: name.trim() }, 'Name saved')} />
          <button className="btn" disabled={!name.trim() || name.trim() === me.name} onClick={() => save({ name: name.trim() }, 'Name saved')}>Save</button></div>
        <p className="mut small">Shown on your presets, batches, measurements and comments. Tags are given by an admin.</p>
      </section>

      <h3 className="sub">Settings</h3>
      <section className="group settings">
        <div className="row"><span>Default visibility of new presets</span><Seg<Prefs['vis']> small value={prefs.vis} opts={[['private', 'Private'], ['shared', 'Shared']]} on={(v) => set({ vis: v })} /></div>
        <div className="row"><span>Theme</span><Seg<Prefs['theme']> small value={prefs.theme} opts={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} on={(v) => set({ theme: v })} /></div>
      </section>

      {funny && <>
        <h3 className="sub">Funny settings</h3>
        <section className="group settings funny">
          {!me.professor && <label className="row"><span>Show the eye next to search while the Professor is online</span><input type="checkbox" checked={!!prefs.eye} onChange={(e) => set({ eye: e.target.checked })} /></label>}
          <label className="row"><span>Breaking news in the top bar</span><input type="checkbox" checked={!!prefs.news} onChange={(e) => set({ news: e.target.checked })} /></label>
          {me.role === 'admin' && <NewsGap />}
        </section>
      </>}

      <h3 className="sub">Password</h3>
      <section className="group"><PwForm /></section>

      <h3 className="sub">Other devices</h3>
      <section className="group"><div className="inline"><span className="mut">Open the app on a phone in the lab network</span><div className="grow" /><button className="btn secondary" onClick={onInvite}>Invite a phone (QR code)</button></div></section>
    </div>
  );
}

/** Admin: seconds between breaking-news headlines, for everyone. */
function NewsGap() {
  const [v, setV] = useState<number | ''>(''), [msg, setMsg] = useState('');
  useEffect(() => { api<{ newsGap: number }>('/fun').then((f) => setV(f.newsGap)).catch(() => {}); }, []);
  const save = () => v !== '' && api('/fun', 'PUT', { newsGap: v }).then(() => setMsg('Saved for everyone')).catch((e) => setMsg(e.message));
  return (
    <div className="row"><span>Pause between headlines, for everyone<span className="mut small">{msg ? ` · ${msg}` : ''}</span></span>
      <span className="inline"><input type="number" min={5} max={3600} value={v} aria-label="Seconds between headlines" onChange={(e) => setV(e.target.value === '' ? '' : Math.round(+e.target.value))} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} /><span className="mut small">s</span></span></div>
  );
}
