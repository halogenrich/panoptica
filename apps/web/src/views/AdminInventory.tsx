import { useEffect, useState } from 'react';
import { api } from '../api';
import { Seg, fmtDateTime } from '../lib/ui';
import { Dialog } from './common';

/**
 * Admin settings › Inventory (0.54.2): purge the inventory (everything, or what was added in the last 7 days) and undo one
 * import, for when a wrong file was imported. The server backs up first and removes nothing if that fails; nothing goes
 * through the trash. Counts are shown before anything is removed, and the confirmation names them.
 */
type Counts = { containers: number; substances: number; places: number; divisions: number; changed: number };
type Imp = {
  id: number;
  at: string;
  username: string;
  file: string;
  containers: number;
  substances: number;
  undone_at: string | null;
  undone_how: string | null;
  left: Counts | null;
};
type D = { all: Counts; week: Counts; imports: Imp[] };

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
/** "142 containers, 38 substances and 2 storage places" */
export function what(c: Counts) {
  const parts = [
    c.containers ? n(c.containers, 'container', 'containers') : '',
    c.substances ? n(c.substances, 'substance', 'substances') : '',
    c.places ? n(c.places, 'storage place', 'storage places') : '',
    c.divisions ? n(c.divisions, 'division', 'divisions') : '',
  ].filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1) : (parts[0] ?? '');
}
const empty = (c: Counts) => !c.containers && !c.substances && !c.places && !c.divisions;

export default function AdminInventory() {
  const [d, setD] = useState<D | null>(null),
    [scope, setScope] = useState<'week' | 'all'>('week'),
    [ask, setAsk] = useState<{ title: string; c: Counts; go: () => Promise<unknown>; imp?: Imp } | null>(null),
    [busy, setBusy] = useState(false),
    [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () =>
    api<D>('/inventory/purge')
      .then(setD)
      .catch((e) => setMsg({ ok: false, text: e.message }));
  useEffect(() => {
    load();
  }, []);
  const run = (go: () => Promise<unknown>) => {
    setBusy(true);
    go()
      .then((r: any) => setMsg({ ok: true, text: `Removed ${what(r)}. The backup made first is ${r.backup}.` }))
      .catch((e) => setMsg({ ok: false, text: e.message }))
      .finally(() => {
        setBusy(false);
        setAsk(null);
        load();
      });
  };
  const c = d?.[scope];
  return (
    <div>
      <h3 className="sub">Purge the inventory</h3>
      <section className="group">
        <p className="small">
          For a wrong import or a fresh start. Removed items do not go to the trash. PANOPTICA backs up the lab first,
          and the backup is listed under Backups as “Before purge”.
        </p>
        <div className="inline">
          <Seg
            value={scope}
            on={setScope}
            opts={[
              ['week', 'Added in the last 7 days'],
              ['all', 'Everything'],
            ]}
          />
        </div>
        <p className="mut small">
          {scope === 'week'
            ? 'Containers added in the last 7 days, typed in or imported, and substances first added in that time that have no older containers. Older items stay, even if they were edited.'
            : 'Every container and substance, also those in the trash. Storage places and divisions stay. Past batches keep what they recorded, and recipes show removed substances as not in the inventory.'}
        </p>
        <div className="inline" style={{ justifyContent: 'space-between' }}>
          <span data-purge-count>
            {!c ? (
              <span className="mut">Counting…</span>
            ) : empty(c) ? (
              <span className="mut">
                {scope === 'week' ? 'Nothing was added in the last 7 days.' : 'The inventory is empty.'}
              </span>
            ) : (
              <>
                Removes <b>{what(c)}</b>
              </>
            )}
          </span>
          {/* a rare, dangerous action: plain at rest, red only in the confirmation */}
          <button
            className="btn secondary"
            disabled={!c || empty(c) || busy}
            onClick={() =>
              c &&
              setAsk({
                title: scope === 'week' ? 'Purge what was added in the last 7 days?' : 'Purge the whole inventory?',
                c,
                go: () => api('/inventory/purge', 'POST', { scope }),
              })
            }
          >
            Purge…
          </button>
        </div>
        {msg && <p className={'small ' + (msg.ok ? 'ok' : 'err')}>{msg.text}</p>}
      </section>
      <h3 className="sub">Imports</h3>
      <section className="group">
        {!d ? null : !d.imports.length ? (
          <p className="mut small">No imports yet.</p>
        ) : (
          <div className="scroll">
            <table className="list imports">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>File</th>
                  <th>By</th>
                  <th className="num">Containers</th>
                  <th className="num">New substances</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.imports.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDateTime(r.at)}</td>
                    <td className="imp-file" title={r.file}>
                      {r.file || <span className="mut">Unnamed file</span>}
                    </td>
                    <td>{r.username}</td>
                    <td className="num">{r.containers}</td>
                    <td className="num">{r.substances}</td>
                    <td>
                      {r.undone_at ? (
                        <span className="mut small">
                          {r.undone_how === 'undo' ? 'Undone' : 'Purged'} {fmtDateTime(r.undone_at)}
                        </span>
                      ) : r.left && !empty(r.left) ? (
                        <button
                          className="link"
                          disabled={busy}
                          onClick={() =>
                            setAsk({
                              title: 'Undo this import?',
                              c: r.left!,
                              imp: r,
                              go: () => api(`/inventory/imports/${r.id}/undo`, 'POST'),
                            })
                          }
                        >
                          Undo
                        </button>
                      ) : (
                        <span className="mut small">Nothing left</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mut small">
          Undo removes what the import added: its containers, and the substances, storage places and divisions it
          created that nothing else uses. Imports made before version 0.54.2 are not listed; use “Added in the last 7
          days” for those.
        </p>
      </section>
      {ask && (
        <Dialog title={ask.title} onClose={() => !busy && setAsk(null)}>
          <div className="stack-form-sm">
            <p>
              This removes <b>{what(ask.c)}</b>
              {ask.imp ? (
                <>
                  {' '}
                  added by {ask.imp.file || 'the import'} on {fmtDateTime(ask.imp.at)}
                </>
              ) : null}
              .
            </p>
            {ask.c.changed > 0 && (
              <p className="warn-text small">
                {n(ask.c.changed, 'container was', 'containers were')} edited after the import and will be removed too.
              </p>
            )}
            <p className="mut small">
              It cannot be undone here. A backup is made first (Backups › Before purge); if it fails, nothing is
              removed.
            </p>
            <div className="dialog-actions">
              <button className="btn secondary" disabled={busy} onClick={() => setAsk(null)}>
                Cancel
              </button>
              <button className="btn danger" disabled={busy} onClick={() => run(ask.go)}>
                {busy ? 'Backing up and removing…' : `Remove ${n(ask.c.containers, 'container', 'containers')}`}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
