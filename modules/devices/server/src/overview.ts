import { db, type OverviewPart, type Period } from '@psc/server/api';
import { dayOf, groupDevices, median, personLines } from './lines.js';

/**
 * The Electronic Devices module's part of the Overview (0.42): batches started, finished and running, measurements and the cells
 * in them, the efficiency trend, the best cells and a new record. Stability follow-ups are left out of the numbers.
 */
type Curve = {
  set_id: number;
  sample: string;
  substrate: string;
  pixel: string;
  dir: string;
  metrics: string;
  use: number | null;
  kind?: string | null;
};
const iso = (d: Date) => d.toISOString();

/** Best working pixel of each device (sample + substrate) in a set: the "devices" counted and compared. */
function devicesOf(curves: Curve[]) {
  const by = new Map<string, number>();
  for (const c of curves) {
    const m = JSON.parse(c.metrics);
    // counted: ok, not left out by hand, and not a check sweep unless ticked in by hand
    if (m.status !== 'ok' || c.use === 0 || (c.kind && c.use !== 1) || !Number.isFinite(m.pce)) continue;
    const k = `${c.set_id}|${c.sample}|${c.substrate}`;
    by.set(k, Math.max(by.get(k) ?? 0, m.pce));
  }
  return by;
}
const curvesOf = (ids: number[]) =>
  ids.length
    ? (db
        .prepare(
          `SELECT set_id,sample,substrate,pixel,dir,metrics,use,kind FROM iv_curves WHERE set_id IN (${ids.map(() => '?').join(',')})`,
        )
        .all(...ids) as Curve[])
    : [];

function period({ from, to, unit, inScope, users, viewer, seeAll = true }: Period) {
  // 0.60: the lab seen by someone who does not see everything counts shared work and their own, as the lab screen does
  const visible = (r: { owner_id: number; visibility: string }) =>
    seeAll || r.visibility === 'shared' || r.owner_id === viewer;
  const f = iso(from),
    t = iso(to),
    fd = f.slice(0, 10),
    td = t.slice(0, 10);
  const sets = (
    db
      .prepare(
        'SELECT s.id,s.owner_id,s.name,s.date,s.created_at,s.system,s.links,s.visibility FROM iv_sets s WHERE s.deleted_at IS NULL AND s.stability_of IS NULL',
      )
      .all() as any[]
  ).filter((s) => inScope(s.owner_id) && visible(s));
  const inP = (s: any) => {
    const d = dayOf(s);
    return d >= fd && d < td;
  };
  const pSets = sets.filter(inP),
    pDev = devicesOf(curvesOf(pSets.map((s) => s.id)));
  const batches = (
    db
      .prepare(
        'SELECT b.id,b.code,b.name,b.owner_id,b.status,b.created_at,b.updated_at,b.visibility,u.name AS owner FROM batches b JOIN users u ON u.id=b.owner_id WHERE b.deleted_at IS NULL',
      )
      .all() as any[]
  ).filter((b) => inScope(b.owner_id) && visible(b));
  const started = batches.filter(
    (b) =>
      b.created_at.replace(' ', 'T') >= f.slice(0, 19).replace('Z', '') &&
      b.created_at.replace(' ', 'T') < t.slice(0, 19),
  );
  const done = batches.filter(
    (b) =>
      b.status === 'done' &&
      b.updated_at.replace(' ', 'T') >= f.slice(0, 19) &&
      b.updated_at.replace(' ', 'T') < t.slice(0, 19),
  );

  // ---- people
  const people: Record<number, Record<string, unknown>> = {};
  for (const u of users) {
    const mySets = pSets.filter((s) => s.owner_id === u.id),
      devs = [...pDev.entries()].filter(([k]) => mySets.some((s) => k.startsWith(s.id + '|'))).map(([, v]) => v);
    const allDevs = devicesOf(curvesOf(sets.filter((s) => s.owner_id === u.id).map((s) => s.id)));
    people[u.id] = {
      batchesStarted: started.filter((b) => b.owner_id === u.id).length,
      batchesDone: done.filter((b) => b.owner_id === u.id).length,
      running: batches.filter((b) => b.owner_id === u.id && b.status === 'running').length,
      measurements: mySets.length,
      devices: devs.length,
      best: devs.length ? Math.max(...devs) : null,
      median: median(devs),
      bestEver: allDevs.size ? Math.max(...allDevs.values()) : null,
    };
  }

  // ---- trend: the last 12 periods up to this one, best and median device of each
  const trend: { start: string; best: number | null; median: number | null; devices: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const a = new Date(from),
      b = new Date(from);
    if (unit === 'month') {
      a.setMonth(a.getMonth() - i);
      b.setMonth(b.getMonth() - i + 1);
    } else {
      a.setDate(a.getDate() - 7 * i);
      b.setDate(b.getDate() - 7 * i + 7);
    }
    const ss = sets.filter((s) => {
        const d = dayOf(s);
        return d >= iso(a).slice(0, 10) && d < iso(b).slice(0, 10);
      }),
      v = [...devicesOf(curvesOf(ss.map((s) => s.id))).values()];
    trend.push({ start: iso(a), best: v.length ? Math.max(...v) : null, median: median(v), devices: v.length });
  }

  // ---- digest
  const owner = (id: number) => users.find((u) => u.id === id)?.name ?? 'someone';
  const top = [...pDev.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, pce]) => {
      const [sid, sample, substrate] = k.split('|'),
        s = sets.find((x) => x.id === +sid)!;
      return { pce, set: s.name, setId: s.id, sample, substrate, owner: owner(s.owner_id), system: s.system };
    });
  const before = devicesOf(curvesOf(sets.filter((s) => dayOf(s) < fd).map((s) => s.id))),
    recordBefore = before.size ? Math.max(...before.values()) : null;
  return {
    people,
    lab: {
      batchesStarted: started.length,
      batchesDone: done.length,
      running: batches.filter((b) => b.status === 'running').length,
      measurements: pSets.length,
      devices: pDev.size,
      best: pDev.size ? Math.max(...pDev.values()) : null,
      median: median([...pDev.values()]),
    },
    trend,
    top,
    record: top[0] && (recordBefore === null || top[0].pce > recordBefore) ? { ...top[0], before: recordBefore } : null,
    finished: done.map((b) => ({ id: b.id, code: b.code, name: b.name, owner: b.owner })),
    started: started.map((b) => ({ id: b.id, code: b.code, name: b.name, owner: b.owner, status: b.status })),
    measurements: pSets.map((s) => ({
      id: s.id,
      name: s.name,
      owner: owner(s.owner_id),
      devices: [...pDev.keys()].filter((k) => k.startsWith(s.id + '|')).length,
      best: Math.max(0, ...[...pDev.entries()].filter(([k]) => k.startsWith(s.id + '|')).map(([, v]) => v)),
    })),
  };
}

