import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { DatabaseSync, db } from './db.js';
import { BACKUP_DIR, checkBackup, decrypt, listBackups } from './backup.js';
import { CONFIG_DIR, hasConfig, writeConfig } from './config.js';
import { MIGRATIONS, migrate } from './schema.js';
import { allMigrations } from './modules.js';
import { audit, ipOf } from './audit.js';
import { licence } from './licence.js';

/**
 * Restore this lab from a backup, in the first setup (0.53): moving to another computer (the lab PC to a mini PC) or replacing
 * one that failed. The backup is a file the browser sends, or one of the backups in a folder this computer can read (the second
 * copy on the university's storage server). An encrypted copy needs the backup key, typed or read from the recovery file.
 *
 * How the data comes back without restarting PANOPTICA: the backup is copied aside, brought to this version's database changes
 * (the same lists that run at start), then every table of the live database is emptied and filled from it in one transaction.
 * What belongs to this computer and not to the lab stays: the update state, the certificate notices, the network (a file in
 * config/). The licence kept is the newer of the two; a backup of another lab than this install's licence is refused.
 */

/** The recovery file (0.53): the backup key and the lab's id, downloaded in Admin settings › Backups. */
export type RecoveryFile = {
  type: 'PANOPTICA recovery file';
  v: 1;
  lab: string;
  labId: string;
  key: string;
  made: string;
};

const UPLOAD = () => join(BACKUP_DIR, 'restore-upload.tmp');
const WORK = () => join(BACKUP_DIR, 'restore-work.tmp');
/** meta keys of this computer, not of the lab: they stay as they are here */
const OWN_META = new Set(['update_state', 'cert_warned', 'backup_check']);
const KEY = /^[0-9a-f]{64}$/;

const metaOf = (c: InstanceType<typeof DatabaseSync>, k: string) =>
  (c.prepare('SELECT value FROM meta WHERE key=?').get(k) as { value: string } | undefined)?.value;

/** The lab's id in a database: the one its first licence gave. */
const labIdOf = (c: InstanceType<typeof DatabaseSync>) => metaOf(c, 'lab_id') ?? '';

export class RestoreError extends Error {
  constructor(
    msg: string,
    public code = 400,
  ) {
    super(msg);
  }
}

/** Reads the backup to restore and leaves it, decrypted, as the work file. */
function prepare(src: string, key: string) {
  let buf: Buffer;
  try {
    buf = readFileSync(src);
  } catch {
    throw new RestoreError('the backup file cannot be read');
  }
  if (buf.subarray(0, 4).toString('latin1') === 'PLB1') {
    if (!key) throw new RestoreError('this backup is encrypted: give the recovery file or type the backup key');
    if (!KEY.test(key)) throw new RestoreError('a backup key is 64 characters, 0–9 and a–f');
    try {
      buf = decrypt(buf, key);
    } catch {
      throw new RestoreError('the backup key does not open this backup (another lab’s key, or the file was changed)');
    }
  } else if (buf.subarray(0, 16).toString('latin1') !== 'SQLite format 3\0')
    throw new RestoreError('this file is not a PANOPTICA backup');
  rmSync(WORK(), { force: true });
  writeFileSync(WORK(), buf);
  const chk = checkBackup(WORK());
  if (!chk.ok) {
    rmSync(WORK(), { force: true });
    throw new RestoreError(`this backup is damaged (${chk.msg})`);
  }
  return chk.msg;
}

/** Brings the work file to this version's database; refuses a backup from a newer PANOPTICA. */
function upgrade(c: InstanceType<typeof DatabaseSync>) {
  const lists = [MIGRATIONS, ...allMigrations()];
  const known = new Map<number, string>();
  for (const l of lists) for (const m of l) known.set(m.id, m.owner);
  const owners = new Set(known.values());
  const has = !!c.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='migrations'").get();
  if (has)
    for (const r of c.prepare('SELECT id,owner FROM migrations').all() as { id: number; owner: string }[])
      if (owners.has(r.owner) && !known.has(r.id))
        throw new RestoreError(
          'this backup was made by a newer PANOPTICA: update this install first, then restore',
          409,
        );
  c.exec('PRAGMA foreign_keys = ON');
  for (const l of lists) migrate(c, l);
}

