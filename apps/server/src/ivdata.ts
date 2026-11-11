import type { DatabaseSync } from 'node:sqlite';
import { checkSweeps, shortedPixels } from '@psc/core';

/**
 * J–V data jobs used both by the database changes (schema.ts, on existing data) and by the J–V routes (after an import or an
 * edit). They take the database as an argument so schema.ts does not depend on db.ts.
 */

/**
 * 0.30: check sweeps. kind = 'check' marks a quick exploratory scan (e.g. 0.05 V, forward only) run before the real measurement
 * of the same pixel; it is shown but never counted (best, statistics, records, comparisons) unless someone ticks it in by hand.
 */
export function classifySet(db: DatabaseSync, setId: number) {
  const rows = db
    .prepare('SELECT id,sample,substrate,pixel,scan,dir,data FROM iv_curves WHERE set_id=?')
    .all(setId) as any[];
  const cs = rows.map((r) => ({ ...r, V: (JSON.parse(r.data) as { V: number[] }).V }));
  const chk = checkSweeps(cs);
  const up = db.prepare('UPDATE iv_curves SET kind=? WHERE id=?');
  for (const c of cs) up.run(chk.has(`${c.sample}|${c.substrate}|${c.pixel}|${c.scan}`) ? 'check' : null, c.id);
}

/**
 * 0.37: a pixel that shorted in one regular scan counts as shorted in all of them (forward working but backward shorted is a
 * shorted pixel). The scan that worked keeps its numbers, with status 'short' and shortBy 'pixel'; a scan that no longer shares a
 * pixel with a shorted one (after a check sweep is reclassified, say) gets its own status back.
 */
export function markShortsInSet(db: DatabaseSync, setId: number) {
  const rows = (
    db.prepare('SELECT id,sample,substrate,pixel,kind,metrics FROM iv_curves WHERE set_id=?').all(setId) as any[]
  ).map((r) => ({ ...r, m: JSON.parse(r.metrics) }));
  const own = (r: any) => (r.m.shortBy === 'pixel' ? 'ok' : r.m.status);
  const short = shortedPixels(rows.map((r) => ({ ...r, status: own(r) })));
  const up = db.prepare('UPDATE iv_curves SET metrics=? WHERE id=?');
  for (const r of rows) {
    const want = !r.kind && own(r) === 'ok' && short.has(`${r.sample}|${r.substrate}|${r.pixel}`);
    if (want === (r.m.shortBy === 'pixel')) continue;
    const m = { ...r.m };
    if (want) Object.assign(m, { status: 'short', shortBy: 'pixel' });
    else {
      m.status = 'ok';
      delete m.shortBy;
    }
    up.run(JSON.stringify(m), r.id);
  }
}
