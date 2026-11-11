import type { FastifyInstance } from 'fastify';
import { ScheduleIn } from '@psc/schema';
import { STEP_KINDS } from '@psc/core';
import { db, tx } from './db.js';
import { notify } from './social.js';
import { lockedById, markDone } from './batchlock.js';
import { addModule, measuring, type BookingSubject, type SubjectInfo } from './modules.js';
import {
  after,
  bookingOut,
  bookingsWhere,
  clashes,
  clashText,
  cleanupOf,
  slotProblem,
  tickSubjects,
} from './calendar.js';

/**
 * The Electronic Devices module's part of the calendar (0.41): batches as something bookings are for, the photovoltaics steps
 * equipment can do, and the batch scheduler's routes. The rest of the module (recipes, stacks, batches, J–V) moves here in 0.43.
 */

const stepsOf = (eq: number) =>
  JSON.parse(
    (db.prepare('SELECT steps FROM equipment WHERE id=?').get(eq) as { steps: string } | undefined)?.steps ?? '[]',
  ) as string[];

/**
 * Batch status follows its bookings. Running once the first booking has started (startDueBatches). Done once every booking has
 * an outcome and none of them is waiting to be rebooked: a postponed step keeps the batch Running until it is scheduled again.
 * Bookings on measuring equipment (J–V measurement of finished devices) are not steps of the batch.
 */
