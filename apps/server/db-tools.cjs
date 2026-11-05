// Database backup and restore for the start/update/restore scripts. Run from the apps/server folder, app stopped.
//   node db-tools.cjs backup <kind>     kind: update | before-restore | manual
//   node db-tools.cjs restore [file]    lists the backups and asks which one, unless a file name is given
//   node db-tools.cjs decrypt <file.db.enc> [key]
//                                       turns an encrypted second copy back into a backup in the backups folder (then use restore);
//                                       the key is read from config/backup.key on this computer, or given (Admin settings › Backups › Show key)
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const emit = process.emitWarning.bind(process); // node:sqlite is "experimental" on Node 22; keep the output clean
process.emitWarning = (w, ...a) => (String((w && w.message) || w).includes('SQLite') ? undefined : emit(w, ...a));
const { DatabaseSync } = require('node:sqlite');

const DB = path.resolve(process.env.DB_PATH || 'data.db');
const DIR = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups'));
const NAME = /^data-(\d{8})-(\d{6})(?:-(auto|manual|update|before-restore))?\.db$/;

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const list = () =>
  (fs.existsSync(DIR) ? fs.readdirSync(DIR) : [])
    .filter((n) => NAME.test(n))
    .sort((a, b) => b.slice(5, 20).localeCompare(a.slice(5, 20)));
const label = (n) => {
  const m = NAME.exec(n),
    d = m[1],
    t = m[2];
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)} ${t.slice(0, 2)}:${t.slice(2, 4)}  ${(m[3] || 'update').padEnd(14)} ${(fs.statSync(path.join(DIR, n)).size / 1024).toFixed(0).padStart(7)} KB`;
};

async function backup(kind) {
  if (!fs.existsSync(DB)) {
    console.log('No database yet, nothing to back up.');
    return null;
  }
  fs.mkdirSync(DIR, { recursive: true });
  let name = `data-${stamp()}-${kind}.db`;
  for (let i = 1; fs.existsSync(path.join(DIR, name)); i++)
    name = `data-${stamp(new Date(Date.now() + i * 1000))}-${kind}.db`;
  const db = new DatabaseSync(DB, { readOnly: true });
  db.prepare('VACUUM INTO ?').run(path.join(DIR, name)); // consistent copy, includes changes still in the WAL file
  db.close();
  single(path.join(DIR, name));
  console.log(`Database backed up: backups/${name}`);
  return name;
}

/** Backups are kept as one self-contained file (no -wal/-shm companions). */
function single(file) {
  if (!fs.existsSync(file)) throw new Error('missing');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = DELETE');
  db.close();
}

function check(file) {
  try {
    single(file);
  } catch {
    return null;
  }
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const ok = Object.values(db.prepare('PRAGMA quick_check').get() || {})[0] === 'ok';
    const users = db.prepare('SELECT COUNT(*) n FROM users').get().n,
      presets = db.prepare('SELECT COUNT(*) n FROM presets').get().n;
    return ok ? { users, presets } : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

// one reader for the whole session, so answers typed ahead (or piped) are not lost between questions
let lines = null;
const ask = async (q) => {
  if (!lines) lines = readline.createInterface({ input: process.stdin, terminal: false })[Symbol.asyncIterator]();
  process.stdout.write(q);
  const r = await lines.next();
  if (process.stdin.isTTY !== true) process.stdout.write((r.value ?? '') + '\n');
  return r.done ? '' : String(r.value).trim();
};

async function restore(arg) {
  const files = list();
  if (!files.length) {
    console.log(`No backups found in ${DIR}`);
    return 1;
  }
  let pick = arg && files.includes(path.basename(arg)) ? path.basename(arg) : null;
  if (!pick) {
    console.log('Backups (newest first):\n');
    files.slice(0, 40).forEach((n, i) => console.log(`  ${String(i + 1).padStart(2)}  ${label(n)}`));
    const a = await ask('\nNumber of the backup to restore (Enter to cancel): ');
    const i = parseInt(a, 10) - 1;
    if (!(i >= 0 && i < files.length)) {
      console.log('Cancelled. Nothing changed.');
      return 0;
    }
    pick = files[i];
  }
  const src = path.join(DIR, pick),
    info = check(src);
  if (!info) {
    console.log(`${pick} is damaged or not a Perovskite Lab database. Nothing changed.`);
    return 1;
  }
  console.log(`\n${pick}: ${info.users} users, ${info.presets} presets.`);
  if (
    !arg &&
    (await ask('Replace the current database with this backup? Type yes to continue: ')).toLowerCase() !== 'yes'
  ) {
    console.log('Cancelled. Nothing changed.');
    return 0;
  }
  await backup('before-restore'); // the current state can be restored again later
  for (const ext of ['-wal', '-shm']) if (fs.existsSync(DB + ext)) fs.unlinkSync(DB + ext);
  fs.copyFileSync(src, DB);
  console.log('Restored. Start the app again.');
  return 0;
}

async function decrypt(file, keyArg) {
  const crypto = require('node:crypto');
  if (!file || !fs.existsSync(file)) {
    console.log('Usage: node db-tools.cjs decrypt <path/to/data-....db.enc> [key]');
    return 1;
  }
  const keyFile = path.resolve(process.env.CONFIG_DIR || path.join(__dirname, '..', '..', 'config'), 'backup.key');
  let key = (
    keyArg ||
    process.env.BACKUP_KEY ||
    (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : '')
  ).trim();
  if (!key) key = await ask('Backup key (64 characters, from Admin settings › Backups › Show key): ');
  if (!/^[0-9a-f]{64}$/i.test(key)) {
    console.log('That is not a backup key (64 characters, 0-9 and a-f).');
    return 1;
  }
  const box = fs.readFileSync(file);
  if (box.subarray(0, 4).toString() !== 'PLB1') {
    console.log('Not an encrypted Perovskite Lab backup.');
    return 1;
  }
  let plain;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), box.subarray(4, 16));
    d.setAuthTag(box.subarray(box.length - 16));
    plain = Buffer.concat([d.update(box.subarray(16, box.length - 16)), d.final()]);
  } catch {
    console.log('Wrong key, or the file was damaged or altered. Nothing written.');
    return 1;
  }
  fs.mkdirSync(DIR, { recursive: true });
  const name = path.basename(file).replace(/\.enc$/, ''),
    out = path.join(DIR, NAME.test(name) ? name : `data-${stamp()}-manual.db`);
  if (fs.existsSync(out)) {
    console.log(`${path.basename(out)} is already in the backups folder.`);
    return 0;
  }
  fs.writeFileSync(out, plain);
  const info = check(out);
  if (!info) {
    fs.unlinkSync(out);
    console.log('Decrypted, but the result is not a readable database. Nothing written.');
    return 1;
  }
  console.log(
    `Decrypted: backups/${path.basename(out)} (${info.users} users, ${info.presets} presets). Restore it with restore.bat / restore.sh.`,
  );
  return 0;
}

const [cmd, arg, arg2] = process.argv.slice(2);
(cmd === 'backup'
  ? backup(arg || 'manual').then(() => 0)
  : cmd === 'restore'
    ? restore(arg)
    : cmd === 'decrypt'
      ? decrypt(arg, arg2)
      : Promise.resolve(
          (console.log('Usage: node db-tools.cjs backup <kind> | restore [file] | decrypt <file.enc> [key]'), 1),
        )
).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e.message);
    process.exit(1);
  },
);
