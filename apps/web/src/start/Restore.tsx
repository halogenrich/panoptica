import { useState } from 'react';
import { api } from '../api';
import { Seg } from '../lib/ui';
import { Wordmark } from './parts';

/** A backup as the server lists it: name, kind, size, when (local time, no zone) and whether it is encrypted. */
type BackupFile = { name: string; kind: string; size: number; created: string; enc?: boolean };
type RecoveryFile = { type: string; lab: string; labId: string; key: string };
type Chosen = { upload: true; name: string; size: number; enc: boolean } | { dir: string; file: BackupFile };

const STEPS = ['Backup', 'Backup key', 'Restored'];
const cap = (m: string) => m.replace(/^./, (c) => c.toUpperCase()) + (/[.!?]$/.test(m) ? '' : '.');
/** dd/mm/yyyy hh:mm of a backup's name time (the server computer's local time) */
const stamp = (c: string) => `${c.slice(8, 10)}/${c.slice(5, 7)}/${c.slice(0, 4)} ${c.slice(11, 16)}`;
const mb = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;

/**
 * Restore this lab from a backup, in the first setup (0.53): moving the lab to this computer, or replacing one that failed. A
 * backup file from this browser, or one of the backups in a folder the server computer reads (the second copy); for an
 * encrypted one, the recovery file or the backup key. From another computer every request carries the setup code.
 */
