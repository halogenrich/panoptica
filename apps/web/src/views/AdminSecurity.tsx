import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge } from '../lib/ui';
import { Picker } from './Picker';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
const ago = (iso: string) => {
  const h = (Date.now() - new Date(iso).getTime()) / 3.6e6;
  return h < 1 ? 'less than an hour ago' : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
};
const list = (a: string[]) => (a.length <= 3 ? a.join(', ') : `${a.slice(0, 3).join(', ')} and ${a.length - 3} more`);

// ------------------------------------------------------------------ Security: one checklist
type Sec = {
  https: boolean;
  tls: boolean;
  trustProxy: boolean;
  lan: boolean;
  admins: string[];
  temporary: string[];
  idle: string[];
  backups: {
    last: { name: string; created: string } | null;
    check: { at: string; ok: boolean; msg: string } | null;
    mirror: { dir: string; encrypt?: boolean; last?: { at: string; ok: boolean; msg: string } };
  };
  audit: { ok: boolean; rows: number; brokenAt?: { id: number; at: string } };
};
type Level = 'ok' | 'warn' | 'bad';
const ICON: Record<Level, string> = { ok: '✓', warn: '!', bad: '✕' };

/** What keeps the lab's data safe, each with its state and, when it is not fine, what to do. */
export function Security({ onTab }: { onTab: (t: string) => void }) {
  const [s, setS] = useState<Sec | null>(null),
    [err, setErr] = useState('');
  useEffect(() => {
    api<Sec>('/security')
      .then(setS)
      .catch((e) => setErr(e.message));
  }, []);
  if (err) return <p className="err">{err}</p>;
  if (!s) return <p className="mut">Checking…</p>;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const b = s.backups,
    fresh = b.last && Date.now() - new Date(b.last.created).getTime() < 26 * 3.6e6;
  const items: { level: Level; title: string; text: React.ReactNode; action?: [string, () => void] }[] = [
    s.https
      ? {
          level: 'ok',
          title: 'Encrypted connection (HTTPS)',
          text: 'Passwords and data are encrypted between the browsers and the app.',
        }
      : local && !s.lan
        ? {
            level: 'ok',
            title: 'Only this computer',
            text: 'The app is not open to the network, so nothing crosses it. Before other computers use it, set up HTTPS.',
          }
        : {
            level: 'bad',
            title: 'No encrypted connection (plain HTTP)',
            text: (
              <>
                Passwords and lab data cross the network unencrypted. Put the app behind HTTPS: the university's web
                server in front of it, or a certificate for the app itself. See <i>docs/security-and-data.md</i>,
                section “Hosting”.
              </>
            ),
          },
    !b.last
      ? { level: 'bad', title: 'No backup yet', text: 'Make one now.', action: ['Backups', () => onTab('backups')] }
      : !b.check?.ok
        ? {
            level: 'bad',
            title: 'The last backup failed its check',
            text: b.check?.msg ?? '',
            action: ['Backups', () => onTab('backups')],
          }
        : {
            level: fresh ? 'ok' : 'warn',
            title: fresh ? 'Daily backup, checked' : 'The last backup is old',
            text: (
              <>
                Last backup {ago(b.last.created)}; it opens as a complete database ({b.check.msg}).
              </>
            ),
          },
    !b.mirror.dir
      ? {
          level: 'warn',
          title: 'Backups only on this computer',
          text: 'A broken or stolen computer takes the backups with it. Set a second copy on a network drive or a synced folder.',
          action: ['Backups', () => onTab('backups')],
        }
      : !b.mirror.last?.ok
        ? {
            level: 'bad',
            title: 'The second copy is failing',
            text: b.mirror.last?.msg ?? 'not copied yet',
            action: ['Backups', () => onTab('backups')],
          }
        : {
            level: b.mirror.encrypt ? 'ok' : 'warn',
            title: b.mirror.encrypt ? 'Encrypted second copy' : 'Second copy not encrypted',
            text: b.mirror.encrypt ? (
              <>
                Copied {ago(b.mirror.last.at)} to <code>{b.mirror.dir}</code>. Keep the backup key somewhere safe:
                without it the copies cannot be read.
              </>
            ) : (
              'Anyone who can open that folder can read the lab data. Turn on encryption.'
            ),
            action: ['Backups', () => onTab('backups')],
          },
    s.audit.ok
      ? {
          level: 'ok',
          title: 'Activity log intact',
          text: `${s.audit.rows} entries, none edited or removed.`,
          action: ['Activity log', () => onTab('activity')],
        }
      : {
          level: 'bad',
          title: 'The activity log was altered',
          text: `Entry ${s.audit.brokenAt?.id} (${s.audit.brokenAt ? when(s.audit.brokenAt.at) : ''}) does not match the chain: entries were edited or removed in the database directly.`,
          action: ['Activity log', () => onTab('activity')],
        },
    {
      level: s.admins.length === 1 ? 'warn' : s.admins.length > 3 ? 'warn' : 'ok',
      title: `${s.admins.length} admin${s.admins.length === 1 ? '' : 's'}`,
      text:
        s.admins.length === 1
          ? `Only ${s.admins[0]}. Make a second admin, so the lab is not locked out if this account is lost.`
          : s.admins.length > 3
            ? `${list(s.admins)}. Admins can read everything and change accounts: keep it to two or three people.`
            : list(s.admins),
    },
    s.temporary.length
      ? {
          level: 'warn',
          title: 'Temporary passwords not changed yet',
          text: `${list(s.temporary)}. They choose their own at the next sign-in.`,
        }
      : {
          level: 'ok',
          title: 'Everyone chose their own password',
          text: 'New passwords need at least 10 characters and cannot be well-known ones.',
        },
    s.idle.length
      ? {
          level: 'warn',
          title: `${s.idle.length} account${s.idle.length === 1 ? '' : 's'} unused for 90 days`,
          text: `${list(s.idle)}. Disable accounts of people who left the lab (their work stays).`,
          action: ['Users', () => onTab('users')],
        }
      : { level: 'ok', title: 'No forgotten accounts', text: 'Everyone with an account used it in the last 90 days.' },
  ];
  const n = { ok: items.filter((i) => i.level === 'ok').length, all: items.length };
  return (
    <div className="sec">
      <p className="sec-sum">
        <b>
          {n.ok} of {n.all}
        </b>{' '}
        in order{n.ok < n.all ? '. The others, with what to do:' : '.'}
      </p>
      <ul className="sec-list">
        {[...items]
          .sort((a, b) => ['bad', 'warn', 'ok'].indexOf(a.level) - ['bad', 'warn', 'ok'].indexOf(b.level))
          .map((i) => (
            <li key={i.title} className={'sec-item ' + i.level}>
              <span
                className="sec-ic"
                aria-label={i.level === 'ok' ? 'in order' : i.level === 'warn' ? 'attention' : 'problem'}
              >
                {ICON[i.level]}
              </span>
              <div>
                <b>{i.title}</b>
                <p>{i.text}</p>
              </div>
              {i.action && i.level !== 'ok' && (
                <button className="link small" onClick={i.action[1]}>
                  {i.action[0]} ›
                </button>
              )}
            </li>
          ))}
      </ul>
      <p className="mut small">
        Always on: passwords stored only as salted scrypt hashes; sessions stored as hashes and ended on password
        change; sign-in paused after repeated failures; permissions checked on the server for every request; requests
        from other websites refused; strict browser security headers. Details for IT: <i>docs/security-and-data.md</i>.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ Activity log
type Row = {
  id: number;
  at: string;
  user_id: number | null;
  username: string;
  ip: string;
  action: string;
  target: string;
  status: number;
};
export function Activity() {
  const [rows, setRows] = useState<Row[]>([]),
    [more, setMore] = useState(false),
    [q, setQ] = useState(''),
    [refused, setRefused] = useState(false),
    [user, setUser] = useState('');
  const [users, setUsers] = useState<{ id: number; name: string }[]>([]),
    [ver, setVer] = useState<{ ok: boolean; rows: number; brokenAt?: { id: number } } | null>(null),
    [err, setErr] = useState('');
  const qs = (before?: number) =>
    new URLSearchParams({
      ...(q ? { q } : {}),
      ...(user ? { user } : {}),
      ...(refused ? { refused: '1' } : {}),
      ...(before ? { before: String(before) } : {}),
    }).toString();
  const load = (append = false) =>
    api<{ rows: Row[]; more: boolean }>('/audit?' + qs(append ? rows[rows.length - 1]?.id : undefined))
      .then((r) => {
        setRows(append ? [...rows, ...r.rows] : r.rows);
        setMore(r.more);
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    api<{ id: number; name: string }[]>('/users')
      .then(setUsers)
      .catch(() => {});
    api<typeof ver>('/audit/verify')
      .then(setVer)
      .catch(() => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, refused, user]);
  return (
    <div className="act">
      <p className="mut small">
        Every change in the app, every sign-in and every refused request: who, when, from which address. The content of
        a change is not stored (no passwords, no data). Kept for two years.
      </p>
      {ver && (
        <p className={'small ' + (ver.ok ? 'ok' : 'err')}>
          {ver.ok
            ? `✓ Log intact: ${ver.rows} entries, each linked to the one before, none edited or removed.`
            : `✕ The log was altered from entry ${ver.brokenAt?.id} on.`}
        </p>
      )}
      <div className="act-bar">
        <input
          type="search"
          placeholder="Search action, item, person or address"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Picker
          className="narrow"
          label="Person"
          value={String(user)}
          onChange={setUser}
          options={[{ value: '', label: 'Everyone' }, ...users.map((u) => ({ value: String(u.id), label: u.name }))]}
        />
        <label className="inline small">
          <input type="checkbox" checked={refused} onChange={(e) => setRefused(e.target.checked)} /> Refused only
        </label>
        <div className="grow" />
        <a className="btn secondary" href={'/api/audit/export?' + qs()} download>
          Export CSV
        </a>
      </div>
      {err && <p className="err">{err}</p>}
      <div className="scroll">
        <table className="list act-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Item</th>
              <th>From</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.status >= 400 ? 'refused' : ''}>
                <td className="mut">{when(r.at)}</td>
                <td>{r.username || '—'}</td>
                <td>
                  {r.status >= 400 && <Badge tone="warn">{r.status === 429 ? 'blocked' : 'refused'}</Badge>}{' '}
                  {r.action.replace(/^Refused: /, '')}
                </td>
                <td className="act-item">{r.target}</td>
                <td className="mut small">{r.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="mut">Nothing matches.</p>}
      {more && (
        <button className="link" onClick={() => load(true)}>
          Show older
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Licence (0.46; tiers, required file 0.49)
type Lic = {
  licence: {
    id: string;
    lab: string;
    acronym?: string;
    labId: string;
    modules: string[];
    issued: string;
    tier?: number;
    users?: number;
  } | null;
  labId: string | null;
  state: 'ok' | 'none' | 'invalid';
  critical: boolean;
  active: number;
  full: boolean;
  here: boolean;
  running: string[];
  skipped: string[];
  names: Record<string, string>;
};
const dmy = (d: string) => d.split('-').reverse().join('/');
/**
 * The lab's licence: who holds it, its modules, how many people it covers; and installing a new one, only on the computer that
 * runs PANOPTICA. Never locks anyone out: at its number of people, or without it on an install made by Setup, only letting new
 * people in is refused.
 */
export function Licence() {
  const [v, setV] = useState<Lic | null>(null),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Lic>('/licence')
      .then(setV)
      .catch((e) => setErr(e.message));
  }, []);
  const install = (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setErr('');
    f.text()
      .then((text) => api<Lic>('/licence', 'POST', { text }))
      .then(setV)
      .catch((e) => setErr(e.message.replace(/^./, (c: string) => c.toUpperCase()) + '.'))
      .finally(() => setBusy(false));
  };
  if (!v) return err ? <p className="err">{err}</p> : <p className="mut">Loading…</p>;
  const l = v.state === 'ok' ? v.licence : null,
    name = (id: string) => v.names[id] ?? id;
  const choose = v.here ? (
    <label className={'btn' + (l ? ' secondary' : '') + (busy ? ' disabled' : '')}>
      {busy ? 'Installing…' : l ? 'Install a new licence…' : 'Choose the licence file…'}
      <input
        type="file"
        accept=".json,application/json"
        hidden
        disabled={busy}
        onChange={(e) => {
          install(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </label>
  ) : (
    <p className="small">
      To {l ? 'install a new licence' : 'choose the licence file'}, open PANOPTICA on the computer that runs it.
    </p>
  );
  return (
    <div className="lic">
      <section className="group">
        {v.critical ? (
          <div className="lic-missing">
            <h4 className="err">
              {v.state === 'none' ? 'The licence file is missing' : 'The licence file is not valid'}
            </h4>
            <p>
              No one new can be let in until it is installed again. Everyone who has an account keeps working, with all
              their data.
            </p>
          </div>
        ) : !l ? (
          <p>No licence is installed. Every module in this package runs, with no limit on people.</p>
        ) : (
          <dl className="lic-list">
            <dt>Lab</dt>
            <dd>
              {l.lab}
              {l.acronym && <span className="mut"> ({l.acronym})</span>}
              <div className="mut small">The lab this licence was issued to.</div>
            </dd>
            <dt>Modules</dt>
            <dd>
              {l.modules.length ? l.modules.map(name).join(', ') : 'None (the core alone)'}
              {l.modules
                .filter((m) => !v.running.includes(m))
                .map((m) => (
                  <div key={m} className="err small">
                    {v.skipped.includes(m)
                      ? `${name(m)} starts when PANOPTICA restarts.`
                      : `${name(m)} is not in this package: install the package made for this licence.`}
                  </div>
                ))}
              {v.skipped
                .filter((m) => !l.modules.includes(m))
                .map((m) => (
                  <div key={m} className="mut small">
                    {name(m)} is in this package but not in the licence, so it does not start.
                  </div>
                ))}
            </dd>
            <dt>People</dt>
            <dd>
              {l.users ? (
                <>
                  {v.active} of {l.users}
                  {l.tier && <span className="mut"> · tier {l.tier}</span>}
                  {v.full ? (
                    <div className="warn-text small">
                      Your licence covers {l.users} {l.users === 1 ? 'person' : 'people'}. Contact PANOPTICA to upgrade.
                      Until then no one new can be let in; everyone else keeps working.
                    </div>
                  ) : (
                    <div className="mut small">
                      People with a working account. Requests waiting and ended visits do not count.
                    </div>
                  )}
                </>
              ) : (
                'No limit'
              )}
            </dd>
            <dt>Licence</dt>
            <dd className="mut">
              {l.id}, issued {dmy(l.issued)}
            </dd>
          </dl>
        )}
        {choose}
        {err && <p className="err small">{err}</p>}
        <p className="mut small">
          {l || v.critical
            ? 'Lost the licence file? Contact PANOPTICA for a copy.'
            : 'PANOPTICA gives each lab a licence file.'}{' '}
          A licence file is signed by PANOPTICA: one that was changed, or made for another lab, is refused. It is kept
          in the database, so a backup restored on another computer keeps it.
        </p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Updates
type Upd = {
  current: string;
  repo: string;
  tokenSet: boolean;
  defaultRepo?: string;
  available: boolean;
  /** an update script can be run by hand (not on an install made by PANOPTICA Setup, 0.49) */
  byHand?: boolean;
  canInstall: boolean;
  checkedAt?: string;
  error?: string;
  latest?: { version: string; name: string; notes: string; published: string; url: string; zip?: { size: number } };
  downloaded?: { version: string; file: string };
  log?: string;
  /** 0.52: the Node this install runs; on an install made by Setup an update may bring another (`carries`) */
  runtime?: {
    node: string;
    swaps: boolean;
    carries: { version: string; size: number } | null;
    ready: string | null;
    refused: { version: string; reason: string } | null;
    failed: { to: string; from: string; reason: string } | null;
  };
};
/** Megabytes, for downloads of more than a few hundred kilobytes. */
const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
export function Updates() {
  const [u, setU] = useState<Upd | null>(null),
    [busy, setBusy] = useState(''),
    [err, setErr] = useState(''),
    [token, setToken] = useState(''),
    [repo, setRepo] = useState<string | null>(null),
    [installing, setInstalling] = useState(false);
  const run = (label: string, p: Promise<Upd>) => {
    setBusy(label);
    setErr('');
    p.then(setU)
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(''));
  };
  useEffect(() => {
    api<Upd>('/updates')
      .then(setU)
      .catch((e) => setErr(e.message));
  }, []);
  const install = async () => {
    if (
      !u?.latest ||
      !window.confirm(
        `Install version ${u.latest.version} now?\n\nThe app backs up the database, stops for about a minute while the program files are replaced (the data is not touched), and starts again. Everyone using it will see it reconnect.${u.runtime?.ready ? `\n\nNode ${u.runtime.ready} replaces Node ${u.runtime.node}.` : ''}`,
      )
    )
      return;
    setInstalling(true);
    setErr('');
    try {
      await api('/updates/install', 'POST');
    } catch (e) {
      setErr((e as Error).message);
      setInstalling(false);
      return;
    }
    const want = u.latest.version,
      t0 = Date.now();
    const poll = setInterval(async () => {
      try {
        const v = await api<{ version: string }>('/version');
        if (v.version === want) {
          clearInterval(poll);
          location.reload();
        }
      } catch {
        /* restarting */
      }
      if (Date.now() - t0 > 10 * 60e3) {
        clearInterval(poll);
        setInstalling(false);
        setErr('The app did not come back within 10 minutes. Look at the update window on the lab computer.');
      }
    }, 3000);
  };
  if (!u) return err ? <p className="err">{err}</p> : <p className="mut">Loading…</p>;
  if (installing)
    return (
      <section className="group upd-wait">
        <b>Installing {u.latest?.version}…</b>
        <p className="mut">
          The app is backing up, updating and restarting. This page reloads by itself when it is back (usually within a
          minute or two; longer when Node changes).
        </p>
      </section>
    );
  const L = u.latest,
    R = u.runtime,
    // the Node the latest release brings (0.52), downloaded with it
    brings = u.available && R?.carries ? R.carries : null,
    total = (L?.zip?.size ?? 0) + (brings?.size ?? 0);
  return (
    <div className="upd">
      <section className="group">
        <div className="upd-head">
          <div>
            <span className="mut small">Installed</span>
            <b className="upd-v">{u.current}</b>
            {R && <span className="mut small upd-node">Node {R.node}</span>}
          </div>
          <span className="upd-arrow" aria-hidden>
            {u.available ? '→' : ''}
          </span>
          {u.available && L && (
            <div>
              <span className="mut small">Available</span>
              <b className="upd-v new">{L.version}</b>
              {brings && <span className="mut small upd-node">Node {brings.version}</span>}
            </div>
          )}
          <div className="grow" />
          <button
            className="btn secondary"
            disabled={!!busy}
            onClick={() => run('check', api<Upd>('/updates/check', 'POST'))}
          >
            {busy === 'check' ? 'Checking…' : 'Check now'}
          </button>
        </div>
        <p className="small mut">
          {u.error ? (
            <>
              <span className="err">Could not check: {u.error}.</span>{' '}
            </>
          ) : u.checkedAt ? (
            <>
              Checked {ago(u.checkedAt)}. {u.available ? '' : 'This is the latest version.'}
            </>
          ) : (
            'Not checked yet.'
          )}{' '}
          The app checks GitHub once a day and notifies admins when there is a new version.
        </p>
        {R?.failed && (
          <p className="warn-text small">
            The last update kept Node {R.node}:{' '}
            {R.failed.reason === 'start'
              ? `PANOPTICA did not start on Node ${R.failed.to}, so the old Node was put back.`
              : R.failed.reason === 'locked'
                ? `Node ${R.failed.to} could not replace it because its files were in use.`
                : `the Node ${R.failed.to} file was refused.`}{' '}
            PANOPTICA works as before. Contact PANOPTICA.
          </p>
        )}
        {u.available && L && (
          <>
            <h4 className="upd-h">
              {L.name} <span className="mut small">· {when(L.published)}</span>
            </h4>
            {L.notes && <div className="upd-notes">{L.notes}</div>}
            <div className="inline">
              {u.downloaded?.version === L.version ? (
                <>
                  <Badge tone="ac">Downloaded and checked</Badge>
                  {u.canInstall && (
                    <button className="btn" onClick={install}>
                      Install now
                    </button>
                  )}
                </>
              ) : (
                <button
                  className="btn"
                  disabled={!!busy || !L.zip}
                  onClick={() => run('download', api<Upd>('/updates/download', 'POST'))}
                >
                  {busy === 'download' ? 'Downloading…' : `Download${L.zip ? ` (${size(total)})` : ''}`}
                </button>
              )}
            </div>
            {brings && u.downloaded?.version !== L.version && (
              <p className="mut small">This update also brings Node {brings.version}.</p>
            )}
            {u.downloaded?.version === L.version && R?.ready && (
              <p className="mut small">
                Node {R.ready} is ready. It replaces Node {R.node} when you install; if PANOPTICA does not start on it,
                the update puts Node {R.node} back.
              </p>
            )}
            {u.downloaded?.version === L.version && R?.refused && (
              <p className="warn-text small">
                Node {R.refused.version} was not accepted: {R.refused.reason}. Installing updates PANOPTICA and keeps
                Node {R.node}. Contact PANOPTICA.
              </p>
            )}
            {u.downloaded?.version === L.version && u.byHand && (
              <p className="mut small">
                Or by hand: close the app window and run <b>update.bat</b> (Windows), <b>update.command</b> (Mac) or{' '}
                <b>./update.sh</b> (Linux); it finds the downloaded file in the <code>updates</code> folder.
              </p>
            )}
          </>
        )}
        {err && <p className="err small">{err}</p>}
      </section>
      {u.log && (
        <details className="upd-log">
          <summary>What the last update did</summary>
          <pre>{u.log}</pre>
        </details>
      )}
      <h3 className="sub">From the GitHub repository</h3>
      <section className="group">
        <label className="fld">
          <span>GitHub repository</span>
          <input value={repo ?? u.repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name" />
          {u.defaultRepo && u.repo !== u.defaultRepo && (
            <button type="button" className="link small" onClick={() => setRepo(u.defaultRepo!)}>
              Use PANOPTICA’s repository again
            </button>
          )}
        </label>
        <label className="fld">
          <span>
            Access token{' '}
            {u.tokenSet ? <Badge tone="ac">saved</Badge> : <span className="mut">(only for a private repository)</span>}
          </span>
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={u.tokenSet ? 'Saved. Paste a new one to replace it' : 'github_pat_…'}
          />
        </label>
        <div className="inline">
          <button
            className="btn"
            disabled={!!busy || (!token && repo === null)}
            onClick={() =>
              run(
                'save',
                api<Upd>('/updates/settings', 'PUT', {
                  ...(repo !== null ? { repo } : {}),
                  ...(token ? { token } : {}),
                }).then((x) => {
                  setToken('');
                  setRepo(null);
                  return x;
                }),
              )
            }
          >
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
          {u.tokenSet && (
            <button
              className="link danger-link"
              onClick={() =>
                window.confirm('Remove the saved token? Not needed while the repository is public.') &&
                run('save', api<Upd>('/updates/settings', 'PUT', { token: '' }))
              }
            >
              Remove token
            </button>
          )}
        </div>
        <details className="upd-how">
          <summary>How to make the token</summary>
          <p className="small">
            A public repository needs no token: leave this empty. Only if the repository is made private again, the app
            needs one to read it:
          </p>
          <ol className="small">
            <li>
              On GitHub, signed in as the repository owner: Settings › Developer settings › Personal access tokens ›{' '}
              <b>Fine-grained tokens</b> › Generate new token.
            </li>
            <li>Name it “PANOPTICA updates”, expiration one year.</li>
            <li>
              Repository access: <b>Only select repositories</b> › <code>{u.repo}</code>.
            </li>
            <li>
              Permissions › Repository permissions › <b>Contents: Read-only</b>. Nothing else.
            </li>
            <li>
              Generate, copy it, paste it here and Save. It is kept in <code>config/update.json</code> on this computer
              only (not in the database, backups or GitHub).
            </li>
          </ol>
          <p className="small mut">
            The token can only read this repository. When it expires, the check shows an error; make a new one the same
            way.
          </p>
        </details>
      </section>
    </div>
  );
}
