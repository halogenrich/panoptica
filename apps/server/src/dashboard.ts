import type { FastifyInstance } from 'fastify';
import { db, tagsOf } from './db.js';
import { minutesOf, workDayOf } from '@psc/core';
import { lab } from './lab.js';
import { measuring, modules, subject } from './modules.js';
import { withSubjects } from './calendar.js';

/**
 * Overview: what a person, a supervisor's students or the lab did in a week or a month, in one request. The core counts people,
 * equipment time and steps that did not go as planned; each module adds its own numbers (0.42: `overview` in its manifest), under
 * `m.<module>` for the period and under each person.
 */
const iso = (d: Date) => d.toISOString();

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
/** An outcome is asked for this booking when it ends (a step of something; measuring equipment asks none). */
const asksOutcome = (k: any) =>
  !!k.subject &&
  !!subject(k.subject)?.asksOutcome({
    id: k.equipment_id,
    name: k.equipment,
    measuring: measuring(JSON.parse(k.eq_steps || '[]')),
  });

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
      t = iso(to);
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
    // bookings in the period; those for something deleted or in the trash are left out
    const books = withSubjects(
      db
        .prepare(
          `SELECT k.*, e.name AS equipment, e.color, e.steps AS eq_steps, u.name AS user_name FROM bookings k JOIN equipment e ON e.id=k.equipment_id JOIN users u ON u.id=k.user_id
      WHERE k.end > ? AND k.start < ?`,
        )
        .all(f, t) as any[],
    ).filter((k: any) => inScope(k.user_id));
    const hoursOf = (k: any) =>
      (Math.min(new Date(k.end).getTime(), to.getTime()) - Math.max(new Date(k.start).getTime(), from.getTime())) /
      3.6e6;

    // ---- the modules' numbers
    const m: Record<string, any> = {};
    for (const x of modules()) if (x.overview) m[x.id] = x.overview.period({ from, to, unit, inScope, users });

    // ---- people
    const people = users.map((u) => ({
      ...u,
      hours: books.filter((k) => k.user_id === u.id).reduce((a, k) => a + hoursOf(k), 0),
      m: Object.fromEntries(Object.entries(m).map(([id, v]) => [id, v.people[u.id] ?? {}])),
    }));

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

    // ---- steps that did not go as planned, and those still waiting for their outcome
    const digest = {
      setbacks: books
        .filter((k) => k.outcome === 'postponed' || k.outcome === 'canceled')
        .map((k) => ({
          id: k.id,
          outcome: k.outcome,
          reason: k.reason,
          equipment: k.equipment,
          subject: k.subject_code,
          step: k.step,
          user: k.user_name,
          start: k.start,
        })),
      waiting: books.filter((k) => !k.outcome && asksOutcome(k) && k.end < iso(new Date())).length,
    };
    return {
      from: f,
      to: t,
      unit,
      lab: { hours: books.reduce((a, k) => a + hoursOf(k), 0), workHours: wh },
      people,
      // the lab's equipment for the lab; only what the people in view used, otherwise
      equipment: ids === null ? equipment : equipment.filter((e) => e.bookings > 0),
      digest,
      m: Object.fromEntries(Object.entries(m).map(([id, { people: _, ...v }]) => [id, v])),
      scope: ids === null ? 'lab' : ids?.length === 1 ? 'one' : 'group',
    };
  });

  /** One person's page: equipment time and steps that did not go as planned (all time), and each module's part. */
  app.get('/api/dashboard/person/:id', { preHandler: [auth(), allowed] }, async (req: any, reply) => {
    const u = db
      .prepare(
        'SELECT id,name,username,photo_v AS photoV,last_seen,role,created_at FROM users WHERE id=? AND deleted=0',
      )
      .get(+req.params.id) as any;
    if (!u) return reply.code(404).send({ error: 'not found' });
    const hours = db
      .prepare(
        `SELECT e.name, e.color, SUM((julianday(k.end) - julianday(k.start)) * 24) AS hours, COUNT(*) AS n FROM bookings k JOIN equipment e ON e.id=k.equipment_id WHERE k.user_id=? GROUP BY e.id ORDER BY hours DESC`,
      )
      .all(u.id);
    const setbacks = withSubjects(
      db
        .prepare(
          `SELECT k.outcome, k.reason, k.start, k.step, k.subject, k.subject_id, e.name AS equipment FROM bookings k JOIN equipment e ON e.id=k.equipment_id WHERE k.user_id=? AND k.outcome IN ('postponed','canceled') ORDER BY k.start DESC`,
        )
        .all(u.id) as any[],
    )
      .slice(0, 10)
      .map((k) => ({
        outcome: k.outcome,
        reason: k.reason,
        start: k.start,
        step: k.step,
        equipment: k.equipment,
        subject: k.subject_code,
      }));
    const m: Record<string, unknown> = {};
    for (const x of modules()) if (x.overview) m[x.id] = x.overview.person(u.id);
    return { ...u, tags: tagsOf(u.id), hours, setbacks, m };
  });
}
