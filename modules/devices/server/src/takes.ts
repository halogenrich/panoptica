import { snapshotUses } from '@psc/devices';
import { db, giveBack, retake, take } from '@psc/server/api';

/**
 * What a batch takes from the inventory (0.45): once it starts running (or is Done), its frozen recipes' amounts are taken from
 * the containers it was started with, each recorded; they are put back when it goes to the trash or back to Planned. Batches
 * from before 0.45 took nothing: their containers' amounts are what people typed.
 *
 * The amounts are what its run data say was weighed or dispensed, where they were entered, else what the recipes planned (0.45.1);
 * entering, changing or deleting run data takes them again.
 */
type Row = { id: number; code: string; status: string; snapshot: string; deleted_at: string | null };

/** A batch's run data by recipe id: for each value, the latest entry that gives it. */
export function runsOf(code: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const r of db.prepare('SELECT preset_id, data FROM run_data WHERE batch=? ORDER BY id').all(code) as {
    preset_id: number;
    data: string;
  }[]) {
    const v = (JSON.parse(r.data).values ?? {}) as Record<string, string>,
      to = (out[String(r.preset_id)] ??= {});
    for (const [k, x] of Object.entries(v)) if (String(x ?? '').trim()) to[k] = String(x);
  }
  return out;
}
/** What the batch uses: run data where entered, else planned, each with the container it was started with. */
export const usesOf = (b: { code: string; snapshot: string }) => snapshotUses(JSON.parse(b.snapshot), runsOf(b.code));

const row = (where: string, v: number | string) =>
  db.prepare(`SELECT id, code, status, snapshot, deleted_at FROM batches WHERE ${where}`).get(v) as Row | undefined;
const counts = (b: Row | undefined): b is Row =>
  !!b && !b.deleted_at && b.status !== 'planned' && !!JSON.parse(b.snapshot).takes; // takes: started in 0.45 or later

export function takeForBatch(id: number) {
  const b = row('id=?', id);
  if (counts(b)) take('batch', id, usesOf(b));
}
export const giveBackForBatch = (id: number) => giveBack('batch', id);
/** Its run data changed: take the amounts again (from the same containers). */
export function retakeForBatch(code: string) {
  const b = code ? row('code=?', code) : undefined;
  if (counts(b)) retake('batch', b.id, usesOf(b));
}
