import type { FastifyInstance } from 'fastify';
import { InventoryPurge } from '@psc/schema';
import { db, tx } from './db.js';
import { backupNow } from './backup.js';

/**
 * Purging the inventory and undoing an import (0.54.2), for admins, in Admin settings › Inventory. A wrong import used to mean
 * removing hundreds of containers one by one. Three ways:
 * - everything: every substance and container, in the trash too (storage places, divisions and storage types stay);
 * - the last 7 days: containers added since then, typed in or imported, and the substances first made since then that are
 *   left with nothing (older items stay even when edited in that time: hand edits are never undone);
 * - one import: its containers (also those changed since), and the substances, storage places and divisions it made that
 *   are left with nothing.
 * Past batches keep their snapshots and what they took; recipes show a removed name as not in the inventory. A backup is made
 * first and nothing is removed when it fails; the removal skips the trash, so that backup is the way back.
 */
export type Scope = { kind: 'all' } | { kind: 'week' } | { kind: 'import'; id: number };
export type Counts = { containers: number; substances: number; places: number; divisions: number; changed: number };
type Plan = { containers: number[]; substances: number[]; places: number[]; divisions: number[]; changed: number };

const ids = (sql: string, ...a: (number | string)[]) =>
  (db.prepare(sql).all(...a) as { id: number }[]).map((r) => r.id);
// SQLite's own clock, like `added_at` (UTC, 'YYYY-MM-DD HH:MM:SS'), so the two compare as text
const WEEK = "datetime('now','-7 days')";

function plan(s: Scope): Plan {
  if (s.kind === 'all')
    return {
      containers: ids('SELECT id FROM containers'),
      substances: ids('SELECT id FROM chemicals'),
      places: [],
      divisions: [],
      changed: 0,
    };
  if (s.kind === 'week')
    return {
      containers: ids(`SELECT id FROM containers WHERE added_at >= ${WEEK}`),
      substances: ids(
        `SELECT id FROM chemicals h WHERE created_at >= ${WEEK}
           AND NOT EXISTS (SELECT 1 FROM containers c WHERE c.chem_id=h.id AND c.added_at < ${WEEK})`,
      ),
      places: [],
      divisions: [],
      changed: 0,
    };
  const i = s.id;
  return {
    containers: ids('SELECT id FROM containers WHERE import_id=?', i),
    changed: (
      db.prepare('SELECT COUNT(*) n FROM containers WHERE import_id=? AND updated_at IS NOT NULL').get(i) as {
        n: number;
      }
    ).n,
    // what the import made and nothing else uses
    substances: ids(
      'SELECT id FROM chemicals h WHERE import_id=? AND NOT EXISTS (SELECT 1 FROM containers c WHERE c.chem_id=h.id AND c.import_id IS NOT ?)',
      i,
      i,
    ),
    divisions: ids(
      'SELECT id FROM shelves s WHERE import_id=? AND NOT EXISTS (SELECT 1 FROM containers c WHERE c.shelf_id=s.id AND c.import_id IS NOT ?)',
      i,
      i,
    ),
    places: ids(
      `SELECT id FROM storage_areas a WHERE import_id=?
         AND NOT EXISTS (SELECT 1 FROM containers c WHERE c.area_id=a.id AND c.import_id IS NOT ?)
         AND NOT EXISTS (SELECT 1 FROM shelves s WHERE s.area_id=a.id AND s.import_id IS NOT ?)`,
      i,
      i,
      i,
    ),
  };
}

const count = (p: Plan): Counts => ({
  containers: p.containers.length,
  substances: p.substances.length,
  places: p.places.length,
  divisions: p.divisions.length,
  changed: p.changed,
});

/** "12 containers, 3 substances", for the activity log. */
export function describe(c: Counts) {
  const n = (k: number, one: string, many: string) => (k ? [`${k} ${k === 1 ? one : many}`] : []);
  return (
    [
      ...n(c.containers, 'container', 'containers'),
      ...n(c.substances, 'substance', 'substances'),
      ...n(c.places, 'storage place', 'storage places'),
      ...n(c.divisions, 'division', 'divisions'),
    ].join(', ') || 'nothing'
  );
}

