import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge } from '../lib/ui';
import { saveFigureSettings, useFigureSettings } from '../lib/figure';
import Avatar from '../lib/Avatar';
import type { Tag } from '../ctx';

type U = { id: number; username: string; name: string; role: 'admin' | 'member'; active: number; must_change?: number; photoV?: number; last_seen?: string | null; tags: Tag[] };
const KIND_NOTE: Record<Tag['kind'], string> = { label: '', professor: 'sees everything, private comments', manager: 'student pages, digests, equipment use', inventory: 'edits the inventory' };
const blank = { username: '', name: '', role: 'member', password: '' };

export default function Users({ meId }: { meId: number }) {
  const [list, setList] = useState<U[]>([]), [f, setF] = useState(blank), [err, setErr] = useState(''), [tags, setTags] = useState<Tag[]>([]), [tagFor, setTagFor] = useState<number | null>(null);
  const load = () => { api<U[]>('/users').then(setList); api<Tag[]>('/tags').then(setTags); };
  const setUserTags = (u: U, ids: number[]) => api(`/users/${u.id}/tags`, 'PUT', { tags: ids }).then(() => { setErr(''); load(); }).catch((x) => setErr(x.message));
  useEffect(() => { load(); }, []);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('/users', 'POST', f); setF(blank); setErr(''); load(); } catch (x) { setErr((x as Error).message); }
  };
  const del = (u: U) => {
    if (!window.confirm(`Delete the profile of ${u.name} (@${u.username})?\n\nThey can no longer sign in. Everything they made (presets, stacks, batches, run data, measurements) stays in the app, shown as “${u.username} (former)”.`)) return;
    api('/users/' + u.id, 'DELETE').then(() => { setErr(''); load(); }).catch((x) => setErr(x.message));
  };
  const patch = (id: number, b: object) => api('/users/' + id, 'PATCH', b).then(() => { setErr(''); load(); }).catch((x) => setErr(x.message));
  return (
    <div className="admin-grid">
      <div>
      <h3 className="sub">Users</h3>
      {err && <p className="err">{err}</p>}
      <section className="group">
        {list.map((u) => (
          <div className="user-row" key={u.id}>
          <div className="user-line">
            <Avatar id={u.id} name={u.name} photoV={u.photoV} size={30} />
            <span><b>{u.name}</b> <span className="mut">@{u.username} · {u.role}{u.active ? '' : ' · disabled'}</span>{u.must_change ? <> <Badge tone="warn">temporary password</Badge></> : null}</span>
            <span className="actions">
              <button className="link" onClick={() => setTagFor(tagFor === u.id ? null : u.id)}>{tagFor === u.id ? 'Done' : 'Tags'}</button>
              <button className="link" onClick={() => { const pw = window.prompt(`Temporary password for ${u.name} (min 8 characters). They choose their own at the next sign-in.`); if (pw) patch(u.id, { password: pw }); }}>Reset password</button>
              {u.id !== meId && <button className="link" onClick={() => patch(u.id, { active: !u.active })}>{u.active ? 'Disable' : 'Enable'}</button>}
              {u.id !== meId && <button className="link danger-link" onClick={() => del(u)}>Delete</button>}
            </span>
          </div>
          {tagFor === u.id
            ? <div className="chips">{tags.map((t) => { const has = u.tags.some((x) => x.id === t.id); return (
                <button key={t.id} className={'tag' + (has ? '' : ' off')} style={{ '--tag': t.color } as React.CSSProperties} aria-pressed={has}
                  title={KIND_NOTE[t.kind] || undefined} onClick={() => setUserTags(u, has ? u.tags.filter((x) => x.id !== t.id).map((x) => x.id) : [...u.tags.map((x) => x.id), t.id])}>{has ? '✓ ' : '+ '}{t.name}</button>); })}</div>
            : u.tags.length > 0 && <div className="chips">{u.tags.map((t) => <span key={t.id} className="tag" style={{ '--tag': t.color } as React.CSSProperties}>{t.name}</span>)}</div>}
          </div>
        ))}
      </section>
      <h3 className="sub">Add user</h3>
      <form className="group" onSubmit={add}>
        <input placeholder="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        <input placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="member">Member</option><option value="admin">Admin</option></select>
        <input type="password" placeholder="Temporary password (min 8)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <button className="btn" disabled={!f.username || !f.name || f.password.length < 8}>Create user</button>
      </form>
      <Tags tags={tags} reload={load} />
      <FigureLogo />
      </div>
      <Backups />
    </div>
  );
}

