import { createRequire } from 'node:module';
import type { DatabaseSync as DB } from 'node:sqlite';
import './quiet.js';
import { migrate } from './schema.js';

// loaded at run time (not as a static import) so the warning filter in quiet.ts is already in place on Node 22
export const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: typeof DB };

/** SQLite built into Node (22.13+): no native module to compile or download, on any OS or Node version. */
export const db = new DatabaseSync(process.env.DB_PATH || 'data.db');
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

let depth = 0;
/** Runs `fn` in one transaction (all or nothing); called inside another, it joins that one (the outer one commits or rolls back). */
export function tx<T>(fn: () => T): T {
  if (depth) {
    depth++;
    try {
      return fn();
    } finally {
      depth--;
    }
  }
  db.exec('BEGIN');
  depth = 1;
  try {
    const r = fn();
    depth = 0;
    db.exec('COMMIT');
    return r;
  } catch (e) {
    depth = 0;
    db.exec('ROLLBACK');
    throw e;
  }
}
// every change to the database, in order (schema.ts). It runs here, when the database opens, so it is done before any other
// file's start-up code reads a table.
migrate(db);

/**
 * 0.38: what a tag gives is a set of permissions any tag can carry, instead of three built-in kinds:
 * comments (sees everything and comments privately to the owner, the old Professor), overview (the lab overview, the old
 * Manager), inventory (edits the inventory), equipment (manages all equipment), training (trains people on any equipment).
 */
export const PERMS = ['comments', 'overview', 'inventory', 'equipment', 'training'] as const;
export type Perm = (typeof PERMS)[number];
/** SQL condition: tag `t` gives this permission. */
export const tagHas = (p: Perm, t = 't') => `${t}.perms LIKE '%"${p}"%'`;

/** Access a user's tags give (the names kept from before: professor = comments, manager = overview). */
export function perms(uid: number) {
  const ps = new Set<string>();
  for (const r of db
    .prepare('SELECT t.perms FROM user_tags ut JOIN tags t ON t.id=ut.tag_id WHERE ut.user_id=?')
    .all(uid) as { perms: string }[])
    for (const p of JSON.parse(r.perms || '[]') as string[]) ps.add(p);
  return {
    professor: ps.has('comments'),
    manager: ps.has('overview'),
    inventory: ps.has('inventory'),
    equipment: ps.has('equipment'),
    training: ps.has('training'),
  };
}
export const tagsOf = (uid: number) =>
  db
    .prepare(
      'SELECT t.id,t.name,t.color,t.kind,t.perms FROM user_tags ut JOIN tags t ON t.id=ut.tag_id WHERE ut.user_id=? ORDER BY t.pos,t.name',
    )
    .all(uid);
