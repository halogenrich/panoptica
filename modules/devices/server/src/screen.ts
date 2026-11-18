import { db } from '@psc/server/api';
import { linkNames } from './iv.js';
import { resolveStack } from './batches.js';

/**
 * Electronic Devices' part of the lab screen (0.59): the best device of the calendar week (Monday 00:00 to now, Richard), the
 * highest PCE in the lab among shared measurements, counted as the Overview counts them (a working scan, not left out by hand,
 * not a check sweep unless ticked in). With it: the person, the batch or stack, the date, and the pixel's scans for the J–V
 * figure, with what the figure needs to state the stack's layers and p-i-n or n-i-p.
 */
type Row = {
  id: number;
  set_id: number;
  sample: string;
  substrate: string;
  scan: string;
  pixel: string;
  dir: string;
  area: number;
  pin: number;
  data: string;
  metrics: string;
  use: number | null;
  kind: string | null;
};

const dayOf = (s: { date: string; created_at: string }) =>
  s.date && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : s.created_at.slice(0, 10);
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function screenPart() {
  const now = new Date(),
    mon = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const from = ymd(mon),
    to = ymd(now);
  const sets = (
    db
      .prepare(
        `SELECT s.id, s.name, s.date, s.created_at, s.links, s.owner_id, u.name AS owner FROM iv_sets s JOIN users u ON u.id=s.owner_id
         WHERE s.deleted_at IS NULL AND s.stability_of IS NULL AND s.visibility='shared'`,
      )
      .all() as any[]
  ).filter((s) => {
    const d = dayOf(s);
    return d >= from && d <= to;
  });
  let best: { row: Row; pce: number; set: any } | null = null;
  const q = db.prepare(
    'SELECT id,set_id,sample,substrate,scan,pixel,dir,area,pin,data,metrics,use,kind FROM iv_curves WHERE set_id=?',
  );
  for (const s of sets)
    for (const c of q.all(s.id) as Row[]) {
      const m = JSON.parse(c.metrics);
      if (m.status !== 'ok' || c.use === 0 || (c.kind && c.use !== 1) || !Number.isFinite(m.pce)) continue;
      if (!best || m.pce > best.pce) best = { row: c, pce: m.pce, set: s };
    }
  if (!best) return { best: null };
  const { row, set } = best;
  // the pixel's scans of the same sweep (backward and forward), for the figure
  const curves = (
    db
      .prepare(
        'SELECT id,set_id,sample,substrate,scan,pixel,dir,area,pin,data,metrics,use,kind FROM iv_curves WHERE set_id=? AND sample=? AND substrate=? AND pixel=? AND scan=?',
      )
      .all(row.set_id, row.sample, row.substrate, row.pixel, row.scan) as Row[]
  ).map((c) => {
    const d = JSON.parse(c.data);
    return {
      id: c.id,
      sample: c.sample,
      substrate: c.substrate,
      scan: c.scan,
      pixel: c.pixel,
      dir: c.dir,
      V: d.V,
      J: d.J,
      m: JSON.parse(c.metrics),
      use: c.use === null ? null : !!c.use,
      kind: c.kind ?? null,
    };
  });
  const raw = (JSON.parse(set.links || '{}') as Record<string, any>)[row.sample] ?? null,
    link = raw ? (linkNames({ [row.sample]: raw })[row.sample] ?? null) : null;
  // what the figure states about the device: the batch's frozen stack (with its variant), or the stack's recipes now
  let device: Record<string, unknown> | null = null;
  if (link?.kind === 'batch') {
    const b = db
      .prepare('SELECT snapshot, variants, visibility FROM batches WHERE id=? AND deleted_at IS NULL')
      .get(link.id) as { snapshot: string; variants: string; visibility: string } | undefined;
    if (b && b.visibility === 'shared') {
      const v = (JSON.parse(b.variants || '{}').list ?? []).find((x: { id: string }) => x.id === link.variant) ?? null;
      device = { snapshot: JSON.parse(b.snapshot), variant: v };
    }
  } else if (link?.kind === 'stack') {
    const r = db
      .prepare("SELECT data, visibility FROM presets WHERE id=? AND segment='stk' AND deleted_at IS NULL")
      .get(link.id) as { data: string; visibility: string } | undefined;
    if (r && r.visibility === 'shared') {
      const stack = JSON.parse(r.data);
      device = { snapshot: { stack, resolved: resolveStack({ id: set.owner_id, role: 'member' } as any, stack) } };
    }
  }
  return {
    best: {
      pce: best.pce,
      set: { id: set.id, name: set.name, date: dayOf(set) },
      owner: set.owner,
      sample: row.sample,
      substrate: row.substrate,
      pixel: row.pixel,
      bestId: row.id,
      curves,
      link,
      device,
    },
  };
}
