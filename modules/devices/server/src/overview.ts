import { db, type OverviewPart, type Period } from '@psc/server/api';

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
const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y),
    m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const dayOf = (s: { date: string; created_at: string }) =>
  s.date && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : s.created_at.slice(0, 10);
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

function period({ from, to, unit, inScope, users }: Period) {
  const f = iso(from),
    t = iso(to),
    fd = f.slice(0, 10),
    td = t.slice(0, 10);
  const sets = (
    db
      .prepare(
        'SELECT s.id,s.owner_id,s.name,s.date,s.created_at,s.system,s.links FROM iv_sets s WHERE s.deleted_at IS NULL AND s.stability_of IS NULL',
      )
      .all() as any[]
  ).filter((s) => inScope(s.owner_id));
  const inP = (s: any) => {
    const d = dayOf(s);
    return d >= fd && d < td;
  };
  const pSets = sets.filter(inP),
    pDev = devicesOf(curvesOf(pSets.map((s) => s.id)));
  const batches = (
    db
      .prepare(
        'SELECT b.id,b.code,b.name,b.owner_id,b.status,b.created_at,b.updated_at,u.name AS owner FROM batches b JOIN users u ON u.id=b.owner_id WHERE b.deleted_at IS NULL',
      )
      .all() as any[]
  ).filter((b) => inScope(b.owner_id));
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

/** One person's page: their measurements over time (progress) and their batches (all time, newest first). */
function person(uid: number) {
  const sets = db
    .prepare(
      'SELECT id,name,date,created_at,system FROM iv_sets WHERE owner_id=? AND deleted_at IS NULL AND stability_of IS NULL',
    )
    .all(uid) as any[];
  const dev = devicesOf(curvesOf(sets.map((s) => s.id)));
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
    .all(uid);
  return { progress, batches };
}

export const devicesOverview: OverviewPart = { period, person };
