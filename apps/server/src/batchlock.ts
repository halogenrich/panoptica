import { db } from './db.js';

/**
 * Finished batches lock by themselves: LOCK_DAYS after a batch is Done, its record, schedule, variants and run data can no longer be
 * changed, so what was measured stays tied to what was made. Comments, sharing and measurement links stay open. An admin can unlock a
 * batch for UNLOCK_DAYS (logged in the activity log); it then locks again by itself.
 */
export const LOCK_DAYS = 14;
export const UNLOCK_DAYS = 7;

if (!(db.prepare('PRAGMA table_info(batches)').all() as { name: string }[]).some((c) => c.name === 'done_at')) {
  db.exec('ALTER TABLE batches ADD COLUMN done_at TEXT');
  db.exec('ALTER TABLE batches ADD COLUMN unlocked_until TEXT');
  // batches finished before 0.33: their last change is the best guess of when they finished
  db.exec("UPDATE batches SET done_at=updated_at WHERE status='done'");
}

type B = { code: string; status: string; done_at: string | null; unlocked_until: string | null };
const iso = (s: string) => (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');

export function lockOf(b: B, now = Date.now()) {
  const locksAt =
    b.status === 'done' && b.done_at ? new Date(new Date(iso(b.done_at)).getTime() + LOCK_DAYS * 864e5) : null;
  const unlockedUntil = b.unlocked_until && new Date(iso(b.unlocked_until)).getTime() > now ? b.unlocked_until : null;
  return {
    locked: !!locksAt && locksAt.getTime() <= now && !unlockedUntil,
    locksAt: locksAt?.toISOString() ?? null,
    unlockedUntil,
  };
}
export const lockText = (code: string) =>
  `batch ${code} is locked: it finished more than ${LOCK_DAYS} days ago. An admin can unlock it`;

const row = (where: string, v: number | string) =>
  db.prepare(`SELECT code,status,done_at,unlocked_until FROM batches WHERE ${where} AND deleted_at IS NULL`).get(v) as
    B | undefined;
/** The error to send when the batch (by id or by code) is locked, else null. */
export function lockedById(id: number) {
  const b = row('id=?', id);
  return b && lockOf(b).locked ? lockText(b.code) : null;
}
export function lockedByCode(code: string) {
  if (!code) return null;
  const b = row('code=?', code);
  return b && lockOf(b).locked ? lockText(b.code) : null;
}
/** Status changes keep done_at in step: set when a batch becomes Done, cleared when it is reopened. */
export function markDone(id: number) {
  db.prepare("UPDATE batches SET done_at=COALESCE(done_at, ?) WHERE id=? AND status='done'").run(
    new Date().toISOString(),
    id,
  );
  db.prepare("UPDATE batches SET done_at=NULL WHERE id=? AND status<>'done'").run(id);
}
