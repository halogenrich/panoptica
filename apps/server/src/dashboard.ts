import type { FastifyInstance } from 'fastify';
import { db, tagsOf } from './db.js';
import { minutesOf, workDayOf } from '@psc/core';
import { lab } from './lab.js';

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
/** Working hours in a period (the lab's working days and hours, Lab setup): the base for how busy each equipment was. */
function workHours(from: Date, to: Date) {
  const hours = lab().hours;
  let h = 0;
  for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1)) {
    const w = workDayOf(hours, d);
    if (w.on) h += Math.max(0, minutesOf(w.to) - minutesOf(w.from)) / 60;
  }
  return h;
}

export function registerDashboard(app: FastifyInstance, auth: (need?: any) => any) {
  /**
   * 0.38: everyone has an overview of their own work. Lab overview access (admins, the Lab overview permission) opens the
   * whole lab or anyone's; a supervisor (named as supervisor or co-supervisor on a student's account) opens their students'.
   */
  const lead = (u: any) => u.role === 'admin' || !!u.manager;
  const studentsOf = (u: any) =>
    (
      db
        .prepare(
          `SELECT id FROM users WHERE deleted=0 AND id<>? AND (lower(trim(supervisor))=lower(?) OR lower(trim(cosupervisor))=lower(?))`,
        )
        .all(u.id, u.name, u.name) as { id: number }[]
    ).map((r) => r.id);
  /** The people a scope covers, or null for the whole lab; undefined when the viewer may not open it. */
  const scopeIds = (req: any): number[] | null | undefined => {
    const u = req.user,
      sc = String(req.query.scope ?? (lead(u) ? 'lab' : 'me'));
    if (sc === 'me') return [u.id];
    if (sc === 'students') return studentsOf(u);
    if (sc === 'lab') return lead(u) ? null : undefined;
    const m = sc.match(/^user:(\d+)$/);
    if (m) return lead(u) || +m[1] === u.id || studentsOf(u).includes(+m[1]) ? [+m[1]] : undefined;
    return undefined;
  };
  const allowed = async (req: any, reply: any) => {
    if (req.routeOptions?.url === '/api/dashboard/person/:id') {
      const id = +req.params.id,
        u = req.user;
      if (!(lead(u) || id === u.id || studentsOf(u).includes(id)))
        return reply.code(403).send({ error: 'you can open your own overview and your students’' });
      return;
    }
    if (scopeIds(req) === undefined)
      return reply.code(403).send({ error: 'you can open your own overview and your students’' });
  };
  /** What the viewer may pick in the overview: themselves, their students, the lab and anyone (with lab overview access). */
  app.get('/api/dashboard/scopes', { preHandler: auth() }, async (req: any) => {
    const u = req.user;
    const people = lead(u)
      ? db.prepare('SELECT id,name FROM users WHERE deleted=0 AND active=1 ORDER BY name COLLATE NOCASE').all()
      : [];
    return { lab: lead(u), students: studentsOf(u).length, people };
  });
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
    const ids = scopeIds(req),
      inScope = (id: number) => ids === null || !!ids?.includes(id);
    const users = (
      db
        .prepare(
          'SELECT id,name,username,photo_v AS photoV,last_seen,role FROM users WHERE deleted=0 AND active=1 ORDER BY name',
        )
        .all() as any[]
    )
      .filter((u) => inScope(u.id))
      .map((u) => ({ ...u, tags: tagsOf(u.id) }));
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
    const curvesOf = (ids: number[]) =>
      ids.length
        ? (db
            .prepare(
              `SELECT set_id,sample,substrate,pixel,dir,metrics,use,kind FROM iv_curves WHERE set_id IN (${ids.map(() => '?').join(',')})`,
            )
            .all(...ids) as Curve[])
        : [];
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
    const books = db
      .prepare(
        `SELECT k.*, e.name AS equipment, e.color, e.role AS role, u.name AS user_name, b.code AS batch_code FROM bookings k JOIN equipment e ON e.id=k.equipment_id JOIN users u ON u.id=k.user_id LEFT JOIN batches b ON b.id=k.batch_id
      WHERE k.end > ? AND k.start < ? AND b.deleted_at IS NULL`,
      )
      .all(f, t)
      .filter((k: any) => inScope(k.user_id)) as any[];
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
      db.prepare('SELECT id,name,color,role,art FROM equipment WHERE active=1 ORDER BY pos,id').all() as any[]
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
      // batch steps still waiting for their outcome (bookings outside a batch and J–V measurements have none)
      waiting: books.filter((k) => !k.outcome && k.batch_id && k.role !== 'measure' && k.end < iso(new Date())).length,
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
    return {
      from: f,
      to: t,
      unit,
      lab,
      trend,
      people,
      // the lab's equipment for the lab; only what the people in view used, otherwise
      equipment: ids === null ? equipment : equipment.filter((e) => e.bookings > 0),
      digest,
      scope: ids === null ? 'lab' : ids?.length === 1 ? 'one' : 'group',
    };
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
            `SELECT set_id,sample,substrate,pixel,dir,metrics,use,kind FROM iv_curves WHERE set_id IN (${sets.map(() => '?').join(',')})`,
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
        `SELECT k.outcome, k.reason, k.start, k.step, e.name AS equipment, b.code AS batch FROM bookings k JOIN equipment e ON e.id=k.equipment_id LEFT JOIN batches b ON b.id=k.batch_id WHERE k.user_id=? AND k.outcome IN ('postponed','canceled') ORDER BY k.start DESC LIMIT 10`,
      )
      .all(u.id);
    return { ...u, tags: tagsOf(u.id), progress, batches, hours, setbacks };
  });
}