/** Restores the work file into the live database. Returns what came back. */
function apply(): { users: number; labId: string } {
  const live = { licence: metaOf(db, 'licence'), labId: labIdOf(db) };
  const c = new DatabaseSync(WORK());
  try {
    const theirs = labIdOf(c);
    if (live.labId && theirs && theirs !== live.labId)
      throw new RestoreError(
        `this backup is of another lab than the one this install is licensed to${licence() ? ` (${licence()!.lab})` : ''}`,
        409,
      );
    upgrade(c);
  } finally {
    c.close();
  }
  const tables = (d: InstanceType<typeof DatabaseSync>, schema = 'main') =>
    d
      .prepare(
        `SELECT name,sql FROM ${schema}.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as { name: string; sql: string }[];
  const cols = (t: string, schema: string) =>
    (db.prepare(`PRAGMA ${schema}.table_info("${t}")`).all() as { name: string }[]).map((r) => r.name);
  db.exec('PRAGMA foreign_keys = OFF'); // outside the transaction: SQLite ignores it inside one
  db.prepare('ATTACH DATABASE ? AS bk').run(WORK());
  try {
    db.exec('BEGIN');
    try {
      const mine = new Set(tables(db).map((t) => t.name));
      const keep = (db.prepare('SELECT key,value FROM meta').all() as { key: string; value: string }[]).filter((r) =>
        OWN_META.has(r.key),
      );
      for (const t of tables(db, 'bk')) {
        // a table this install does not have (a module it does not carry): it comes back as it was
        if (!mine.has(t.name)) db.exec(t.sql);
        const both = cols(t.name, 'main').filter((x) => cols(t.name, 'bk').includes(x));
        const list = both.map((x) => `"${x}"`).join(',');
        db.exec(`DELETE FROM main."${t.name}"`);
        db.exec(`INSERT INTO main."${t.name}"(${list}) SELECT ${list} FROM bk."${t.name}"`);
      }
      for (const t of mine) if (!tables(db, 'bk').some((x) => x.name === t)) db.exec(`DELETE FROM main."${t}"`);
      if (db.prepare("SELECT 1 FROM bk.sqlite_master WHERE name='sqlite_sequence'").get()) {
        db.exec('DELETE FROM main.sqlite_sequence');
        db.exec('INSERT INTO main.sqlite_sequence(name,seq) SELECT name,seq FROM bk.sqlite_sequence');
      }
      const put = db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)');
      for (const r of keep) put.run(r.key, r.value);
      for (const k of OWN_META) if (!keep.some((r) => r.key === k)) db.prepare('DELETE FROM meta WHERE key=?').run(k);
      // sessions of the old computer do not sign anyone in here
      db.exec('DELETE FROM sessions');
      if (live.labId && !metaOf(db, 'lab_id')) put.run('lab_id', live.labId);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    db.exec('DETACH DATABASE bk');
    db.exec('PRAGMA foreign_keys = ON');
  }
  const bad = db.prepare('PRAGMA foreign_key_check').all();
  if (bad.length) throw new RestoreError(`the restored data has ${bad.length} broken links`, 500);
  // the licence this install came with stays when it is newer than the backup's (an upgrade bought since)
  if (live.licence) {
    const back = licence(),
      mine = JSON.parse(JSON.parse(live.licence).body) as { id: string; made?: string; issued: string };
    if (!back || (back.id !== mine.id && (mine.made && back.made ? mine.made > back.made : mine.issued > back.issued)))
      db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('licence',?)").run(live.licence);
  }
  const users = (db.prepare('SELECT COUNT(*) AS n FROM users WHERE deleted=0').get() as { n: number }).n;
  return { users, labId: labIdOf(db) };
}

/**
 * The whole restore. `key` is the backup key (typed, or from the recovery file); with it, it becomes this computer's key, so the
 * second copies keep opening with the same recovery file. Without one (a backup that was not encrypted) this computer keeps its
 * own key, and the admins are asked for the new recovery file at their next sign-in.
 */
export function restoreFrom(src: string, key: string, by: { ip: string; name: string }) {
  key = key.replace(/\s/g, '').toLowerCase(); // pasted or typed in groups
  const check = prepare(src, key);
  try {
    const r = apply();
    if (key) {
      if (hasConfig('backup.key')) copyFileSync(join(CONFIG_DIR, 'backup.key'), join(CONFIG_DIR, 'backup.key.before'));
      writeConfig('backup.key', key);
      db.prepare("DELETE FROM meta WHERE key='recovery_pending'").run();
    } else {
      // the old recovery file does not open this computer's copies: a new one must be downloaded before it is confirmed
      db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('recovery_pending','1')").run();
      db.prepare("DELETE FROM meta WHERE key='recovery_downloaded'").run();
    }
    audit({ ip: by.ip, action: 'Restored this lab from a backup', target: `${by.name} (${check})` });
    return r;
  } finally {
    rmSync(WORK(), { force: true });
    rmSync(UPLOAD(), { force: true });
  }
}

/** The recovery file for this lab. */
export function recoveryFile(key: string, shown: string): RecoveryFile {
  return {
    type: 'PANOPTICA recovery file',
    v: 1,
    lab: shown,
    labId: metaOf(db, 'lab_id') ?? '',
    key,
    made: new Date().toISOString(),
  };
}

/** Routes of the first setup's restore. `gate` says why this request may not restore ('' when it may). */
export function registerRestore(
  app: FastifyInstance,
  gate: (req: any, code: string) => { code: number; error: string } | null,
  shown: () => string,
) {
  const pass = (req: any, reply: any) => {
    const g = gate(req, String(req.headers['x-setup-code'] ?? req.body?.code ?? ''));
    if (g) reply.code(g.code).send({ error: g.error });
    return !g;
  };
  // the file itself, as the browser read it (any size a lab's database reaches)
  app.register(async (s) => {
    s.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 2 * 1024 ** 3 }, (_r, b, done) =>
      done(null, b),
    );
    s.post('/api/setup/restore/upload', async (req: any, reply) => {
      if (!pass(req, reply)) return;
      const b = req.body as Buffer;
      if (!Buffer.isBuffer(b) || b.length < 32) return reply.code(400).send({ error: 'choose a backup file' });
      const head = b.subarray(0, 16).toString('latin1');
      const enc = head.startsWith('PLB1');
      if (!enc && head !== 'SQLite format 3\0')
        return reply.code(400).send({ error: 'this file is not a PANOPTICA backup' });
      mkdirSync(BACKUP_DIR, { recursive: true });
      writeFileSync(UPLOAD(), b);
      return { size: b.length, enc };
    });
  });
  /** The backups in a folder this computer can read (the second copy), newest first. */
  app.post('/api/setup/restore/folder', async (req: any, reply) => {
    if (!pass(req, reply)) return;
    const dir = String(req.body?.dir ?? '').trim();
    if (!dir) return reply.code(400).send({ error: 'give the folder' });
    if (!existsSync(dir))
      return reply.code(400).send({ error: `${dir}: the folder does not exist (or the drive is not connected)` });
    const files = listBackups(dir);
    if (!files.length) return reply.code(404).send({ error: `${dir} holds no PANOPTICA backups` });
    return { files };
  });
  app.post('/api/setup/restore', async (req: any, reply) => {
    if (!pass(req, reply)) return;
    const b = req.body ?? {};
    let src: string, name: string;
    if (b.upload) {
      src = UPLOAD();
      name = String(b.name ?? 'uploaded file').slice(0, 200);
      if (!existsSync(src)) return reply.code(400).send({ error: 'choose the backup file again' });
    } else {
      const dir = String(b.dir ?? '').trim();
      name = String(b.name ?? '');
      // only a backup the folder's list showed: no path from the request is read as it is
      if (!dir || !listBackups(dir).some((f) => f.name === name))
        return reply.code(400).send({ error: 'choose one of the backups in the folder' });
      src = join(dir, name);
    }
    let key = String(b.key ?? '');
    if (b.recovery) {
      const rf = b.recovery as Partial<RecoveryFile>;
      if (rf?.type !== 'PANOPTICA recovery file' || typeof rf.key !== 'string')
        return reply.code(400).send({ error: 'this is not a PANOPTICA recovery file' });
      key = rf.key;
    }
    try {
      return { ...restoreFrom(src, key, { ip: ipOf(req), name }), lab: shown() };
    } catch (e) {
      const code = e instanceof RestoreError ? e.code : 500;
      return reply.code(code).send({ error: (e as Error).message });
    }
  });
}
