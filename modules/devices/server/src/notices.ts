import { db, notify } from '@psc/server/api';

type U = { id: number; name: string };

const activeUsers = () =>
  (db.prepare('SELECT id FROM users WHERE active=1 AND deleted=0').all() as { id: number }[]).map((r) => r.id);

/** A new measurement with a better cell than any before (per J–V system, since the systems measure different cell sizes). */
export function checkRecord(setId: number, by: U) {
  const s = db.prepare('SELECT system,name FROM iv_sets WHERE id=?').get(setId) as { system: string; name: string };
  const best = (where: string, ...args: number[]) =>
    (
      db
        .prepare(
          `SELECT MAX(json_extract(c.metrics,'$.pce')) AS p FROM iv_curves c JOIN iv_sets s ON s.id=c.set_id
    WHERE json_extract(c.metrics,'$.status')='ok' AND (c.use=1 OR (c.use IS NULL AND c.kind IS NULL)) AND s.deleted_at IS NULL AND s.stability_of IS NULL AND s.system=? AND ${where}`,
        )
        .get(s.system, ...args) as { p: number | null }
    ).p;
  const now = best('s.id=?', setId),
    before = best('s.id<>?', setId);
  if (now === null || before === null || now <= before + 1e-9) return null; // the first measurement of a system sets no "record"
  const sys = s.system === 'csv' ? 'multi-pixel system' : 'per-curve system';
  notify(
    activeUsers(),
    'record',
    `New lab record on the ${sys}: ${now.toFixed(2)} % by ${by.name} (previous ${before.toFixed(2)} %)`,
    { view: 'iv', id: setId },
    by.name,
  );
  return { now, before };
}

/** Someone made a new preset based on yours (a new version or a duplicate). */
export function notifyFork(newId: number, parentId: number, by: U) {
  const p = db.prepare('SELECT owner_id,name,segment FROM presets WHERE id=?').get(parentId) as
    { owner_id: number; name: string; segment: string } | undefined;
  const n = db.prepare('SELECT name,segment FROM presets WHERE id=?').get(newId) as { name: string; segment: string };
  if (!p || p.owner_id === by.id) return;
  notify(
    [p.owner_id],
    'fork',
    `${by.name} made “${n.name}” based on your “${p.name}”`,
    { view: n.segment, id: newId },
    by.name,
  );
}
