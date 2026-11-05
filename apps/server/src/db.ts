import { createRequire } from 'node:module';
import type { DatabaseSync as DB } from 'node:sqlite';
import './quiet.js';

// loaded at run time (not as a static import) so the warning filter in quiet.ts is already in place on Node 22
export const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: typeof DB };

/** SQLite built into Node (22.13+): no native module to compile or download, on any OS or Node version. */
export const db = new DatabaseSync(process.env.DB_PATH || 'data.db');
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

/** Runs fn in one transaction (all or nothing). */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','member')), hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS presets(
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), segment TEXT NOT NULL, name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')), data TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS chemicals(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user_prefs(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS batches(
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), code TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','running','done')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),
  snapshot TEXT NOT NULL, record TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS run_data(
  id INTEGER PRIMARY KEY, preset_id INTEGER NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES users(id), batch TEXT NOT NULL DEFAULT '', data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);

// migrations for databases created by earlier versions
const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
if (!cols('presets').includes('parent_id'))
  db.exec('ALTER TABLE presets ADD COLUMN parent_id INTEGER REFERENCES presets(id) ON DELETE SET NULL');
// deleted users stay as rows (their presets, batches and measurements keep an owner), shown as "username (former)"
if (!cols('users').includes('deleted')) db.exec('ALTER TABLE users ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
// 0.18: forced password change, trash (soft delete), comments with reactions, notifications, app settings
if (!cols('users').includes('must_change'))
  db.exec('ALTER TABLE users ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0');
if (!cols('presets').includes('deleted_at')) db.exec('ALTER TABLE presets ADD COLUMN deleted_at TEXT');
if (!cols('batches').includes('deleted_at')) db.exec('ALTER TABLE batches ADD COLUMN deleted_at TEXT');
db.exec(`
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comments(
  id INTEGER PRIMARY KEY, target TEXT NOT NULL, target_id INTEGER NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
  parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE, text TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, edited_at TEXT);
CREATE INDEX IF NOT EXISTS comments_target ON comments(target, target_id);
CREATE TABLE IF NOT EXISTS reactions(comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), emoji TEXT NOT NULL,
  PRIMARY KEY(comment_id, user_id, emoji));
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, text TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '{}', actor TEXT NOT NULL DEFAULT '', read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, read);
`);

// 0.20: profile photo, presence, user tags (custom labels plus the built-in Professor, Manager and Inventory tags that grant access)
if (!cols('users').includes('photo')) db.exec('ALTER TABLE users ADD COLUMN photo TEXT');
if (!cols('users').includes('photo_v')) db.exec('ALTER TABLE users ADD COLUMN photo_v INTEGER NOT NULL DEFAULT 0');
if (!cols('users').includes('last_seen')) db.exec('ALTER TABLE users ADD COLUMN last_seen TEXT');
if (!cols('users').includes('online_since')) db.exec('ALTER TABLE users ADD COLUMN online_since TEXT');
if (!cols('comments').includes('private'))
  db.exec('ALTER TABLE comments ADD COLUMN private INTEGER NOT NULL DEFAULT 0');
db.exec(`
CREATE TABLE IF NOT EXISTS tags(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, color TEXT NOT NULL DEFAULT '#6b7280',
  kind TEXT NOT NULL DEFAULT 'label' CHECK(kind IN ('label','professor','manager','inventory')), pos INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS user_tags(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, tag_id));
`);
if (!db.prepare('SELECT 1 FROM tags LIMIT 1').get()) {
  const ins = db.prepare('INSERT INTO tags(name,color,kind,pos) VALUES(?,?,?,?)');
  (
    [
      ['Professor', '#7c3aed', 'professor'],
      ['Manager', '#0f766e', 'manager'],
      ['Inventory', '#b45309', 'inventory'],
      ["Master's", '#2563eb', 'label'],
      ['PhD', '#1d4ed8', 'label'],
      ['Post-doc', '#0369a1', 'label'],
      ['Visitor', '#6b7280', 'label'],
    ] as const
  ).forEach(([n, c, k], i) => ins.run(n, c, k, i));
}

/** Access a user's tags give: Professor sees everything and can comment privately; Manager and Inventory open their pages. */
export function perms(uid: number) {
  const kinds = (
    db
      .prepare('SELECT DISTINCT t.kind FROM user_tags ut JOIN tags t ON t.id=ut.tag_id WHERE ut.user_id=?')
      .all(uid) as { kind: string }[]
  ).map((r) => r.kind);
  return {
    professor: kinds.includes('professor'),
    manager: kinds.includes('manager'),
    inventory: kinds.includes('inventory'),
  };
}
export const tagsOf = (uid: number) =>
  db
    .prepare(
      'SELECT t.id,t.name,t.color,t.kind FROM user_tags ut JOIN tags t ON t.id=ut.tag_id WHERE ut.user_id=? ORDER BY t.pos,t.name',
    )
    .all(uid);
