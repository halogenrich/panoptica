// The builder's page (0.50): the list of the licences issued, and the form that makes one. Staff only; served by ../ui.mjs on
// the computer it runs on. It is built from the app's own styles and components, so it reads as PANOPTICA.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Seg } from '@web/lib/ui';
import { Dialog } from '@web/views/common';
import '@web/styles.css';
import './builder.css';

type Licence = {
  id: string;
  labId: string;
  lab: string;
  acronym: string;
  modules: string[];
  tier: number | null;
  users: number | null;
  issued: string;
  /** it carries a setup code (the lab's first licence) */
  setup: boolean;
  /** its install sheet is in the folder */
  sheet: boolean;
};
type Lab = { labId: string; lab: string; acronym: string; licences: Licence[] };
type State = {
  version: string;
  folder: string | null;
  canBrowse: boolean;
  modules: { id: string; name: string }[];
  tiers: Record<string, number>;
  labs: Lab[];
};
type Made = State & { id: string; labId: string; code: string };

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => {
    throw new Error('The builder is not running. Start it again with npm run builder.');
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'That did not work.');
  return j as T;
}
const dmy = (d: string) => d.slice(0, 10).split('-').reverse().join('/');
const people = (l: Licence) => (l.users ? `Up to ${l.users} people` : 'No limit');

function App() {
  const [s, setS] = useState<State | null>(null),
    [err, setErr] = useState(''),
    [form, setForm] = useState<Lab | 'new' | null>(null),
    [moving, setMoving] = useState(false),
    [open, setOpen] = useState<string[]>([]),
    [q, setQ] = useState('');
  useEffect(() => {
    api<State>('/api/state')
      .then(setS)
      .catch((e) => setErr(e.message));
  }, []);
  if (!s)
    return (
      <Frame>
        <p className={err ? 'err' : 'mut'}>{err || 'Loading…'}</p>
      </Frame>
    );
  if (!s.folder)
    return (
      <Frame version={s.version}>
        <section className="group b-first">
          <h1>Where to keep the list of licences</h1>
          <p className="mut">
            Every licence and its install sheet are saved in this folder, so a lab that loses its file can get it again.
            It holds lab names: choose a folder outside the repository.
          </p>
          <FolderForm s={s} onDone={setS} />
        </section>
      </Frame>
    );
  const name = (id: string) => s.modules.find((m) => m.id === id)?.name ?? id;
  const needle = q.trim().toLowerCase(),
    shown = s.labs.filter((l) => !needle || (l.lab + ' ' + l.acronym).toLowerCase().includes(needle));
  const actions = (l: Licence, lab?: Lab) => (
    <div className="b-actions">
      <a className="link" href={`/api/licences/${l.id}/licence.json`} download="licence.json">
        Download licence
      </a>
      {l.sheet && (
        <a className="link" href={`/api/licences/${l.id}/sheet`} target="_blank" rel="noreferrer">
          Install sheet
        </a>
      )}
      {lab && (
        <button className="link" onClick={() => setForm(lab)}>
          New licence
        </button>
      )}
    </div>
  );
  return (
    <Frame version={s.version}>
      <div className="b-head">
        <h1>Licences</h1>
        {s.labs.length > 6 && (
          <input
            className="b-search"
            type="search"
            placeholder="Search labs"
            aria-label="Search labs"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        )}
        <button className="btn" onClick={() => setForm('new')}>
          New lab
        </button>
      </div>
      {!s.labs.length ? (
        <div className="empty">
          <h3>No licences yet</h3>
          <p>A new lab gets a licence file and an install sheet with its setup code.</p>
          <button className="btn" onClick={() => setForm('new')}>
            New lab
          </button>
        </div>
      ) : !shown.length ? (
        <p className="mut">No lab matches “{q.trim()}”.</p>
      ) : (
        <section className="group flush">
          <table className="list b-list">
            <thead>
              <tr>
                <th>Lab</th>
                <th>Modules</th>
                <th>People</th>
                <th>Licence</th>
                <th />
              </tr>
            </thead>
            {shown.map((lab) => {
              const [last, ...earlier] = lab.licences,
                isOpen = open.includes(lab.labId);
              return (
                <tbody key={lab.labId}>
                  <tr>
                    <td className="b-lab">
                      <strong>{lab.lab}</strong>
                      {lab.acronym && <div className="mut small">{lab.acronym}</div>}
                    </td>
                    <td data-th="Modules">{last.modules.map(name).join(', ')}</td>
                    <td data-th="People">
                      {people(last)}
                      {last.tier && <div className="mut small">Tier {last.tier}</div>}
                    </td>
                    <td data-th="Licence">
                      {dmy(last.issued)}
                      <div className="mut small">{last.id}</div>
                      {earlier.length > 0 && (
                        <button
                          className="link b-more"
                          aria-expanded={isOpen}
                          onClick={() => setOpen(isOpen ? open.filter((x) => x !== lab.labId) : [...open, lab.labId])}
                        >
                          {isOpen ? 'Hide' : 'Show'} {earlier.length} earlier
                        </button>
                      )}
                    </td>
                    <td>{actions(last, lab)}</td>
                  </tr>
                  {isOpen &&
                    earlier.map((l) => (
                      <tr key={l.id} className="b-earlier">
                        <td className="b-lab mut">{l.lab !== lab.lab ? l.lab : 'Earlier licence'}</td>
                        <td data-th="Modules">{l.modules.map(name).join(', ')}</td>
                        <td data-th="People">
                          {people(l)}
                          {l.tier && <div className="mut small">Tier {l.tier}</div>}
                        </td>
                        <td data-th="Licence">
                          {dmy(l.issued)}
                          <div className="mut small">{l.id}</div>
                        </td>
                        <td>{actions(l)}</td>
                      </tr>
                    ))}
                </tbody>
              );
            })}
          </table>
        </section>
      )}
      <p className="b-folder mut small">
        <span>Kept in {s.folder}</span>
        <button className="link" onClick={() => setMoving(true)}>
          Change folder
        </button>
      </p>
      {form && <LicenceForm s={s} lab={form === 'new' ? null : form} onState={setS} onClose={() => setForm(null)} />}
      {moving && (
        <Dialog title="Change folder" onClose={() => setMoving(false)}>
          <p className="mut b-tight">
            The list shows the licences in the folder you choose. Nothing is moved: to keep the same list, move the
            folder first, then choose it here.
          </p>
          <FolderForm
            s={s}
            onCancel={() => setMoving(false)}
            onDone={(n) => {
              setS(n);
              setMoving(false);
            }}
          />
        </Dialog>
      )}
    </Frame>
  );
}

