import { snapshotUses } from '@psc/devices';
import { db, giveBack, take } from '@psc/server/api';

/**
 * What a batch takes from the inventory (0.45): once it starts running (or is Done), its frozen recipes' amounts are taken from
 * the containers it was started with, each recorded; they are put back when it goes to the trash or back to Planned. Batches
 * from before 0.45 took nothing: their containers' amounts are what people typed.
 */
export function takeForBatch(id: number) {
  const b = db.prepare('SELECT status, snapshot, deleted_at FROM batches WHERE id=?').get(id) as
    { status: string; snapshot: string; deleted_at: string | null } | undefined;
  if (!b || b.deleted_at || b.status === 'planned') return;
  const s = JSON.parse(b.snapshot);
  if (!s.takes) return; // started before 0.45
  take('batch', id, snapshotUses(s));
}
export const giveBackForBatch = (id: number) => giveBack('batch', id);