export default function Restore({ code, onBack, onDone }: { code?: string; onBack: () => void; onDone: () => void }) {
  const [step, setStep] = useState(0),
    [from, setFrom] = useState<'file' | 'folder'>('file'),
    [chosen, setChosen] = useState<Chosen | null>(null),
    [dir, setDir] = useState(''),
    [files, setFiles] = useState<BackupFile[] | null>(null),
    [how, setHow] = useState<'recovery' | 'typed'>('recovery'),
    [recovery, setRecovery] = useState<RecoveryFile | null>(null),
    [key, setKey] = useState(''),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(''),
    [done, setDone] = useState<{ users: number; lab: string; keyed: boolean } | null>(null);
  const headers: Record<string, string> = code ? { 'x-setup-code': code } : {};
  const enc = chosen ? ('upload' in chosen ? chosen.enc : !!chosen.file.enc) : false;

  /** The file is sent as soon as it is chosen, so a file that is not a backup is said at once. */
  const upload = async (f: File) => {
    setErr('');
    setChosen(null);
    setBusy('Reading the file…');
    try {
      const r = await fetch('/api/setup/restore/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', ...headers },
        body: f,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'the file could not be sent');
      setChosen({ upload: true, name: f.name, size: j.size, enc: j.enc });
    } catch (e) {
      setErr(cap((e as Error).message));
    } finally {
      setBusy('');
    }
  };
  const list = () => {
    setErr('');
    setFiles(null);
    setChosen(null);
    setBusy('Looking…');
    api<{ files: BackupFile[] }>('/setup/restore/folder', 'POST', { dir, ...(code ? { code } : {}) })
      .then((r) => {
        setFiles(r.files);
        setChosen({ dir, file: r.files[0] });
      })
      .catch((e) => setErr(cap(e.message)))
      .finally(() => setBusy(''));
  };
  const readRecovery = async (f: File) => {
    setErr('');
    setRecovery(null);
    try {
      const j = JSON.parse(await f.text());
      if (j?.type !== 'PANOPTICA recovery file' || typeof j.key !== 'string') throw new Error();
      setRecovery(j);
    } catch {
      setErr('This is not a PANOPTICA recovery file. It is the .json file downloaded from Admin settings › Backups.');
    }
  };
  const restore = () => {
    if (!chosen) return;
    setErr('');
    setBusy('Restoring…');
    const src = 'upload' in chosen ? { upload: true, name: chosen.name } : { dir: chosen.dir, name: chosen.file.name };
    const k = enc ? (how === 'recovery' ? { recovery } : { key: key.replace(/\s/g, '') }) : {};
    api<{ users: number; lab: string }>('/setup/restore', 'POST', { ...src, ...k, ...(code ? { code } : {}) })
      .then((r) => {
        setDone({ ...r, keyed: enc });
        setStep(2);
      })
      .catch((e) => setErr(cap(e.message)))
      .finally(() => setBusy(''));
  };
  const keyOk = how === 'recovery' ? !!recovery : /^[0-9a-f]{64}$/i.test(key.replace(/\s/g, ''));
  const shownSteps = enc || step === 2 ? STEPS : [STEPS[0], STEPS[2]],
    at = step === 2 ? shownSteps.length - 1 : step;

  return (
    <main className="setup">
      <aside className="setup-rail">
        <Wordmark lab={done?.lab || undefined} />
        <ol className="setup-steps">
          {shownSteps.map((s, i) => (
            <li key={s} className={i === at ? 'on' : i < at ? 'done' : ''} aria-current={i === at ? 'step' : undefined}>
              <span className="setup-n">{i < at ? '✓' : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </aside>
      <section className="setup-main">
        <div className="setup-page">
          {step === 0 && (
            <>
              <h1>Restore from a backup</h1>
              <p className="mut">
                The lab comes back as it was in the backup: accounts, data, settings and licence. Everyone signs in as
                before.
              </p>
              <Seg
                value={from}
                opts={[
                  ['file', 'A backup file'],
                  ['folder', 'A folder of backups'],
                ]}
                on={(v) => {
                  setFrom(v);
                  setChosen(null);
                  setFiles(null);
                  setErr('');
                }}
              />
              {from === 'file' ? (
                <>
                  <p className="mut small">
                    A file from the old computer’s <code>backups</code> folder (<code>.db</code>) or from the second
                    copy (<code>.db.enc</code>).
                  </p>
                  <div className="inline">
                    <label className="btn secondary">
                      Choose a backup file
                      <input
                        type="file"
                        accept=".db,.enc"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (f) upload(f);
                        }}
                      />
                    </label>
                    {chosen && 'upload' in chosen && (
                      <span>
                        {chosen.name} <span className="mut">· {mb(chosen.size)}</span>
                        {chosen.enc && <span className="mut"> · encrypted</span>}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="mut small">
                    A folder the computer that runs PANOPTICA can open, such as the second copy on the network drive:
                    for example <code>Z:\PANOPTICA</code>.
                  </p>
                  <form
                    className="inline"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (dir.trim()) list();
                    }}
                  >
                    <input
                      style={{ flex: 1, minWidth: 220 }}
                      aria-label="Folder"
                      placeholder="Folder"
                      value={dir}
                      onChange={(e) => setDir(e.target.value)}
                    />
                    <button className="btn secondary" disabled={!dir.trim() || !!busy}>
                      List backups
                    </button>
                  </form>
                  {files && (
                    <div className="scroll restore-list">
                      <table className="list">
                        <thead>
                          <tr>
                            <th />
                            <th>Date</th>
                            <th>Size</th>
                          </tr>
                        </thead>
                        <tbody>
                          {files.map((f) => {
                            const on = !!chosen && !('upload' in chosen) && chosen.file.name === f.name;
                            return (
                              <tr key={f.name} className={on ? 'on' : ''} onClick={() => setChosen({ dir, file: f })}>
                                <td>
                                  <input
                                    type="radio"
                                    name="backup"
                                    aria-label={stamp(f.created)}
                                    checked={on}
                                    onChange={() => setChosen({ dir, file: f })}
                                  />
                                </td>
                                <td className="num">{stamp(f.created)}</td>
                                <td className="num">
                                  {mb(f.size)}
                                  {f.enc && <span className="mut">, encrypted</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
              {busy && <p className="mut small">{busy}</p>}
              {err && <p className="err">{err}</p>}
            </>
          )}
          {step === 1 && (
            <>
              <h1>Backup key</h1>
              <p className="mut">
                This backup is encrypted. Give the recovery file an admin downloaded from Admin settings › Backups, or
                type the backup key.
              </p>
              <Seg
                value={how}
                opts={[
                  ['recovery', 'Recovery file'],
                  ['typed', 'Type the key'],
                ]}
                on={(v) => {
                  setHow(v);
                  setErr('');
                }}
              />
              {how === 'recovery' ? (
                <div className="inline">
                  <label className="btn secondary">
                    Choose the recovery file
                    <input
                      type="file"
                      accept=".json,application/json"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) readRecovery(f);
                      }}
                    />
                  </label>
                  {recovery && <span>Recovery file of {recovery.lab || 'the lab'}</span>}
                </div>
              ) : (
                <label className="fld">
                  <span>Backup key</span>
                  <input
                    className="key-input"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="64 characters, 0–9 and a–f"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                  />
                </label>
              )}
              {busy && <p className="mut small">{busy}</p>}
              {err && <p className="err">{err}</p>}
            </>
          )}
          {step === 2 && done && (
            <>
              <h1>Lab restored</h1>
              <p className="setup-lead">
                {done.lab || 'The lab'} is back, with {done.users} {done.users === 1 ? 'account' : 'accounts'}. Everyone
                signs in with the same username and password as before.
              </p>
              <p className="mut">
                {done.keyed
                  ? 'This computer now encrypts the backups with the same key: keep the same recovery file.'
                  : 'This computer encrypts its backups with a new key. The first admin to sign in downloads the new recovery file.'}{' '}
                The network settings stay this computer’s: check them in Admin settings › Network.
              </p>
            </>
          )}
        </div>
        <footer className="setup-foot">
          {step < 2 && (
            <button
              type="button"
              className="link"
              onClick={() => (step === 0 ? onBack() : (setStep(0), setErr('')))}
              disabled={!!busy}
            >
              Back
            </button>
          )}
          <div className="grow" />
          {step === 0 && enc && (
            <button type="button" className="btn" disabled={!chosen || !!busy} onClick={() => setStep(1)}>
              Continue
            </button>
          )}
          {((step === 0 && !enc) || step === 1) && (
            <button
              type="button"
              className="btn"
              disabled={!chosen || !!busy || (step === 1 && !keyOk)}
              onClick={restore}
            >
              {busy === 'Restoring…' ? 'Restoring…' : 'Restore the lab'}
            </button>
          )}
          {step === 2 && (
            <button type="button" className="btn" onClick={onDone}>
              Go to sign-in
            </button>
          )}
        </footer>
      </section>
    </main>
  );
}