/**
 * One person's page (My progress, 0.60): their measurements, their batches, and the best device of each batch over time. A device
 * counts for the batch its sample is linked to; devices linked to no batch count for their measurement, so nothing measured is
 * left off the chart. `best` is their best device ever, with what the slide needs to find its curves and its batch.
 */
function person(uid: number) {
  const sets = db
    .prepare(
      'SELECT id,name,date,created_at,system,links FROM iv_sets WHERE owner_id=? AND deleted_at IS NULL AND stability_of IS NULL',
    )
    .all(uid) as any[];
  const { dev, groups } = groupDevices(sets);
  const progress = sets
    .map((s) => {
      const v = [...dev.entries()].filter(([k]) => k.startsWith(s.id + '|')).map(([, x]) => x);
      return {
        id: s.id,
        name: s.name,
        day: dayOf(s),
        system: s.system,
        devices: v.length,
        best: v.length ? Math.max(...v) : null,
        median: median(v),
      };
    })
    .sort((a, b) => a.day.localeCompare(b.day));
  const batches = db
    .prepare(
      'SELECT id,code,name,status,created_at,updated_at FROM batches WHERE owner_id=? AND deleted_at IS NULL ORDER BY created_at DESC',
    )
    .all(uid) as { id: number; code: string; name: string; status: string; created_at: string }[];
  // 0.61: each batch's line of research; measurements linked to no batch, and batches in no line, are "Not in a line"
  const { lineOfBatch, lines } = personLines(
    uid,
    [...groups.values()].filter((g) => g.kind === 'batch').map((g) => g.id),
  );
  const batchName = (id: number) =>
    (db.prepare('SELECT name, code FROM batches WHERE id=? AND deleted_at IS NULL').get(id) as
      { name: string; code: string } | undefined) ?? null;
  const points = [...groups.values()]
    .map((g) => {
      const b = g.kind === 'batch' ? batchName(g.id) : null;
      return {
        kind: b ? 'batch' : 'set',
        id: b ? g.id : g.top.setId,
        name: b ? b.name : g.top.set,
        day: g.day,
        devices: g.pces.length,
        best: Math.max(...g.pces),
        median: median(g.pces),
        top: { ...g.top, batchId: b ? g.id : null },
        line: b ? (lineOfBatch.get(g.id) ?? null) : null,
      };
    })
    .sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));
  const best = points.reduce<(typeof points)[number] | null>((a, p) => (!a || p.best > a.best ? p : a), null);
  return {
    progress,
    batches: batches.map((b) => {
      const p = points.find((x) => x.kind === 'batch' && x.id === b.id);
      return { ...b, best: p?.best ?? null, devices: p?.devices ?? 0 };
    }),
    points,
    lines,
    best: best ? best.top : null,
  };
}

export const devicesOverview: OverviewPart = { period, person };
