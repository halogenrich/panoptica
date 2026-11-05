import { accessSync, constants, copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, db } from './db.js';

/**
 * Database backups. Files live in the app's `backups` folder (next to start.bat), named
 * data-YYYYMMDD-HHMMSS-<kind>.db. Kinds: auto (daily, by the server), manual (Back up now), update (update script),
 * before-restore (restore script). Files without a kind are older update-script backups.
 */
export const BACKUP_DIR = resolve(process.env.BACKUP_DIR || fileURLToPath(new URL('../../../backups', import.meta.url)));
export type Kind = 'auto' | 'manual' | 'update' | 'before-restore';
const KEEP: Record<Kind, number> = { auto: 14, manual: 30, update: 10, 'before-restore': 10 };
const NAME = /^data-(\d{8})-(\d{6})(?:-(auto|manual|update|before-restore))?\.db$/;
const DAY = 24 * 3600 * 1000;

export interface BackupFile { name: string; kind: Kind; size: number; created: string }

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export function listBackups(dir = BACKUP_DIR): BackupFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const m = NAME.exec(name);
    if (!m) return [];
    const st = statSync(join(dir, name));
    const [, d, t] = m, created = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4)}`;
    return [{ name, kind: (m[3] as Kind) ?? 'update', size: st.size, created }];
  }).sort((a, b) => b.created.localeCompare(a.created));
}

/** Removes the oldest files of each kind beyond its limit. */
function prune(dir = BACKUP_DIR) {
  const byKind = new Map<Kind, BackupFile[]>();
  for (const f of listBackups(dir)) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
  for (const [k, files] of byKind) files.slice(KEEP[k]).forEach((f) => { try { unlinkSync(join(dir, f.name)); } catch { /* in use or gone */ } });
}

// ---- second copy: every backup is also copied to a folder off this computer (network drive, synced cloud folder) ----
type Mirror = { dir: string; last?: { at: string; ok: boolean; msg: string } };
export const getMirror = (): Mirror => { const r = db.prepare("SELECT value FROM meta WHERE key='backup_mirror'").get() as { value: string } | undefined; return r ? JSON.parse(r.value) : { dir: '' }; };
const putMirror = (m: Mirror) => db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('backup_mirror',?)").run(JSON.stringify(m));
/** Checks that a folder exists and can be written to; returns an error message or ''. */
export function checkFolder(dir: string): string {
  if (!dir) return '';
  try { if (!statSync(dir).isDirectory()) return 'not a folder'; accessSync(dir, constants.W_OK); return ''; }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'the folder does not exist (or the drive is not connected)' : 'the folder cannot be written to'; }
}
export function setMirror(dir: string) { const m = { dir: dir.trim() }; putMirror(m); if (m.dir) syncMirror(); return getMirror(); }
/** Copies backups the second folder does not have yet (also those made by the update and restore scripts), then applies the same limits there. */
export function syncMirror() {
  const m = getMirror();
  if (!m.dir) return m;
  const err = checkFolder(m.dir);
  if (err) { putMirror({ ...m, last: { at: new Date().toISOString(), ok: false, msg: err } }); return getMirror(); }
  try {
    const have = new Set(listBackups(m.dir).map((f) => f.name)); let n = 0;
    for (const f of listBackups()) if (!have.has(f.name)) { copyFileSync(join(BACKUP_DIR, f.name), join(m.dir, f.name)); n++; }
    prune(m.dir);
    putMirror({ ...m, last: { at: new Date().toISOString(), ok: true, msg: n ? `${n} backup${n > 1 ? 's' : ''} copied` : 'up to date' } });
  } catch (e) { putMirror({ ...m, last: { at: new Date().toISOString(), ok: false, msg: (e as Error).message } }); }
  return getMirror();
}

/** Consistent copy of the live database (SQLite online backup; safe while the app is in use). */
export async function backupNow(kind: Kind = 'manual'): Promise<BackupFile> {
  mkdirSync(BACKUP_DIR, { recursive: true });
  let name = `data-${stamp()}-${kind}.db`;
  for (let i = 1; existsSync(join(BACKUP_DIR, name)); i++) name = `data-${stamp(new Date(Date.now() + i * 1000))}-${kind}.db`;
  db.prepare('VACUUM INTO ?').run(join(BACKUP_DIR, name)); // consistent, compact copy of the live database
  const copy = new DatabaseSync(join(BACKUP_DIR, name)); copy.exec('PRAGMA journal_mode = DELETE'); copy.close(); // one self-contained file
  prune();
  syncMirror();
  return listBackups().find((f) => f.name === name)!;
}

/** Daily automatic backup: one when the server starts if the last is older than a day, then checked every hour. */
export function scheduleBackups(log: (msg: string) => void) {
  const check = () => {
    const last = listBackups().find((f) => f.kind === 'auto');
    if (last && Date.now() - new Date(last.created).getTime() < DAY) { syncMirror(); return; } // also retries a copy that failed (drive offline)
    backupNow('auto').then((f) => log(`automatic backup: ${f.name}`)).catch((e) => log(`automatic backup failed: ${e.message}`));
  };
  setTimeout(check, 5000);
  setInterval(check, 3600 * 1000).unref();
}

export function backupStream(name: string) {
  if (!NAME.test(name) || !existsSync(join(BACKUP_DIR, name))) return null;
  return createReadStream(join(BACKUP_DIR, name));
}