function Frame({ version, children }: { version?: string; children: React.ReactNode }) {
  return (
    <>
      <header className="b-top">
        <span className="wordmark">
          <span className="wm-app">PANOPTICA</span>
          <span className="wm-dot">·</span>
          <span>Licence builder</span>
        </span>
        <span className="grow" />
        {version && <span className="mut small">{version}</span>}
      </header>
      <main className="b-main">{children}</main>
    </>
  );
}

/** The folder of the list: typed, or picked with the system's chooser where the builder can open one. */
function FolderForm({ s, onDone, onCancel }: { s: State; onDone: (s: State) => void; onCancel?: () => void }) {
  const [path, setPath] = useState(s.folder ?? ''),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  const browse = () => {
    setErr('');
    api<{ path: string }>('/api/folder/browse', 'POST', {})
      .then((r) => r.path && setPath(r.path))
      .catch((e) => setErr(e.message));
  };
  return (
    <form
      className="box-form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setErr('');
        api<State>('/api/folder', 'POST', { path })
          .then(onDone)
          .catch((x) => {
            setErr(x.message);
            setBusy(false);
          });
      }}
    >
      <label className="fld">
        <span>Folder</span>
        <span className="b-path">
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="Full path of the folder"
            spellCheck={false}
            autoFocus
          />
          {s.canBrowse && (
            <button type="button" className="btn secondary" onClick={browse}>
              Browse…
            </button>
          )}
        </span>
        {err && (
          <span className="field-err" role="alert">
            {err}
          </span>
        )}
      </label>
      <div className={onCancel ? 'dialog-actions' : 'b-go'}>
        {onCancel && (
          <button type="button" className="link" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn" disabled={busy || !path.trim()}>
          Use this folder
        </button>
      </div>
    </form>
  );
}

/**
 * A licence for a new lab, or a new one for a lab in the list (an upgrade, a module added): same lab id, no setup code. The
 * key file is chosen here every time; it is read for this licence and nothing about it is kept.
 */
