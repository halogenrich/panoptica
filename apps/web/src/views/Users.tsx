import { useEffect, useRef, useState } from 'react';
import { ageOn } from '@psc/core';
import { useRefresh } from '../lib/trash';
import { api } from '../api';
import { Badge, Modal, Seg } from '../lib/ui';
import { Activity, Licence, Security, Updates } from './AdminSecurity';
import { NetworkTab } from '../start/Network';
import AdminInventory from './AdminInventory';
import AdminScreen from './AdminScreen';
import Avatar from '../lib/Avatar';
import { LabCtx, type Tag } from '../ctx';
import { MODULES } from '../modules/installed';
import { useContext } from 'react';
import { fmtDate, fmtDateTime } from '../lib/ui';
import { HoursFields, LabFields, LookFields, blankLab, hoursOk, labBody, type LabDraft } from '../start/Setup';
import { NameFields, todayIso, type NameParts } from '../start/parts';

type U = {
  id: number;
  username: string;
  name: string;
  role: 'admin' | 'member';
  active: number;
  must_change?: number;
  photoV?: number;
  last_seen?: string | null;
  tags: Tag[];
  email?: string;
  birthDate?: string;
  age?: number | null;
  department?: string;
  supervisor?: string;
  cosupervisor?: string;
  visitorUntil?: string | null;
  noPassword?: number;
};
/** What a tag can give (0.38): any tag may carry any of these; a tag with none is a label. */
export const PERMS: { key: string; label: string; note: string }[] = [
  {
    key: 'comments',
    label: 'Private comments',
    note: 'Sees every stack and batch and comments privately to its owner; these comments come first',
  },
  {
    key: 'overview',
    label: 'Lab manager',
    note: 'Sees every student’s progress and the lab’s equipment use',
  },
  { key: 'inventory', label: 'Inventory management', note: 'Edits the inventory' },
  {
    key: 'equipment',
    label: 'Equipment management',
    note: 'Adds, changes and removes any equipment, and chooses who is responsible for it',
  },
  { key: 'training', label: 'Equipment training', note: 'Marks people as trained on any equipment' },
];
/** The core's permissions, then the modules' (0.58: Electronic Devices' Edit designs). */
const allPerms = () => [...PERMS, ...MODULES.flatMap((m) => m.perms ?? [])];
const permsText = (t: Tag) =>
  (t.perms ?? [])
    .map((k) => allPerms().find((p) => p.key === k)?.label)
    .filter(Boolean)
    .join(', ');
const KIND_NOTE = { title: (t: Tag) => permsText(t) || undefined };
type Tab =
  | 'users'
  | 'requests'
  | 'lab'
  | 'screen'
  | 'network'
  | 'backups'
  | 'inventory'
  | 'security'
  | 'activity'
  | 'updates'
  | 'licence';
const dmy = (d?: string | null) => (d ? d.split('-').reverse().join('/') : '');

/** Admin settings: one tab per job, the last one used reopens. A new version shows as a strip above the tabs. */
export default function AdminSettings({ meId }: { meId: number }) {
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      return (localStorage.getItem('psc-admin-tab') as Tab) || 'users';
    } catch {
      return 'users';
    }
  });
  const setTab = (t: string) => {
    setTabState(t as Tab);
    try {
      localStorage.setItem('psc-admin-tab', t);
    } catch {
      /* private window */
    }
  };
  const [upd, setUpd] = useState<{ available: boolean; latest?: { version: string } } | null>(null),
    [waiting, setWaiting] = useState(0),
    [lic, setLic] = useState<{ critical: boolean; state: string } | null>(null);
  useEffect(() => {
    api<typeof upd>('/updates')
      .then(setUpd)
      .catch(() => {});
    api<typeof lic>('/licence')
      .then(setLic)
      .catch(() => {});
    api<{ n: number }>('/access-requests/count')
      .then((r) => setWaiting(r.n))
      .catch(() => {});
  }, [tab]);
  const TABS: [Tab, string][] = [
    ['users', 'Users'],
    ['requests', waiting ? `Access requests (${waiting})` : 'Access requests'],
    ['lab', 'Lab setup'],
    ['screen', 'Display mode'],
    ['network', 'Network'],
    ['backups', 'Backups'],
    ['inventory', 'Inventory'],
    ['security', 'Security'],
    ['activity', 'Activity log'],
    ['updates', 'Updates'],
    ['licence', 'Licence'],
  ];
  return (
    <div className="admin">
      {lic?.critical && tab !== 'licence' && (
        <div className="admin-upd">
          <span>
            <b>{lic.state === 'none' ? 'The licence file is missing.' : 'The licence file is not valid.'}</b> No one new
            can be let in until it is installed.
          </span>
          <button className="link" onClick={() => setTab('licence')}>
            Licence ›
          </button>
        </div>
      )}
      {upd?.available && tab !== 'updates' && (
        <div className="admin-upd">
          <span>
            Version <b>{upd.latest?.version}</b> is available.
          </span>
          <button className="link" onClick={() => setTab('updates')}>
            Updates ›
          </button>
        </div>
      )}
      <div className="toolbar-row">
        <Seg value={tab} on={setTab} opts={TABS} small />
      </div>
      {tab === 'users' ? (
        <Users meId={meId} />
      ) : tab === 'requests' ? (
        <div className="admin-one">
          <Requests onCount={setWaiting} />
        </div>
      ) : tab === 'lab' ? (
        <div className="admin-one">
          <LabSetup />
        </div>
      ) : tab === 'screen' ? (
        <div className="admin-one">
          <AdminScreen />
        </div>
      ) : tab === 'network' ? (
        <div className="admin-one">
          <NetworkTab />
        </div>
      ) : tab === 'backups' ? (
        <div className="admin-one">
          <Backups />
        </div>
      ) : tab === 'inventory' ? (
        <div className="admin-one">
          <AdminInventory />
        </div>
      ) : tab === 'security' ? (
        <div className="admin-one">
          <Security onTab={setTab} />
        </div>
      ) : tab === 'activity' ? (
        <Activity />
      ) : tab === 'licence' ? (
        <div className="admin-one">
          <Licence />
        </div>
      ) : (
        <div className="admin-one">
          <Updates />
        </div>
      )}
    </div>
  );
}