/** What a purge or an undo would remove now. */
export const preview = (s: Scope) => count(plan(s));

/** Makes the backup, then removes what `plan` finds, in one transaction. */
export async function purge(s: Scope, by: string): Promise<Counts & { backup: string }> {
  const b = await backupNow('before-purge'); // throws when the backup fails its check: then nothing is removed
  const done = tx(() => {
    const p = plan(s);
    const del = (t: string, list: number[]) =>
      list.length &&
      db.prepare(`DELETE FROM ${t} WHERE id IN (SELECT value FROM json_each(?))`).run(JSON.stringify(list));
    del('containers', p.containers);
    del('chemicals', p.substances);
    del('shelves', p.divisions);
    del('storage_areas', p.places);
    db.exec('DELETE FROM chem_pairs WHERE a NOT IN (SELECT id FROM chemicals) OR b NOT IN (SELECT id FROM chemicals)');
    // the list of imports says which are gone, and how
    const mark = (how: string, where: string, ...a: number[]) =>
      db
        .prepare(
          `UPDATE inventory_imports SET undone_at=CURRENT_TIMESTAMP, undone_by=?, undone_how=? WHERE undone_at IS NULL AND ${where}`,
        )
        .run(by, how, ...a);
    if (s.kind === 'import') mark('undo', 'id=?', s.id);
    else mark('purge', 'NOT EXISTS (SELECT 1 FROM containers c WHERE c.import_id=inventory_imports.id)');
    return count(p);
  });
  return { ...done, backup: b.name };
}

type Imp = {
  id: number;
  at: string;
  username: string;
  file: string;
  containers: number;
  substances: number;
  undone_at: string | null;
  undone_by: string | null;
  undone_how: string | null;
};

export function registerPurge(app: FastifyInstance, auth: (need?: any) => any, bad: (reply: any, p: any) => any) {
  /** The two purges' counts and the imports, newest first, each with what undoing it would remove now. */
  app.get('/api/inventory/purge', { preHandler: auth(true) }, async () => ({
    all: preview({ kind: 'all' }),
    week: preview({ kind: 'week' }),
    imports: (db.prepare('SELECT * FROM inventory_imports ORDER BY id DESC LIMIT 200').all() as Imp[]).map((r) => ({
      ...r,
      left: r.undone_at ? null : preview({ kind: 'import', id: r.id }),
    })),
  }));
  const fail = (reply: any, e: unknown) =>
    reply
      .code(500)
      .send({ error: `The backup before removing failed, so nothing was removed: ${(e as Error).message}` });
  app.post('/api/inventory/purge', { preHandler: auth(true) }, async (req: any, reply) => {
    const p = InventoryPurge.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    try {
      const r = await purge({ kind: p.data.scope }, req.user.username ?? '');
      req.auditTarget = `${p.data.scope === 'all' ? 'Everything' : 'Added in the last 7 days'}: ${describe(r)}`;
      return r;
    } catch (e) {
      return fail(reply, e);
    }
  });
  app.post('/api/inventory/imports/:id/undo', { preHandler: auth(true) }, async (req: any, reply) => {
    const r0 = db.prepare('SELECT * FROM inventory_imports WHERE id=?').get(+req.params.id) as Imp | undefined;
    if (!r0) return reply.code(404).send({ error: 'not found' });
    if (r0.undone_at) return reply.code(409).send({ error: 'This import was already removed.' });
    try {
      const r = await purge({ kind: 'import', id: r0.id }, req.user.username ?? '');
      req.auditTarget = `${r0.file || 'Import'} of ${r0.at.slice(0, 16)}: ${describe(r)}`;
      return r;
    } catch (e) {
      return fail(reply, e);
    }
  });
}