function LicenceForm({
  s,
  lab,
  onState,
  onClose,
}: {
  s: State;
  lab: Lab | null;
  onState: (s: State) => void;
  onClose: () => void;
}) {
  const from = lab?.licences[0];
  const [name, setName] = useState(lab?.lab ?? ''),
    [acronym, setAcronym] = useState(lab?.acronym ?? ''),
    [mods, setMods] = useState<string[]>(
      from
        ? from.modules.filter((m) => s.modules.some((x) => x.id === m))
        : s.modules.length === 1
          ? [s.modules[0].id]
          : [],
    ),
    [tier, setTier] = useState(String(from?.tier ?? 1)),
    [users, setUsers] = useState(from?.tier === 3 ? String(from.users ?? '') : ''),
    [key, setKey] = useState<File | null>(null),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false),
    [made, setMade] = useState<Made | null>(null);
  if (made)
    return (
      <Dialog title="Licence made" onClose={onClose}>
        <p className="b-tight">
          {name} now has licence <span className="b-id">{made.id}</span>. It is kept in the list with its install sheet.
        </p>
        {made.code ? (
          <div className="b-code">
            <span className="mut small">Setup code</span>
            <code>{made.code}</code>
            <span className="mut small">
              Also on the install sheet. It works once, for the lab’s first setup from another computer.
            </span>
          </div>
        ) : (
          <p className="mut b-tight">
            No setup code: this lab is set up already. Its admin installs the file in Admin settings › Licence, on the
            server computer.
          </p>
        )}
        <div className="dialog-actions">
          <button className="link" onClick={onClose}>
            Done
          </button>
          <a className="btn secondary" href={`/api/licences/${made.id}/sheet`} target="_blank" rel="noreferrer">
            Install sheet
          </a>
          <a className="btn" href={`/api/licences/${made.id}/licence.json`} download="licence.json">
            Download licence
          </a>
        </div>
      </Dialog>
    );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key) return setErr('Choose the signing key file.');
    setBusy(true);
    setErr('');
    try {
      const m = await api<Made>('/api/licences', 'POST', {
        lab: name,
        acronym,
        modules: mods,
        tier: Number(tier),
        users: tier === '3' ? Number(users) : undefined,
        labId: lab?.labId,
        key: await key.text(),
      });
      onState(m);
      setMade(m);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };
  // what is wrong with the key is said at the key
  const keyErr = /\bkey\b/i.test(err);
  return (
    <Dialog title={lab ? `New licence for ${lab.acronym || lab.lab}` : 'New lab'} onClose={onClose} wide>
      <form className="box-form" onSubmit={submit}>
        {lab && (
          <p className="mut b-tight">
            For an upgrade or an added module. It replaces the lab’s licence and has no setup code. For a lost file, use
            Download licence instead.
          </p>
        )}
        <div className="b-names">
          <label className="fld">
            <span>Full name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus={!lab} />
          </label>
          <label className="fld">
            <span>Acronym (optional)</span>
            <input value={acronym} onChange={(e) => setAcronym(e.target.value)} maxLength={24} />
          </label>
        </div>
        <div className="fld">
          <span id="b-mods">Modules</span>
          <div className="chips" role="group" aria-labelledby="b-mods">
            {s.modules.map((m) => {
              const on = mods.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  className={'chip' + (on ? ' on' : '')}
                  aria-pressed={on}
                  onClick={() => setMods(on ? mods.filter((x) => x !== m.id) : [...mods, m.id])}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="fld">
          <span>People</span>
          <div className="b-tier">
            <Seg
              value={tier}
              on={setTier}
              opts={[
                ['1', `Up to ${s.tiers[1]}`],
                ['2', `Up to ${s.tiers[2]}`],
                ['3', `More than ${s.tiers[2]}`],
              ]}
            />
            {tier === '3' && (
              <input
                className="b-users"
                type="number"
                min={s.tiers[2] + 1}
                inputMode="numeric"
                placeholder="How many"
                aria-label="Number of people agreed with the lab"
                value={users}
                onChange={(e) => setUsers(e.target.value)}
              />
            )}
          </div>
          <span className="mut small">Tier {tier}: people with a working account at the same time.</span>
        </div>
        <div className="fld">
          <span>Signing key</span>
          <div className="b-key">
            <label className="btn secondary">
              {key ? 'Choose another file…' : 'Choose the key file…'}
              <input
                type="file"
                accept=".pem,.key,.txt"
                hidden
                onChange={(e) => {
                  setKey(e.target.files?.[0] ?? null);
                  setErr('');
                }}
              />
            </label>
            {key && <span className="b-keyname">{key.name}</span>}
          </div>
          {err && keyErr ? (
            <span className="field-err" role="alert">
              {err}
            </span>
          ) : (
            <span className="mut small">Read to sign this licence only. The key and its place are never saved.</span>
          )}
        </div>
        {err && !keyErr && (
          <p className="err b-tight" role="alert">
            {err}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="link" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={busy}>
            {busy ? 'Signing…' : 'Make licence'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
