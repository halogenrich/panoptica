import type { FastifyInstance } from 'fastify';
import { db, tagsOf } from './db.js';

/**
 * Overview for the Professor and Managers (and admins): what the lab did in a week or a month. Everything is computed here
 * from batches, measurements and bookings, so the page is one request. Stability follow-ups are left out of the numbers.
 */
type Curve = {
  set_id: number;
  sample: string;
  substrate: string;
  pixel: string;
  dir: string;
  metrics: string;
  use: number | null;
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
    if (m.status !== 'ok' || c.use === 0 || !Number.isFinite(m.pce)) continue;
    const k = `${c.set_id}|${c.sample}|${c.substrate}`;
    by.set(k, Math.max(by.get(k) ?? 0, m.pce));
  }
  return by;
}
/** Working hours in a period: weekdays 08:00–18:00, the base for how busy each equipment was. */
function workHours(from: Date, to: Date) {
  let h = 0;
  for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1)) if (d.getDay() !== 0 && d.getDay() !== 6) h += 10;
  return h;
}

export function registerDashboard(app: FastifyInstance, auth: (need?: any) => any) {
  const allowed = async (req: any, reply: any) => {
    const u = req.user;
    if (!(u.role === 'admin' || u.professor || u.manager))
      return reply.code(403).send({ error: 'the overview is for the Professor and Managers' });
  };
  app.get('/api/dashboard', { preHandler: [auth(), allowed] }, async (req: any, reply) => {
    const from = new Date(String(req.query.from)),
      to = new Date(String(req.query.to)),
      unit = req.query.unit === 'month' ? 'month' : 'week';
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from)
      return reply.code(400).send({ error: 'choose a period' });
    const f = iso(from),
      t = iso(to),
      fd = f.slice(0, 10),
      td = t.slice(0, 10);
    const users = (
      db
        .prepare(
          'SELECT id,name,username,photo_v AS photoV,last_seen,role FROM users WHERE deleted=0 AND active=1 ORDER BY name',
        )
        .all() as any[]
    ).map((u) => ({ ...u, tags: tagsOf(u.id) }));
    const sets = db
      .prepare(
        'SELECT s.id,s.owner_id,s.name,s.date,s.created_at,s.system,s.links FROM iv_sets s WHERE s.deleted_at IS NULL AND s.stability_of IS NULL',
      )
      .all() as any[];
    const inP = (s: any) => {
      const d = dayOf(s);
      return d >= fd && d < td;
    };
    const curvesOf = (ids: number[]) =>
      ids.length
        ? (db
            .prepare(
              `SELECT set_id,sample,substrate,pixel,dir,metrics,use FROM iv_curves WHERE set_id IN (${ids.map(() => '?').join(',')})`,
            )
            .all(...ids) as Curve[])
        : [];
    const pSets = sets.filter(inP),
      pDev = devicesOf(curvesOf(pSets.map((s) => s.id)));
    const batches = db
      .prepare(
        'SELECT b.id,b.code,b.name,b.owner_id,b.status,b.created_at,b.updated_at,u.name AS owner FROM batches b JOIN users u ON u.id=b.owner_id WHERE b.deleted_at IS NULL',
      )
      .all() as any[];
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
    const books = db
      .prepare(
        `SELECT k.*, e.name AS equipment, e.color, u.name AS user_name, b.code AS batch_code FROM bookings k JOIN equipment e ON e.id=k.equipment_id JOIN users u ON u.id=k.user_id JOIN batches b ON b.id=k.batch_id
      WHERE k.end > ? AND k.start < ? AND b.deleted_at IS NULL`,
      )
      .all(f, t) as any[];
    const hoursOf = (k: any) =>
      (Math.min(new Date(k.end).getTime(), to.getTime()) - Math.max(new Date(k.start).getTime(), from.getTime())) /
      3.6e6;

    // ---- people
    const people = users.map((u) => {
      const mySets = pSets.filter((s) => s.owner_id === u.id),
        devs = [...pDev.entries()].filter(([k]) => mySets.some((s) => k.startsWith(s.id + '|'))).map(([, v]) => v);
      const allDevs = devicesOf(curvesOf(sets.filter((s) => s.owner_id === u.id).map((s) => s.id)));
      return {
        ...u,
        batchesStarted: started.filter((b) => b.owner_id === u.id).length,
        batchesDone: done.filter((b) => b.owner_id === u.id).length,
        running: batches.filter((b) => b.owner_id === u.id && b.status === 'running').length,
        measurements: mySets.length,
        devices: devs.length,
        best: devs.length ? Math.max(...devs) : null,
        median: median(devs),
        bestEver: allDevs.size ? Math.max(...allDevs.values()) : null,
        hours: books.filter((k) => k.user_id === u.id).reduce((a, k) => a + hoursOf(k), 0),
      };
    });

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

    // ---- equipment
    const wh = workHours(from, to);
    const equipment = (
      db.prepare('SELECT id,name,color FROM equipment WHERE active=1 ORDER BY pos,id').all() as any[]
    ).map((e) => {
      const ks = books.filter((k) => k.equipment_id === e.id),
        hours = ks.reduce((a, k) => a + hoursOf(k), 0);
      const by: Record<string, number> = {};
      for (const k of ks) by[k.user_name] = (by[k.user_name] ?? 0) + hoursOf(k);
      return {
        ...e,
        hours,
        use: wh ? hours / wh : 0,
        bookings: ks.length,
        byUser: Object.entries(by)
          .sort((x, y) => y[1] - x[1])
          .map(([name, h]) => ({ name, hours: h })),
        done: ks.filter((k) => k.outcome === 'done').length,
        postponed: ks.filter((k) => k.outcome === 'postponed').length,
        canceled: ks.filter((k) => k.outcome === 'canceled').length,
      };
    });

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
    const digest = {
      top,
      record:
        top[0] && (recordBefore === null || top[0].pce > recordBefore) ? { ...top[0], before: recordBefore } : null,
      finished: done.map((b) => ({ id: b.id, code: b.code, name: b.name, owner: b.owner })),
      started: started.map((b) => ({ id: b.id, code: b.code, name: b.name, owner: b.owner, status: b.status })),
      measurements: pSets.map((s) => ({
        id: s.id,
        name: s.name,
        owner: owner(s.owner_id),
        devices: [...pDev.keys()].filter((k) => k.startsWith(s.id + '|')).length,
        best: Math.max(0, ...[...pDev.entries()].filter(([k]) => k.startsWith(s.id + '|')).map(([, v]) => v)),
      })),
      setbacks: books
        .filter((k) => k.outcome === 'postponed' || k.outcome === 'canceled')
        .map((k) => ({
          id: k.id,
          outcome: k.outcome,
          reason: k.reason,
          equipment: k.equipment,
          batch: k.batch_code,
          step: k.step,
          user: k.user_name,
          start: k.start,
        })),
      waiting: books.filter((k) => !k.outcome && k.end < iso(new Date())).length,
    };
    const lab = {
      batchesStarted: started.length,
      batchesDone: done.length,
      running: batches.filter((b) => b.status === 'running').length,
      measurements: pSets.length,
      devices: pDev.size,
      best: pDev.size ? Math.max(...pDev.values()) : null,
      median: median([...pDev.values()]),
      hours: books.reduce((a, k) => a + hoursOf(k), 0),
      workHours: wh,
    };
    return { from: f, to: t, unit, lab, trend, people, equipment, digest };
  });

  /** One person's page: their batches, measurements over time, and equipment time (all time, newest first). */
  app.get('/api/dashboard/person/:id', { preHandler: [auth(), allowed] }, async (req: any, reply) => {
    const u = db
      .prepare(
        'SELECT id,name,username,photo_v AS photoV,last_seen,role,created_at FROM users WHERE id=? AND deleted=0',
      )
      .get(+req.params.id) as any;
    if (!u) return reply.code(404).send({ error: 'not found' });
    const sets = db
      .prepare(
        'SELECT id,name,date,created_at,system FROM iv_sets WHERE owner_id=? AND deleted_at IS NULL AND stability_of IS NULL',
      )
      .all(u.id) as any[];
    const curves = sets.length
      ? (db
          .prepare(
            `SELECT set_id,sample,substrate,pixel,dir,metrics,use FROM iv_curves WHERE set_id IN (${sets.map(() => '?').join(',')})`,
          )
          .all(...sets.map((s) => s.id)) as Curve[])
      : [];
    const dev = devicesOf(curves);
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
      .all(u.id);
    const hours = db
      .prepare(
        `SELECT e.name, e.color, SUM((julianday(k.end) - julianday(k.start)) * 24) AS hours, COUNT(*) AS n FROM bookings k JOIN equipment e ON e.id=k.equipment_id WHERE k.user_id=? GROUP BY e.id ORDER BY hours DESC`,
      )
      .all(u.id);
    const setbacks = db
      .prepare(
        `SELECT k.outcome, k.reason, k.start, k.step, e.name AS equipment, b.code AS batch FROM bookings k JOIN equipment e ON e.id=k.equipment_id JOIN batches b ON b.id=k.batch_id WHERE k.user_id=? AND k.outcome IN ('postponed','canceled') ORDER BY k.start DESC LIMIT 10`,
      )
      .all(u.id);
    return { ...u, tags: tagsOf(u.id), progress, batches, hours, setbacks };
  });
}