export function settleBatch(id: number) {
  const b = db.prepare('SELECT status, code, owner_id, plan_steps FROM batches WHERE id=?').get(id) as any;
  const ks = (
    db.prepare("SELECT outcome, step, equipment_id FROM bookings WHERE subject='batch' AND subject_id=?").all(id) as {
      outcome: string | null;
      step: string;
      equipment_id: number;
    }[]
  ).filter((k) => !measuring(stepsOf(k.equipment_id)));
  if (!b || b.status === 'done' || !ks.length || ks.some((k) => !k.outcome || k.outcome === 'postponed')) return;
  // every block of the scheduler's plan must have been booked and answered (one placed in the past used to close the batch)
  const plan: string[] = JSON.parse(b.plan_steps || '[]');
  if (plan.some((st) => !ks.some((k) => k.step === st && (k.outcome === 'done' || k.outcome === 'canceled')))) return;
  db.prepare("UPDATE batches SET status='done', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  markDone(id);
  notify(
    [b.owner_id],
    'batch',
    ks.some((k) => k.outcome === 'done')
      ? `Batch ${b.code} is Done: every scheduled step is concluded`
      : `Batch ${b.code} was closed: its steps were canceled`,
    { view: 'batches', id },
  );
}

/** Batches whose first booked step has started switch from Planned to Running; their owners are told. */
export function startDueBatches() {
  const now = new Date().toISOString();
  const due = db
    .prepare(
      `SELECT b.id, b.code, b.owner_id, MIN(k.start) AS first,
         (SELECT e.name FROM bookings k2 JOIN equipment e ON e.id=k2.equipment_id
           WHERE k2.subject='batch' AND k2.subject_id=b.id ORDER BY k2.start LIMIT 1) AS eq
       FROM batches b JOIN bookings k ON k.subject='batch' AND k.subject_id=b.id
       WHERE b.status='planned' AND b.deleted_at IS NULL GROUP BY b.id HAVING MIN(k.start) <= ?`,
    )
    .all(now) as any[];
  for (const b of due) {
    db.prepare("UPDATE batches SET status='running', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(b.id);
    notify([b.owner_id], 'batch', `Batch ${b.code} is now Running: its first booking (${b.eq}) has started`, {
      view: 'batches',
      id: b.id,
    });
  }
  return due.length;
}

/** Batches as something equipment is booked for. */
const batchSubject: BookingSubject = {
  kind: 'batch',
  module: 'devices',
  noun: 'batch',
  plural: 'batches',
  info(ids) {
    const m = new Map<number, SubjectInfo>();
    if (!ids.length) return m;
    for (const r of db
      .prepare(
        `SELECT id, code, name, status, owner_id, deleted_at FROM batches WHERE id IN (${ids.map(() => '?').join(',')})`,
      )
      .all(...ids) as any[])
      m.set(r.id, { code: r.code, name: r.name, status: r.status, owner_id: r.owner_id, gone: !!r.deleted_at });
    return m;
  },
  refuse(u, id, eq, isNew) {
    const b = db.prepare('SELECT owner_id, status FROM batches WHERE id=? AND deleted_at IS NULL').get(id) as any;
    if (!b) return { status: 400, error: 'choose one of your batches' };
    if (b.owner_id !== u.id && u.role !== 'admin')
      return { status: 403, error: 'you can only book for your own batches' };
    if (eq.measuring && b.status !== 'done')
      return {
        status: 400,
        error: `${eq.name} measures finished batches: choose a Done batch, or no batch and say why it is booked`,
      };
    if (!eq.measuring && isNew && b.status === 'done')
      return { status: 400, error: 'this batch is done; book for a Planned or Running batch' };
    return null;
  },
  // a locked batch's record stays fixed, but measuring it again on the J–V equipment is still allowed
  locked: (id, eq) => (eq.measuring ? null : lockedById(id)),
  asksOutcome: (eq) => !eq.measuring,
  outcomeGiven: settleBatch,
  tick: () => void startDueBatches(),
  choices: (u) => ({
    open: db
      .prepare(
        "SELECT id, code, name, status FROM batches WHERE owner_id=? AND status IN ('planned','running') AND deleted_at IS NULL ORDER BY status DESC, id DESC",
      )
      .all(u.id) as any[],
    // finished batches, for measuring equipment (the latest first)
    finished: db
      .prepare(
        "SELECT id, code, name, status FROM batches WHERE owner_id=? AND status='done' AND deleted_at IS NULL ORDER BY COALESCE(done_at, updated_at) DESC, id DESC LIMIT 40",
      )
      .all(u.id) as any[],
  }),
};

function registerDevicesCalendar(app: FastifyInstance, auth: (need?: any) => any, bad: (reply: any, p: any) => any) {
  /** A concluded step whose run data the person chose to add later: remind them (the batch page lists it until it is added). */
  app.post('/api/bookings/:id/runs-later', { preHandler: auth() }, async (req: any, reply) => {
    const k = db
      .prepare(
        "SELECT k.*, b.owner_id, b.code FROM bookings k JOIN batches b ON k.subject='batch' AND b.id=k.subject_id WHERE k.id=? AND b.deleted_at IS NULL",
      )
      .get(+req.params.id) as any;
    if (!k) return reply.code(404).send({ error: 'not found' });
    if (k.user_id !== req.user.id && k.owner_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'not your booking' });
    notify(
      [k.user_id],
      'runs',
      `Run data for ${k.step || 'a concluded step'} of batch ${k.code} is still missing. Add it from the batch page.`,
      { view: 'batches', id: k.subject_id },
    );
    return { ok: true };
  });

  /** The scheduler's blocks for a batch (sent when its tray opens), so the batch is Done only when each of them is answered. */
  app.put('/api/batches/:id/plan', { preHandler: auth() }, async (req: any, reply) => {
    const id = +req.params.id,
      b = db.prepare('SELECT owner_id, status FROM batches WHERE id=? AND deleted_at IS NULL').get(id) as any;
    if (!b) return reply.code(404).send({ error: 'not found' });
    if (b.owner_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'not your batch' });
    const steps = Array.isArray(req.body?.steps)
      ? (req.body.steps as unknown[])
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.slice(0, 120))
          .slice(0, 60)
      : null;
    if (!steps) return reply.code(400).send({ error: 'steps: a list of step names' });
    const split = Array.isArray(req.body?.split)
      ? (req.body.split as unknown[])
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.slice(0, 60))
          .slice(0, 60)
      : null;
    if (b.status !== 'done') {
      db.prepare('UPDATE batches SET plan_steps=? WHERE id=?').run(JSON.stringify(steps), id);
      if (split) db.prepare('UPDATE batches SET plan_split=? WHERE id=?').run(JSON.stringify(split), id);
    }
    return { ok: true };
  });

  /**
   * Schedule a whole batch: the given steps replace the batch's scheduler bookings (equipment with a role) that have not started.
   * All or nothing: if one step overlaps another booking, nothing changes and the step is named.
   */
  app.put('/api/batches/:id/schedule', { preHandler: auth() }, async (req: any, reply) => {
    const id = +req.params.id,
      b = db.prepare('SELECT owner_id, status FROM batches WHERE id=? AND deleted_at IS NULL').get(id) as any;
    if (!b) return reply.code(404).send({ error: 'not found' });
    if (b.owner_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'you can only schedule your own batches' });
    if (b.status === 'done') return reply.code(400).send({ error: 'this batch is done' });
    const lk = lockedById(id);
    if (lk) return reply.code(423).send({ error: lk });
    const p = ScheduleIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const now = new Date().toISOString(),
      items = p.data.items;
    for (const [i, it] of items.entries()) {
      const no = slotProblem(req.user, it.equipment_id, it.start, it.end);
      if (no) return reply.code(no.status).send({ error: `${it.step}: ${no.error}`, index: i });
    }
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++)
        if (
          items[i].equipment_id === items[j].equipment_id &&
          after(items[i].end, cleanupOf(items[i].equipment_id)) > items[j].start &&
          after(items[j].end, cleanupOf(items[j].equipment_id)) > items[i].start
        )
          return reply
            .code(409)
            .send({ error: `${items[i].step} and ${items[j].step} use the same equipment at the same time`, index: j });
    try {
      tx(() => {
        // only the scheduler's own steps are replaced: single bookings on other equipment (made in the Calendar) stay
        db.prepare(
          "DELETE FROM bookings WHERE subject='batch' AND subject_id=? AND outcome IS NULL AND start > ? AND equipment_id IN (SELECT id FROM equipment WHERE role NOT IN ('','measure'))",
        ).run(id, now);
        items.forEach((it, i) => {
          const c = clashes(it.equipment_id, it.start, it.end);
          if (c.length && !(it.force && req.user.role === 'admin')) {
            const e: any = new Error(`${it.step}: ${clashText(c[0], it.start, it.end)}`);
            e.index = i;
            throw e;
          }
          db.prepare(
            "INSERT INTO bookings(equipment_id,subject,subject_id,user_id,step,start,end,forced) VALUES(?,'batch',?,?,?,?,?,?)",
          ).run(it.equipment_id, id, req.user.id, it.step, it.start, it.end, it.force ? 1 : 0);
        });
      });
    } catch (e: any) {
      return reply.code(409).send({ error: e.message, index: e.index });
    }
    tickSubjects();
    return { ok: true };
  });

  app.get('/api/batches/:id/bookings', { preHandler: auth() }, async (req: any) =>
    bookingsWhere("k.subject='batch' AND k.subject_id=? ORDER BY k.start", +req.params.id).map((r) =>
      bookingOut(r, req.user),
    ),
  );
}

/** The photovoltaics steps; J–V measurement and lifetime equipment measures finished devices. */
const MEASURES = new Set(['jv', 'lifetime']);
addModule({
  id: 'devices',
  subjects: [batchSubject],
  steps: STEP_KINDS.map((s) => ({ ...s, module: 'devices', ...(MEASURES.has(s.key) ? { measures: true } : {}) })),
  register: registerDevicesCalendar,
});