type B = { name: string; kind: 'auto' | 'manual' | 'update' | 'before-restore'; size: number; created: string };
const KIND: Record<B['kind'], string> = { auto: 'Daily', manual: 'Manual', update: 'Before update', 'before-restore': 'Before restore' };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const ago = (iso: string) => { const h = (Date.now() - new Date(iso).getTime()) / 3.6e6; return h < 1 ? 'less than an hour ago' : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; };

/** Database backups: the server makes one a day by itself; admins can make one now and download any of them. */
function Backups() {
  type Mirror = { dir: string; last?: { at: string; ok: boolean; msg: string } };
  const [d, setD] = useState<{ dir: string; files: B[]; mirror: Mirror } | null>(null), [busy, setBusy] = useState(false), [msg, setMsg] = useState(''), [all, setAll] = useState(false);
  const [mdir, setMdir] = useState<string | null>(null), [mmsg, setMmsg] = useState('');
  const load = () => api<{ dir: string; files: B[]; mirror: Mirror }>('/backups').then(setD).catch((e) => setMsg(e.message));
  const saveMirror = (dir: string) => api<Mirror>('/backups/mirror', 'PUT', { dir }).then((m) => { setMdir(null); setMmsg(m.dir ? (m.last?.ok ? `Saved · ${m.last.msg}` : `Saved, but: ${m.last?.msg ?? ''}`) : 'Second copy turned off'); load(); }).catch((e) => setMmsg(e.message));
  useEffect(() => { load(); }, []);
  const now = () => { setBusy(true); api<B>('/backups', 'POST').then((b) => { setMsg(`Backed up: ${b.name}`); load(); }).catch((e) => setMsg(e.message)).finally(() => setBusy(false)); };
  const last = d?.files[0], shown = all ? d?.files ?? [] : (d?.files ?? []).slice(0, 8);
  return (
    <div>
      <h3 className="sub">Backups</h3>
      <section className="group">
        <div className="inline" style={{ justifyContent: 'space-between' }}>
          <span>{last ? <>Last backup <b>{ago(last.created)}</b> <span className="mut">({when(last.created)})</span></> : <span className="mut">No backups yet</span>}</span>
          <button className="btn" disabled={busy} onClick={now}>{busy ? 'Backing up…' : 'Back up now'}</button>
        </div>
        {msg && <p className="mut small">{msg}</p>}
        {shown.length > 0 && (
          <div className="scroll"><table className="list">
            <thead><tr><th>Date</th><th>Type</th><th>Size</th><th /></tr></thead>
            <tbody>{shown.map((b) => (
              <tr key={b.name}><td>{when(b.created)}</td><td><Badge tone={b.kind === 'manual' ? 'ac' : undefined}>{KIND[b.kind]}</Badge></td><td>{(b.size / 1024).toFixed(0)} KB</td>
                <td><a className="link" href={'/api/backups/' + encodeURIComponent(b.name)} download>Download</a></td></tr>
            ))}</tbody>
          </table></div>
        )}
        {(d?.files.length ?? 0) > 8 && <button className="link" style={{ justifySelf: 'start' }} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${d!.files.length}`}</button>}
        <p className="mut small">The app backs up the database once a day while it runs, and before every update. It keeps the last 14 daily and 30 manual backups. Folder: <code>{d?.dir ?? 'backups'}</code></p>
        <p className="mut small">To restore one: close the app window, run <b>restore.bat</b> (Windows) or <b>restore.command</b> (Mac) in the app folder, and choose the backup. The current database is backed up first, so a restore can be undone.</p>
      </section>
      <h3 className="sub">Second copy off this computer</h3>
      <section className="group">
        <p className="mut small">Every backup is also copied to this folder, so a broken or stolen computer does not take the backups with it. Use a network drive or a folder that a cloud app (Google Drive, OneDrive, Dropbox) keeps in sync, as seen from <b>the computer that runs the app</b>, for example <code>Z:\PerovskiteLab</code>, <code>/Volumes/LabShare/PerovskiteLab</code> or <code>/home/lab/Google Drive/PerovskiteLab</code>.</p>
        <div className="inline">
          <input style={{ flex: 1, minWidth: 220 }} placeholder="Folder for the second copy (empty = off)" value={mdir ?? d?.mirror.dir ?? ''} onChange={(e) => setMdir(e.target.value)} />
          <button className="btn" disabled={mdir === null} onClick={() => saveMirror(mdir ?? '')}>Save</button>
          {d?.mirror.dir && <button className="link" onClick={() => saveMirror(d.mirror.dir)}>Copy now</button>}
        </div>
        {d?.mirror.dir && d.mirror.last && <p className={'small ' + (d.mirror.last.ok ? 'ok' : 'err')}>{d.mirror.last.ok ? 'Last copy' : 'Last copy failed'} {ago(d.mirror.last.at)}: {d.mirror.last.msg}{d.mirror.last.ok ? '' : ' · the app tries again every hour'}</p>}
        {!d?.mirror.dir && <p className="warn-text small">No second copy yet: the backups are only on this computer.</p>}
        {mmsg && <p className="mut small">{mmsg}</p>}
      </section>
    </div>
  );
}

/** Group logo and name on exported figures (J–V curves, box plots): one for the whole app. Each user chooses per export whether to include it. */
function FigureLogo() {
  const f = useFigureSettings(), [name, setName] = useState<string | null>(null), [msg, setMsg] = useState('');
  const save = (p: { watermark?: string; group?: string }) => saveFigureSettings(p).then(() => setMsg('Saved')).catch((e) => setMsg(e.message));
  const pick = (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|svg\+xml)$/.test(file.type)) return setMsg('Use a PNG, JPEG or SVG image.');
    if (file.size > 1_000_000) return setMsg('The image is larger than 1 MB; export a smaller one.');
    const r = new FileReader(); r.onload = () => save({ watermark: String(r.result) }); r.readAsDataURL(file);
  };
  const group = name ?? f.group ?? '';
  return (
    <>
      <h3 className="sub">Figure logo</h3>
      <section className="group fig-prefs">
        <p className="small mut">Stamped on exported J–V figures and box plots. Everyone can choose, when exporting, whether to include it.</p>
        <input placeholder="Group name, e.g. the lab's name" value={group} onChange={(e) => setName(e.target.value)} onBlur={() => name !== null && name !== (f.group ?? '') && save({ group: name })} />
        <div className="inline">
          {f.watermark ? <img src={f.watermark} alt="Group logo" className="wm-thumb" /> : <span className="mut small">No logo yet</span>}
          <label className="link">{f.watermark ? 'Replace logo…' : 'Upload logo…'}<input type="file" accept="image/png,image/jpeg,image/svg+xml" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
          {f.watermark && <button className="link danger-link" onClick={() => save({ watermark: '' })}>Remove</button>}
        </div>
        {msg && <span className="small mut">{msg}</span>}
      </section>
    </>
  );
}

/** Tags: labels (Master's, PhD, research topics…) and the three that give access (Professor, Manager, Inventory). */
function Tags({ tags, reload }: { tags: Tag[]; reload: () => void }) {
  const [name, setName] = useState(''), [color, setColor] = useState('#2563eb'), [err, setErr] = useState('');
  const run = (p: Promise<unknown>) => p.then(() => { setErr(''); reload(); }).catch((e) => setErr(e.message));
  return (
    <>
      <h3 className="sub">Tags</h3>
      <section className="group">
        <p className="mut small">Give tags under Users (Tags). <b>Professor</b> sees everything, comments privately to a stack's or batch's owner, and her comments come first. <b>Manager</b> opens student pages, digests and equipment use. <b>Inventory</b> edits the inventory. The others are labels.</p>
        {tags.map((t) => (
          <div key={t.id} className="tag-edit">
            <input type="color" aria-label={`Colour of ${t.name}`} defaultValue={t.color} onBlur={(e) => e.target.value !== t.color && run(api('/tags/' + t.id, 'PATCH', { color: e.target.value }))} />
            <input type="text" aria-label="Tag name" defaultValue={t.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== t.name && run(api('/tags/' + t.id, 'PATCH', { name: e.target.value.trim() }))} />
            <span className="mut small">{t.n ?? 0} {t.n === 1 ? 'person' : 'people'}{t.kind !== 'label' ? ' · ' + KIND_NOTE[t.kind] : ''}</span>
            {t.kind === 'label' && <button className="link danger-link small" onClick={() => window.confirm(`Delete the tag “${t.name}”?`) && run(api('/tags/' + t.id, 'DELETE'))}>Delete</button>}
          </div>
        ))}
        <form className="tag-edit" onSubmit={(e) => { e.preventDefault(); run(api('/tags', 'POST', { name: name.trim(), color }).then(() => setName(''))); }}>
          <input type="color" aria-label="New tag colour" value={color} onChange={(e) => setColor(e.target.value)} />
          <input type="text" placeholder="New tag (e.g. 2D perovskites)" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={!name.trim()}>Add tag</button>
        </form>
        {err && <p className="err small">{err}</p>}
      </section>
    </>
  );
}