function Users({ meId }: { meId: number }) {
  const [list, setList] = useState<U[]>([]),
    [err, setErr] = useState(''),
    [edit, setEdit] = useState<number | null>(null),
    [tags, setTags] = useState<Tag[]>([]),
    [tagFor, setTagFor] = useState<number | null>(null);
  const load = () => {
    api<U[]>('/users').then(setList);
    api<Tag[]>('/tags').then(setTags);
  };
  const setUserTags = (u: U, ids: number[]) =>
    api(`/users/${u.id}/tags`, 'PUT', { tags: ids })
      .then(() => {
        setErr('');
        load();
      })
      .catch((x) => setErr(x.message));
  useEffect(() => {
    load();
  }, []);
  useRefresh(load, ['users']);
  const del = (u: U) => {
    if (
      !window.confirm(
        `Delete the profile of ${u.name} (@${u.username})?\n\nThey can no longer sign in. Everything they made (presets, stacks, batches, run data, measurements) stays in the app, shown as “${u.username} (former)”.`,
      )
    )
      return;
    api('/users/' + u.id, 'DELETE')
      .then(() => {
        setErr('');
        load();
      })
      .catch((x) => setErr(x.message));
  };
  const patch = (id: number, b: object) =>
    api('/users/' + id, 'PATCH', b)
      .then(() => {
        setErr('');
        load();
      })
      .catch((x) => setErr(x.message));
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
                <span>
                  <b>{u.name}</b>{' '}
                  <span className="mut">
                    @{u.username} · {u.role}
                    {u.active ? '' : ' · disabled'}
                  </span>
                  {u.visitorUntil ? (
                    <>
                      {' '}
                      <Badge>Visitor until {dmy(u.visitorUntil)}</Badge>
                    </>
                  ) : null}
                  {u.noPassword ? (
                    <>
                      {' '}
                      <Badge tone="warn">no password yet</Badge>
                    </>
                  ) : u.must_change ? (
                    <>
                      {' '}
                      <Badge tone="warn">temporary password</Badge>
                    </>
                  ) : null}
                  <span className="user-facts mut small">
                    {[
                      u.department,
                      u.supervisor &&
                        `supervisor ${u.supervisor}${u.cosupervisor ? `, co-supervisor ${u.cosupervisor}` : ''}`,
                      u.age != null && `${u.age} years`,
                      u.email,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="actions">
                  <button className="link" onClick={() => setTagFor(tagFor === u.id ? null : u.id)}>
                    {tagFor === u.id ? 'Done' : 'Tags'}
                  </button>
                  <button className="link" onClick={() => setEdit(u.id)}>
                    Details
                  </button>
                  {u.id !== meId && !u.noPassword && (
                    <button
                      className="link"
                      onClick={() =>
                        window.confirm(
                          `Reset the password of ${u.name}?\n\nTheir current password stops working at once. At the next sign-in they type @${u.username}, leave the password empty, confirm their email and birth date, and choose a new one.`,
                        ) && patch(u.id, { resetPassword: true })
                      }
                    >
                      Reset password
                    </button>
                  )}
                  {u.id !== meId && (
                    <button className="link" onClick={() => patch(u.id, { active: !u.active })}>
                      {u.active ? 'Disable' : 'Enable'}
                    </button>
                  )}
                  {u.id !== meId && (
                    <button className="link danger-link" onClick={() => del(u)}>
                      Delete
                    </button>
                  )}
                </span>
              </div>
              {edit === u.id && <UserSheet u={u} onClose={() => setEdit(null)} save={(b) => patch(u.id, b)} />}
              {tagFor === u.id ? (
                <div className="chips">
                  {tags.map((t) => {
                    const has = u.tags.some((x) => x.id === t.id);
                    return (
                      <button
                        key={t.id}
                        className={'tag' + (has ? '' : ' off')}
                        style={{ '--tag': t.color } as React.CSSProperties}
                        aria-pressed={has}
                        title={KIND_NOTE.title(t)}
                        onClick={() =>
                          setUserTags(
                            u,
                            has
                              ? u.tags.filter((x) => x.id !== t.id).map((x) => x.id)
                              : [...u.tags.map((x) => x.id), t.id],
                          )
                        }
                      >
                        {has ? '✓ ' : '+ '}
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                u.tags.length > 0 && (
                  <div className="chips">
                    {u.tags.map((t) => (
                      <span key={t.id} className="tag" style={{ '--tag': t.color } as React.CSSProperties}>
                        {t.name}
                      </span>
                    ))}
                  </div>
                )
              )}
            </div>
          ))}
        </section>
        <AddVisitor onAdded={load} />
      </div>
      <div>
        <Tags tags={tags} reload={load} />
      </div>
    </div>
  );
}

type B = {
  name: string;
  kind: 'auto' | 'manual' | 'update' | 'before-restore' | 'before-purge';
  size: number;
  created: string;
  enc?: boolean;
};
const KIND: Record<B['kind'], string> = {
  auto: 'Daily',
  manual: 'Manual',
  update: 'Before update',
  'before-restore': 'Before restore',
  'before-purge': 'Before purge',
};
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
const ago = (iso: string) => {
  const h = (Date.now() - new Date(iso).getTime()) / 3.6e6;
  return h < 1 ? 'less than an hour ago' : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
};

/** Database backups: the server makes one a day by itself; admins can make one now and download any of them. */
function Backups() {
  type Mirror = { dir: string; encrypt?: boolean; last?: { at: string; ok: boolean; msg: string } };
  type Check = { name: string; at: string; ok: boolean; msg: string } | null;
  const [key, setKey] = useState(''),
    [enc, setEnc] = useState<boolean | null>(null);
  type D = {
    dir: string;
    files: B[];
    mirror: Mirror;
    check: Check;
    setup?: boolean;
    recovery?: { pending: boolean; downloaded: string | null };
  };
  const [d, setD] = useState<D | null>(null),
    [busy, setBusy] = useState(false),
    [msg, setMsg] = useState(''),
    [all, setAll] = useState(false);
  const [mdir, setMdir] = useState<string | null>(null),
    [mmsg, setMmsg] = useState('');
  const load = () =>
    api<D>('/backups')
      .then(setD)
      .catch((e) => setMsg(e.message));
  const saveMirror = (dir: string, encrypt = enc ?? d?.mirror.encrypt ?? true) =>
    api<Mirror>('/backups/mirror', 'PUT', { dir, encrypt })
      .then((m) => {
        setMdir(null);
        setMmsg(
          m.dir
            ? m.last?.ok
              ? `Saved · ${m.last.msg}`
              : `Saved, but: ${m.last?.msg ?? ''}`
            : 'Second copy turned off',
        );
        load();
      })
      .catch((e) => setMmsg(e.message));
  useEffect(() => {
    load();
  }, []);
  const now = () => {
    setBusy(true);
    api<B>('/backups', 'POST')
      .then((b) => {
        setMsg(`Backed up: ${b.name}`);
        load();
      })
      .catch((e) => setMsg(e.message))
      .finally(() => setBusy(false));
  };
  const last = d?.files[0],
    shown = all ? (d?.files ?? []) : (d?.files ?? []).slice(0, 8);
  return (
    <div>
      <h3 className="sub">Backups</h3>
      <section className="group">
        <div className="inline" style={{ justifyContent: 'space-between' }}>
          <span>
            {last ? (
              <>
                Last backup <b>{ago(last.created)}</b> <span className="mut">({when(last.created)})</span>
              </>
            ) : (
              <span className="mut">No backups yet</span>
            )}
          </span>
          <button className="btn" disabled={busy} onClick={now}>
            {busy ? 'Backing up…' : 'Back up now'}
          </button>
        </div>
        {d?.check && (
          <p className={'small ' + (d.check.ok ? 'ok' : 'err')}>
            {d.check.ok
              ? '✓ Checked: the last backup opens as a complete database'
              : '✕ The last backup failed its check'}{' '}
            ({d.check.msg}).
          </p>
        )}
        {msg && <p className="mut small">{msg}</p>}
        {shown.length > 0 && (
          <div className="scroll">
            <table className="list">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.name}>
                    <td>{when(b.created)}</td>
                    <td>
                      <Badge tone={b.kind === 'manual' ? 'ac' : undefined}>{KIND[b.kind]}</Badge>
                    </td>
                    <td>{(b.size / 1024).toFixed(0)} KB</td>
                    <td>
                      <a className="link" href={'/api/backups/' + encodeURIComponent(b.name)} download>
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(d?.files.length ?? 0) > 8 && (
          <button className="link" style={{ justifySelf: 'start' }} onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${d!.files.length}`}
          </button>
        )}
        <p className="mut small">
          The app backs up the database once a day while it runs, and before every update, and opens each backup to
          check it. It keeps the last 14 daily and 30 manual backups. Folder: <code>{d?.dir ?? 'backups'}</code>
        </p>
        <p className="mut small">
          To move the lab to another computer, or replace one that failed: install PANOPTICA there and choose{' '}
          <b>Restore from a backup</b> in its first setup.
          {!d?.setup && (
            <>
              {' '}
              To go back to a backup on this computer: close the app window, run <b>restore.bat</b> (Windows) or{' '}
              <b>restore.command</b> (Mac) in the app folder, and choose it. The current database is backed up first.
            </>
          )}
        </p>
      </section>
      <h3 className="sub">Recovery file</h3>
      <section className="group">
        <p className="small">
          It holds the backup key and the lab’s id. With it, a new PANOPTICA restores this lab from its backups, also
          the encrypted second copies. Keep it off this computer: in a password manager, or on a USB stick kept with the
          lab’s papers.
        </p>
        <div className="inline">
          <a className="btn secondary" href="/api/backups/recovery" download onClick={() => setTimeout(load, 500)}>
            Download the recovery file
          </a>
          <span className={d?.recovery?.downloaded ? 'mut small' : 'warn-text small'}>
            {d?.recovery?.downloaded ? `Last downloaded ${fmtDateTime(d.recovery.downloaded)}` : 'Not downloaded yet'}
          </span>
        </div>
      </section>
      <h3 className="sub">Second copy off this computer</h3>
      <section className="group">
        <p className="mut small">
          Every backup is also copied to this folder, so a broken or stolen computer does not take the backups with it.
          Use a network drive or a folder that a cloud app (Google Drive, OneDrive, Dropbox) keeps in sync, as seen from{' '}
          <b>the computer that runs the app</b>, for example <code>Z:\PANOPTICA</code>,{' '}
          <code>/Volumes/LabShare/PANOPTICA</code> or <code>/home/lab/Google Drive/PANOPTICA</code>.
        </p>
        <div className="inline">
          <input
            style={{ flex: 1, minWidth: 220 }}
            placeholder="Folder for the second copy (empty = off)"
            value={mdir ?? d?.mirror.dir ?? ''}
            onChange={(e) => setMdir(e.target.value)}
          />
          <button
            className="btn"
            disabled={mdir === null && enc === null}
            onClick={() => saveMirror(mdir ?? d?.mirror.dir ?? '')}
          >
            Save
          </button>
          {d?.mirror.dir && (
            <button className="link" onClick={() => saveMirror(d.mirror.dir)}>
              Copy now
            </button>
          )}
        </div>
        {d?.mirror.dir && d.mirror.last && (
          <p className={'small ' + (d.mirror.last.ok ? 'ok' : 'err')}>
            {d.mirror.last.ok ? 'Last copy' : 'Last copy failed'} {ago(d.mirror.last.at)}: {d.mirror.last.msg}
            {d.mirror.last.ok ? '' : ' · the app tries again every hour'}
          </p>
        )}
        <label className="inline small">
          <input
            type="checkbox"
            checked={enc ?? d?.mirror.encrypt ?? true}
            onChange={(e) => setEnc(e.target.checked)}
          />{' '}
          Encrypt the copies (AES-256). Recommended: the folder is often shared or in the cloud.
        </label>
        {!d?.mirror.dir && (
          <p className="warn-text small">No second copy yet: the backups are only on this computer.</p>
        )}
        {mmsg && <p className="mut small">{mmsg}</p>}
        {(enc ?? d?.mirror.encrypt ?? true) && (
          <div className="bk-key">
            <p className="small">
              <b>Backup key.</b> The encrypted copies can only be read with this key. It is kept on this computer and in
              the recovery file.
            </p>
            {key ? (
              <>
                <code className="bk-key-v">{key}</code>
                <div className="inline">
                  <button className="link" onClick={() => navigator.clipboard?.writeText(key)}>
                    Copy
                  </button>
                  <button className="link" onClick={() => setKey('')}>
                    Hide
                  </button>
                </div>
              </>
            ) : (
              <button
                className="btn secondary"
                onClick={() =>
                  api<{ key: string }>('/backups/key')
                    .then((r) => setKey(r.key))
                    .catch((e) => setMmsg(e.message))
                }
              >
                Show key
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** Tags: labels (Master's, PhD, research topics…) and the permissions they give. */
/** The lab's tags: click one for what it gives and who has it; New tag opens the same window, empty. */
function Tags({ tags, reload }: { tags: Tag[]; reload: () => void }) {
  const [open, setOpen] = useState<Tag | 'new' | null>(null);
  return (
    <>
      <h3 className="sub">Tags</h3>
      <section className="group">
        <ul className="tag-list">
          {tags.map((t) => (
            <li key={t.id}>
              <button className="tag-row" onClick={() => setOpen(t)}>
                <span className="tag" style={{ '--tag': t.color } as React.CSSProperties}>
                  {t.name}
                </span>
                <span className="mut small grow">{permsText(t) || 'Label'}</span>
                <span className="mut small">
                  {t.n ?? 0} {t.n === 1 ? 'person' : 'people'}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mut small">Give tags to people under Users (Tags).</p>
        <button className="btn secondary" onClick={() => setOpen('new')}>
          New tag
        </button>
      </section>
      {open && (
        <TagSheet
          tag={open === 'new' ? null : open}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function TagSheet({ tag, onClose, onDone }: { tag: Tag | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(tag?.name ?? ''),
    [color, setColor] = useState(tag?.color ?? '#2563eb'),
    [perms, setPerms] = useState<string[]>(tag?.perms ?? []),
    [err, setErr] = useState('');
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    (tag
      ? api('/tags/' + tag.id, 'PATCH', { name: name.trim(), color, perms })
      : api('/tags', 'POST', { name: name.trim(), color, perms })
    )
      .then(onDone)
      .catch((x) => setErr(x.message));
  };
  return (
    <Modal onClose={onClose} className="tag-sheet">
      <form onSubmit={save}>
        <div className="modal-head">
          <b>{tag ? tag.name : 'New tag'}</b>
        </div>
        <div className="eq-form">
          <div className="inline">
            <input type="color" aria-label="Colour" value={color} onChange={(e) => setColor(e.target.value)} />
            <label className="fld grow">
              <span>Name</span>
              <input
                autoFocus={!tag}
                value={name}
                placeholder="For example 2D perovskites"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </div>
          <div className="fld">
            <span>What it gives</span>
            <ul className="perm-list">
              {allPerms().map((p) => (
                <li key={p.key}>
                  <label className="inline">
                    <input
                      type="checkbox"
                      checked={perms.includes(p.key)}
                      onChange={(e) =>
                        setPerms(e.target.checked ? [...perms, p.key] : perms.filter((x) => x !== p.key))
                      }
                    />
                    <span>
                      {p.label}
                      <span className="mut small"> · {p.note}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <span className="mut small">With none ticked the tag is a label. Admins can do all of these anyway.</span>
          </div>
          {tag && (
            <div className="fld">
              <span>Who has it</span>
              {tag.people?.length ? (
                <div className="eq-people">
                  {tag.people.map((p) => (
                    <span key={p.id} className="eq-person">
                      <Avatar id={p.id} name={p.name} photoV={p.photoV} size={24} /> {p.name}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="mut">No one yet.</span>
              )}
            </div>
          )}
          {err && <p className="err small">{err}</p>}
          <div className="dialog-actions">
            {tag && (
              <button
                type="button"
                className="link danger-link"
                onClick={() =>
                  window.confirm(`Delete the tag “${tag.name}”? People lose what it gives.`) &&
                  api('/tags/' + tag.id, 'DELETE')
                    .then(onDone)
                    .catch((x) => setErr(x.message))
                }
              >
                Delete tag
              </button>
            )}
            <div className="grow" />
            <button type="button" className="link" onClick={onClose}>
              Cancel
            </button>
            <button className="btn" disabled={!name.trim()}>
              {tag ? 'Save' : 'Add tag'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

type Training = {
  id: number;
  name: string;
  color: string;
  trained: boolean;
  at?: string;
  by?: string;
  note?: string;
  canTrain: boolean;
};
/**
 * A person, read only: who they are, how to reach them, their tags, and the equipment they are trained on (ticked by
 * whoever may train on that equipment). Edit details opens the form.
 */
function UserSheet({ u, onClose, save }: { u: U; onClose: () => void; save: (b: object) => Promise<unknown> }) {
  const [tr, setTr] = useState<Training[] | null>(null),
    [editing, setEditing] = useState(false),
    [err, setErr] = useState('');
  const loadTr = () =>
    api<Training[]>(`/users/${u.id}/training`)
      .then(setTr)
      .catch((x) => setErr(x.message));
  useEffect(() => {
    loadTr();
  }, [u.id]);
  const facts: [string, string][] = [
    ['Username', '@' + u.username],
    ['Role', u.role === 'admin' ? 'Admin' : 'Member'],
    ['Department', u.department || '—'],
    ['Supervisor', u.supervisor || '—'],
    ['Co-supervisor', u.cosupervisor || '—'],
    ['Institutional email', u.email || '—'],
    ['Birth date', u.birthDate ? `${dmy(u.birthDate)}${u.age != null ? ` (${u.age} years)` : ''}` : '—'],
    ...(u.visitorUntil ? ([['Visitor until', dmy(u.visitorUntil)]] as [string, string][]) : []),
    ['Account', !u.active ? 'Disabled' : u.noPassword ? 'No password yet' : 'Active'],
    ['Last seen', u.last_seen ? fmtDate(u.last_seen) : 'Never'],
  ];
  return (
    <Modal onClose={onClose} className="user-sheet">
      <div className="modal-head">
        <Avatar id={u.id} name={u.name} photoV={u.photoV} size={48} />
        <div className="title-block grow">
          <h2>{u.name}</h2>
          {u.tags.length > 0 && (
            <div className="chips">
              {u.tags.map((t) => (
                <span key={t.id} className="tag" style={{ '--tag': t.color } as React.CSSProperties}>
                  {t.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <button className="iconbtn" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="modal-body eq-body">
        {editing ? (
          <section className="group">
            <h3>Edit details</h3>
            <UserDetails
              u={u}
              save={(b) =>
                save(b).then(() => {
                  setEditing(false);
                })
              }
            />
            <button className="link" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </section>
        ) : (
          <section className="group">
            <dl className="user-facts-list">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <button className="link" onClick={() => setEditing(true)}>
              Edit details
            </button>
          </section>
        )}
        <section className="group">
          <h3>Equipment training</h3>
          <p className="mut small">
            Booking a piece of equipment needs training on it. Its responsible people, Equipment training and admins
            tick it here or on the equipment’s page.
          </p>
          {err && <p className="err small">{err}</p>}
          {!tr ? (
            <p className="mut">Loading…</p>
          ) : !tr.length ? (
            <p className="mut">No bookable equipment yet (Lab › Equipment).</p>
          ) : (
            <ul className="train-list">
              {tr.map((e) => (
                <li key={e.id} style={{ '--eq': e.color } as React.CSSProperties}>
                  <label className="inline">
                    <input
                      type="checkbox"
                      checked={e.trained}
                      disabled={!e.canTrain}
                      onChange={(x) =>
                        api(`/equipment/${e.id}/training/${u.id}`, x.target.checked ? 'POST' : 'DELETE', {})
                          .then(loadTr)
                          .catch((y) => setErr(y.message))
                      }
                    />
                    <span className="eq-name">{e.name}</span>
                  </label>
                  <span className="mut small">
                    {e.trained
                      ? `${e.at ? fmtDate(e.at) : ''}${e.by ? `, by ${e.by}` : e.note ? `, ${e.note}` : ''}`
                      : 'Not trained'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}

/** What an admin keeps up to date for a person: department, supervisors, email, birth date, the end of a visit. */
function UserDetails({ u, save }: { u: U; save: (b: object) => Promise<unknown> }) {
  const [v, setV] = useState({
    department: u.department ?? '',
    supervisor: u.supervisor ?? '',
    cosupervisor: u.cosupervisor ?? '',
    email: u.email ?? '',
    birthDate: u.birthDate ?? '',
    until: u.visitorUntil ?? '',
  });
  const put = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      className="user-details"
      onSubmit={(e) => {
        e.preventDefault();
        const { until, ...rest } = v;
        save(u.visitorUntil ? { ...rest, until } : rest);
      }}
    >
      <div className="details-grid">
        <label className="fld">
          <span>Department</span>
          <input value={v.department} onChange={put('department')} />
        </label>
        <label className="fld">
          <span>Supervisor</span>
          <input value={v.supervisor} onChange={put('supervisor')} />
        </label>
        <label className="fld">
          <span>Co-supervisor</span>
          <input value={v.cosupervisor} onChange={put('cosupervisor')} />
        </label>
        <label className="fld">
          <span>Institutional email</span>
          <input type="email" value={v.email} onChange={put('email')} />
        </label>
        <label className="fld">
          <span>Birth date</span>
          <input type="date" max={todayIso()} value={v.birthDate} onChange={put('birthDate')} />
        </label>
        {u.visitorUntil && (
          <label className="fld">
            <span>Visitor until</span>
            <input type="date" value={v.until} onChange={put('until')} />
          </label>
        )}
      </div>
      <button className="btn secondary">Save details</button>
    </form>
  );
}

/** Admins create accounts only for visitors; everyone else asks for access from the sign-in screen. */
function AddVisitor({ onAdded }: { onAdded: () => void }) {
  const [n, setN] = useState<NameParts>({ firstNames: '', surnames: '', surname: '' }),
    [email, setEmail] = useState(''),
    [birth, setBirth] = useState(''),
    [dept, setDept] = useState(''),
    [until, setUntil] = useState(''),
    [msg, setMsg] = useState(''),
    [err, setErr] = useState(''),
    [full, setFull] = useState('');
  // the licence's number of people (0.49): said before the form is filled, not after
  const room = () =>
    api<{ full: string }>('/access-requests/count')
      .then((r) => setFull(r.full))
      .catch(() => {});
  useEffect(() => {
    room();
  }, []);
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    api<{ username: string }>('/users', 'POST', { ...n, email, birthDate: birth, department: dept, until })
      .then((r) => {
        setMsg(
          `@${r.username} added. At their first sign-in they type the username, leave the password empty, confirm this email and birth date, and choose a password.`,
        );
        setErr('');
        setN({ firstNames: '', surnames: '', surname: '' });
        setEmail('');
        setBirth('');
        setDept('');
        setUntil('');
        onAdded();
        room();
      })
      .catch((x) => setErr(x.message));
  };
  return (
    <>
      <h3 className="sub">Add a visitor</h3>
      <form className="group visitor-form" onSubmit={add}>
        <p className="mut small">
          For people outside the lab who need PANOPTICA for a while. Lab members ask for access from the sign-in screen
          and appear under Access requests.
        </p>
        {full && <p className="warn-text small">{full}.</p>}
        <NameFields
          self={false}
          v={n}
          set={setN}
          check={(first, surname) =>
            api<{ username: string | null }>(
              `/access-requests/username?first=${encodeURIComponent(first)}&surname=${encodeURIComponent(surname)}`,
            ).then((r) => r.username)
          }
        />
        <div className="grid2">
          <label className="fld">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="fld">
            <span>Birth date</span>
            <input type="date" max={todayIso()} value={birth} onChange={(e) => setBirth(e.target.value)} />
          </label>
          <label className="fld">
            <span>Institution or department</span>
            <input value={dept} onChange={(e) => setDept(e.target.value)} />
          </label>
          <label className="fld">
            <span>Last day of the visit</span>
            <input type="date" min={todayIso()} value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        </div>
        {err && <p className="err small">{err}</p>}
        {msg && <p className="ok small">{msg}</p>}
        <button className="btn" disabled={!!full || !n.firstNames.trim() || !n.surname || !email || !birth || !until}>
          Add visitor
        </button>
      </form>
    </>
  );
}

type Req = {
  id: number;
  username: string;
  firstNames: string;
  surnames: string;
  email: string;
  birthDate: string;
  department: string;
  supervisor: string;
  cosupervisor: string;
  status: 'pending' | 'declined';
  reason: string;
  createdAt: string;
  hasPhoto?: number;
  decidedAt?: string;
  decidedBy?: string;
};
/** People who asked for access: accept (with tags) or decline (with a reason they see when they try to sign in). */
function Requests({ onCount }: { onCount: (n: number) => void }) {
  const [list, setList] = useState<Req[] | null>(null),
    [tags, setTags] = useState<Tag[]>([]),
    [pick, setPick] = useState<Record<number, number[]>>({}),
    [why, setWhy] = useState<Record<number, string | undefined>>({}),
    [msg, setMsg] = useState(''),
    [err, setErr] = useState(''),
    [full, setFull] = useState('');
  const load = () => {
    api<{ full: string }>('/access-requests/count')
      .then((r) => setFull(r.full))
      .catch(() => {});
    return api<Req[]>('/access-requests')
      .then((l) => {
        setList(l);
        onCount(l.filter((r) => r.status === 'pending').length);
      })
      .catch((e) => setErr(e.message));
  };
  useEffect(() => {
    load();
    api<Tag[]>('/tags').then(setTags);
  }, []);
  useRefresh(load, ['users']);
  const accept = (r: Req) =>
    api(`/access-requests/${r.id}/accept`, 'POST', { tags: pick[r.id] ?? [] })
      .then(() => {
        setMsg(
          `${r.firstNames} ${r.surnames} can now sign in as @${r.username}: they leave the password empty the first time and choose one.`,
        );
        load();
      })
      .catch((e) => setErr(e.message));
  const decline = (r: Req) =>
    api(`/access-requests/${r.id}/decline`, 'POST', { reason: why[r.id] ?? '' })
      .then(() => {
        setMsg(`Request of ${r.firstNames} ${r.surnames} declined.`);
        setWhy({ ...why, [r.id]: undefined });
        load();
      })
      .catch((e) => setErr(e.message));
  const pending = list?.filter((r) => r.status === 'pending') ?? [],
    declined = list?.filter((r) => r.status === 'declined') ?? [];
  return (
    <>
      <h3 className="sub">Access requests</h3>
      {full && pending.length > 0 && <p className="warn-text small">{full}. Requests stay here until there is room.</p>}
      {err && <p className="err small">{err}</p>}
      {msg && <p className="ok small">{msg}</p>}
      {list && !pending.length && (
        <section className="group">
          <p className="mut">
            No requests waiting. People ask for access from the sign-in screen (Request access); admins are notified.
          </p>
        </section>
      )}
      {pending.map((r) => {
        const age = ageOn(r.birthDate);
        return (
          <section className="group req" key={r.id}>
            <div className="req-head">
              {r.hasPhoto ? (
                <img
                  className="req-photo"
                  src={`/api/access-requests/${r.id}/photo`}
                  alt={`Photo of ${r.firstNames}`}
                />
              ) : (
                <Avatar id={0} name={`${r.firstNames} ${r.surnames}`} size={72} className="req-photo" />
              )}
              <div>
                <b className="req-name">
                  {r.firstNames} {r.surnames}
                </b>
                <div className="mut">
                  @{r.username} · asked {fmtDate(r.createdAt)}
                </div>
              </div>
            </div>
            <dl className="req-facts">
              <dt>Email</dt>
              <dd>{r.email}</dd>
              <dt>Department</dt>
              <dd>{r.department}</dd>
              <dt>Supervisor</dt>
              <dd>
                {r.supervisor}
                {r.cosupervisor ? `; co-supervisor ${r.cosupervisor}` : ''}
              </dd>
              <dt>Birth date</dt>
              <dd>
                {dmy(r.birthDate)}
                {age !== null ? ` (${age} years)` : ''}
              </dd>
            </dl>
            {tags.length > 0 && (
              <div className="req-tags">
                <span className="mut small">Tags when accepted</span>
                <div className="chips">
                  {tags.map((t) => {
                    const on = (pick[r.id] ?? []).includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={'tag' + (on ? '' : ' off')}
                        style={{ '--tag': t.color } as React.CSSProperties}
                        aria-pressed={on}
                        title={KIND_NOTE.title(t)}
                        onClick={() =>
                          setPick({
                            ...pick,
                            [r.id]: on ? (pick[r.id] ?? []).filter((x) => x !== t.id) : [...(pick[r.id] ?? []), t.id],
                          })
                        }
                      >
                        {on ? '✓ ' : '+ '}
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {why[r.id] !== undefined ? (
              <div className="inline req-decline">
                <input
                  autoFocus
                  placeholder="Reason, shown to them when they try to sign in (optional)"
                  value={why[r.id]}
                  onChange={(e) => setWhy({ ...why, [r.id]: e.target.value })}
                />
                <button className="btn danger" onClick={() => decline(r)}>
                  Decline
                </button>
                <button className="link" onClick={() => setWhy({ ...why, [r.id]: undefined })}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="inline">
                <button className="btn" disabled={!!full} title={full || undefined} onClick={() => accept(r)}>
                  Accept
                </button>
                <button className="link danger-link" onClick={() => setWhy({ ...why, [r.id]: '' })}>
                  Decline…
                </button>
              </div>
            )}
          </section>
        );
      })}
      {declined.length > 0 && (
        <>
          <h3 className="sub">Declined</h3>
          <section className="group">
            {declined.map((r) => (
              <div key={r.id} className="req-done">
                <span>
                  {r.firstNames} {r.surnames} <span className="mut">· {r.email}</span>
                </span>
                <span className="mut small">
                  declined {r.decidedAt ? fmtDate(r.decidedAt) : ''}
                  {r.decidedBy ? ` by ${r.decidedBy}` : ''}
                  {r.reason ? `: “${r.reason}”` : ''}
                </span>
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}

/** Lab setup: what the first setup asked, to change later. Each part is saved on its own. */
function LabSetup() {
  const { reload } = useContext(LabCtx),
    lastSaved = useRef<string>('');
  const [d, setD] = useState<LabDraft | null>(null),
    [saved, setSaved] = useState<{ bg: string; logo: string; inst: string }>({ bg: '', logo: '', inst: '' }),
    [msg, setMsg] = useState<Record<string, string>>({});
  const take = (l: any) => {
    setD({
      ...blankLab(),
      name: l.name,
      acronym: l.acronym ?? '',
      show: l.show ?? 'name',
      institution: l.institution,
      domains: l.domains.join(', '),
      departments: l.departments.join('\n'),
      hours: l.hours,
      logoPos: l.logoPos ?? 'br',
      logoPlate: l.logoPlate ?? true,
      foot: l.foot ?? 'name',
    });
    lastSaved.current = JSON.stringify([l.logoPos ?? 'br', l.logoPlate ?? true, l.foot ?? 'name']);
    setSaved({
      bg: l.hasBackground ? `/api/lab/background?v=${l.bgV}` : '',
      logo: l.hasLogo ? `/api/lab/logo?v=${l.bgV}` : '',
      inst: l.hasInstLogo ? `/api/lab/institution-logo?v=${l.bgV}` : '',
    });
  };
  useEffect(() => {
    api('/lab').then(take);
  }, []);
  if (!d) return <p className="mut">Loading…</p>;
  const set = (p: Partial<LabDraft>) => setD({ ...d, ...p });
  const save = (part: string, body: object) =>
    api('/lab', 'PUT', body)
      .then((l) => {
        take(l);
        reload();
        setMsg({ [part]: 'Saved' });
      })
      .catch((e) => setMsg({ [part]: e.message }));
  const b = labBody(d);
  return (
    <>
      <h3 className="sub">The lab</h3>
      <section className="group lab-setup">
        <LabFields d={d} set={set} />
        <div className="inline">
          <button
            className="btn"
            disabled={!d.name.trim()}
            onClick={() =>
              save('lab', {
                name: b.name,
                acronym: b.acronym,
                show: b.show,
                institution: b.institution,
                domains: b.domains,
                departments: b.departments,
              })
            }
          >
            Save
          </button>
          {msg.lab && <span className="mut small">{msg.lab}</span>}
        </div>
      </section>
      <h3 className="sub">Sign-in screen</h3>
      <section className="group lab-setup">
        <LookFields d={d} set={set} saved={saved} />
        <div className="inline">
          <button
            className="btn"
            disabled={
              d.background === undefined &&
              d.logo === undefined &&
              d.instLogo === undefined &&
              lastSaved.current === JSON.stringify([d.logoPos, d.logoPlate, d.foot])
            }
            onClick={() =>
              save('look', {
                logoPos: d.logoPos,
                logoPlate: d.logoPlate,
                foot: d.foot,
                ...(d.background !== undefined ? { background: d.background } : {}),
                ...(d.logo !== undefined ? { logo: d.logo } : {}),
                ...(d.instLogo !== undefined ? { instLogo: d.instLogo } : {}),
              })
            }
          >
            Save
          </button>
          {msg.look && <span className="mut small">{msg.look}</span>}
        </div>
      </section>
      <h3 className="sub">Working days and hours</h3>
      <section className="group lab-setup">
        <p className="mut small">
          The calendar stripes the hours outside these. Bookings there are allowed, and the admins are told.
        </p>
        <HoursFields hours={d.hours} set={(hours) => set({ hours })} />
        <div className="inline">
          <button className="btn" disabled={!hoursOk(d.hours)} onClick={() => save('hours', { hours: d.hours })}>
            Save
          </button>
          {msg.hours && <span className="mut small">{msg.hours}</span>}
        </div>
      </section>
    </>
  );
}
