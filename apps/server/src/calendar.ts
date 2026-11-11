import type { FastifyInstance } from 'fastify';
import { AtmoIn, BookingIn, OutcomeIn, ScheduleIn } from '@psc/schema';
import { bookingRefusal, equipmentList, minBookingOf, offDuring } from './equipment.js';
import { tx } from './db.js';
import { db } from './db.js';
import { notify } from './social.js';
import { lockedById, markDone } from './batchlock.js';
import { withinHours } from '@psc/core';
import { lab } from './lab.js';

/** dd/mm HH:MM, in the lab's (this computer's) time. */
const dm = (iso: string) => {
  const d = new Date(iso),
    z = (n: number) => String(n).padStart(2, '0');
  return `${z(d.getDate())}/${z(d.getMonth() + 1)} ${z(d.getHours())}:${z(d.getMinutes())}`;
};
/**
 * Bookings outside the lab's working days and hours are allowed, and the admins are told (0.36). A move only tells them when
 * the booking was inside the hours before.
 */
function offHours(
  by: { id: number; name: string },
  d: { equipment_id: number; batch_id?: number | null; purpose?: string; start: string; end: string },
  was?: { start: string; end: string },
) {
  const h = lab().hours,
    out = !withinHours(h, new Date(d.start), new Date(d.end));
  if (!out || (was && !withinHours(h, new Date(was.start), new Date(was.end)))) return out;
  const eq = db.prepare('SELECT name FROM equipment WHERE id=?').get(d.equipment_id) as { name: string } | undefined,
    b = d.batch_id
      ? (db.prepare('SELECT code FROM batches WHERE id=?').get(d.batch_id) as { code: string } | undefined)
      : undefined;
  // the admins and the equipment's responsible people
  const ids = (
    db
      .prepare(
        `SELECT id FROM users WHERE active=1 AND deleted=0 AND id<>? AND (role='admin'
         OR id IN (SELECT user_id FROM equipment_people WHERE equipment_id=?))`,
      )
      .all(by.id, d.equipment_id) as { id: number }[]
  ).map((r) => r.id);
  notify(
    ids,
    'hours',
    `${by.name} booked ${eq?.name ?? 'equipment'} outside working hours: ${dm(d.start)}–${dm(d.end).slice(6)}${b ? ` (batch ${b.code})` : d.purpose ? ` (${d.purpose})` : ''}`,
    { view: 'calendar', id: 0 },
    by.name,
  );
  return out;
}

/**
 * Equipment calendar. A booking belongs to one of the user's Planned (or already Running) batches, or to no batch with a stated
 * purpose; J–V measurement equipment (the solar simulator, role 'measure') takes a finished (Done) batch or a purpose. When the
 * first booked step of a batch starts, the batch switches to Running by itself. Bookings of the same equipment cannot overlap,
 * unless an admin books anyway.
 */
const roleOf = (eq: number) =>
  (db.prepare('SELECT role FROM equipment WHERE id=?').get(eq) as { role: string } | undefined)?.role ?? '';
/** A locked batch's record stays fixed, but measuring it again on the J–V equipment is still allowed. */
const lockFor = (batch: number | null, eq: number) => (batch && roleOf(eq) !== 'measure' ? lockedById(batch) : null);
/** Atmosphere is asked for bookings that ended after the release that started recording it (0.38), not for older ones. */
const ATMO_SINCE = (() => {
  const r = db.prepare("SELECT value FROM meta WHERE key='atmo-since'").get() as { value: string } | undefined;
  if (r) return r.value;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO meta(key,value) VALUES('atmo-since',?)").run(now);
  return now;
})();
/** 90 → "1 h 30", 60 → "1 hour", 45 → "45 min". */
const hm = (m: number) =>
  m === 60 ? '1 hour' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`;
/** Bookings start from now on: a minute of grace for the time a drop takes. */
const PAST_GRACE = 60_000;

type U = { id: number; name: string; role: string; manager?: boolean };
const minutes = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 6e4;
const after = (t: string, min: number) => new Date(new Date(t).getTime() + min * 6e4).toISOString();
const before = (t: string, min: number) => after(t, -min);
const cleanupOf = (eq: number) =>
  (db.prepare('SELECT cleanup FROM equipment WHERE id=?').get(eq) as { cleanup: number } | undefined)?.cleanup ?? 0;
const ROW = `SELECT k.*, e.name AS equipment, e.color, e.atmosphere, e.role AS eq_role, b.code AS batch_code, b.name AS batch_name, b.status AS batch_status, u.name AS user_name, u.photo_v AS photoV
  FROM bookings k JOIN equipment e ON e.id=k.equipment_id LEFT JOIN batches b ON b.id=k.batch_id JOIN users u ON u.id=k.user_id`;
const out = (r: any, u: U) => ({
  ...r,
  forced: !!r.forced,
  mine: r.user_id === u.id,
  editable: r.user_id === u.id || u.role === 'admin',
});

/**
 * Batch status follows its bookings. Running once the first booking has started (startDueBatches). Done once every booking has
 * an outcome and none of them is waiting to be rebooked: a postponed step keeps the batch Running until it is scheduled again.
 */
export function settleBatch(id: number) {
  const b = db.prepare('SELECT status, code, owner_id, plan_steps FROM batches WHERE id=?').get(id) as any;
  const ks = db
    .prepare(
      "SELECT k.outcome, k.step FROM bookings k JOIN equipment e ON e.id=k.equipment_id WHERE k.batch_id=? AND e.role<>'measure'",
    )
    .all(id) as { outcome: string | null; step: string }[];
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
      `SELECT b.id, b.code, b.owner_id, MIN(k.start) AS first, (SELECT e.name FROM bookings k2 JOIN equipment e ON e.id=k2.equipment_id WHERE k2.batch_id=b.id ORDER BY k2.start LIMIT 1) AS eq
    FROM batches b JOIN bookings k ON k.batch_id=b.id WHERE b.status='planned' AND b.deleted_at IS NULL GROUP BY b.id HAVING MIN(k.start) <= ?`,
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

export function registerCalendar(app: FastifyInstance, auth: (need?: any) => any, bad: (reply: any, p: any) => any) {
  setInterval(startDueBatches, 60_000).unref?.();

  /** Ended bookings of this user's batches (or booked by them) that still need an outcome. */
  app.get('/api/bookings/pending', { preHandler: auth() }, async (req: any) =>
    (
      db
        .prepare(
          ROW +
            // batch steps only: bookings outside a batch and measurements of finished batches have no outcome to give
            // and (0.38) any ended booking of equipment that records its atmosphere, until O₂ and H₂O are written down
            ` WHERE k.end <= ? AND (
                (k.outcome IS NULL AND k.batch_id IS NOT NULL AND e.role<>'measure' AND b.deleted_at IS NULL AND (k.user_id=? OR b.owner_id=?))
                OR (e.atmosphere=1 AND k.atmo='' AND k.user_id=? AND (k.batch_id IS NULL OR k.outcome IS NOT NULL OR e.role='measure')
                    AND k.end > ?)
              ) ORDER BY k.start`,
        )
        .all(
          new Date().toISOString(),
          req.user.id,
          req.user.id,
          req.user.id,
          ATMO_SINCE, // bookings from before atmosphere was recorded are not asked about
        ) as any[]
    ).map((r) => ({ ...out(r, req.user), atmoOnly: !r.batch_id || !!r.outcome || r.eq_role === 'measure' })),
  );
  /** O₂ and H₂O at the end of a booking (equipment that records its atmosphere). */
  app.post('/api/bookings/:id/atmosphere', { preHandler: auth() }, async (req: any, reply) => {
    const k = db.prepare('SELECT user_id FROM bookings WHERE id=?').get(+req.params.id) as any;
    if (!k) return reply.code(404).send({ error: 'not found' });
    if (k.user_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'not your booking' });
    const p = AtmoIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    db.prepare('UPDATE bookings SET atmo=? WHERE id=?').run(JSON.stringify(p.data), +req.params.id);
    return { ok: true };
  });
  app.post('/api/bookings/:id/outcome', { preHandler: auth() }, async (req: any, reply) => {
    const k = db
      .prepare('SELECT k.*, b.owner_id FROM bookings k JOIN batches b ON b.id=k.batch_id WHERE k.id=?')
      .get(+req.params.id) as any;
    if (!k) return reply.code(404).send({ error: 'not found' });
    if (k.user_id !== req.user.id && k.owner_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'not your booking' });
    const lk = lockedById(k.batch_id);
    if (lk) return reply.code(423).send({ error: lk });
    const p = OutcomeIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const atmoEq = (db.prepare('SELECT atmosphere FROM equipment WHERE id=?').get(k.equipment_id) as any)?.atmosphere;
    if (atmoEq && p.data.outcome === 'done' && !p.data.atmo && !k.atmo)
      return reply.code(400).send({ error: 'write down the O₂ and H₂O of the glovebox (ppm)' });
    if (p.data.atmo) db.prepare('UPDATE bookings SET atmo=? WHERE id=?').run(JSON.stringify(p.data.atmo), k.id);
    db.prepare('UPDATE bookings SET outcome=?, reason=?, outcome_at=?, outcome_by=? WHERE id=?').run(
      p.data.outcome,
      p.data.reason ?? '',
      new Date().toISOString(),
      req.user.id,
      k.id,
    );
    settleBatch(k.batch_id);
    return { ok: true };
  });

  /** A concluded step whose run data the person chose to add later: remind them (the batch page lists it until it is added). */
  app.post('/api/bookings/:id/runs-later', { preHandler: auth() }, async (req: any, reply) => {
    const k = db
      .prepare(
        'SELECT k.*, b.owner_id, b.code FROM bookings k JOIN batches b ON b.id=k.batch_id WHERE k.id=? AND b.deleted_at IS NULL',
      )
      .get(+req.params.id) as any;
    if (!k) return reply.code(404).send({ error: 'not found' });
    if (k.user_id !== req.user.id && k.owner_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'not your booking' });
    notify(
      [k.user_id],
      'runs',
      `Run data for ${k.step || 'a concluded step'} of batch ${k.code} is still missing. Add it from the batch page.`,
      { view: 'batches', id: k.batch_id },
    );
    return { ok: true };
  });

  /**
   * Bookings of the same equipment that overlap [start, end), other than `except`. The cleanup time after each booking counts as
   * taken: a booking cannot start during the cleanup of the one before, nor end so late that its own cleanup runs into the next.
   */
  const clashes = (eq: number, start: string, end: string, except = 0) => {
    const cl = cleanupOf(eq);
    return db
      .prepare(ROW + ' WHERE k.equipment_id=? AND k.end > ? AND k.start < ? AND k.id<>? AND b.deleted_at IS NULL')
      .all(eq, before(start, cl), after(end, cl), except) as any[];
  };
  const clashText = (x: any, start: string, end: string) =>
    x.end > start && x.start < end
      ? `${x.equipment} is booked by ${x.user_name} for ${forWhat(x)} at that time`
      : `${x.equipment} needs ${cleanupOf(x.equipment_id)} min of cleanup between bookings, and this is too close to the booking of ${x.user_name} (${forWhat(x)})`;
  /** what a booking is for, in words: its batch, or the purpose given for a booking outside a batch */
  const forWhat = (x: any) => (x.batch_code ? `batch ${x.batch_code}` : x.purpose || 'another use');

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
   * Schedule a whole batch: the given steps replace the batch's scheduler bookings (equipment with a role) that have not started. All or
   * nothing: if one step overlaps another booking, nothing changes and the step is named.
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
      if (new Date(it.start).getTime() < Date.now() - PAST_GRACE)
        return reply.code(400).send({ error: `${it.step}: that time has passed`, index: i });
      if (!(it.end > it.start))
        return reply.code(400).send({ error: `${it.step}: the end must be after the start`, index: i });
      if (minutes(it.start, it.end) < minBookingOf(it.equipment_id))
        return reply
          .code(400)
          .send({ error: `${it.step}: a booking is at least ${hm(minBookingOf(it.equipment_id))}`, index: i });
      const no = bookingRefusal(req.user, it.equipment_id);
      if (no) return reply.code(403).send({ error: `${it.step}: ${no}`, index: i });
      if (offDuring(it.equipment_id, it.start, it.end).length)
        return reply.code(409).send({ error: `${it.step}: the equipment is out of service then`, index: i });
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
          "DELETE FROM bookings WHERE batch_id=? AND outcome IS NULL AND start > ? AND equipment_id IN (SELECT id FROM equipment WHERE role NOT IN ('','measure'))",
        ).run(id, now);
        items.forEach((it, i) => {
          const c = clashes(it.equipment_id, it.start, it.end);
          if (c.length && !(it.force && req.user.role === 'admin')) {
            const e: any = new Error(`${it.step}: ${clashText(c[0], it.start, it.end)}`);
            e.index = i;
            throw e;
          }
          db.prepare(
            'INSERT INTO bookings(equipment_id,batch_id,user_id,step,start,end,forced) VALUES(?,?,?,?,?,?,?)',
          ).run(it.equipment_id, id, req.user.id, it.step, it.start, it.end, it.force ? 1 : 0);
        });
      });
    } catch (e: any) {
      return reply.code(409).send({ error: e.message, index: e.index });
    }
    startDueBatches();
    return { ok: true };
  });

  app.get('/api/calendar', { preHandler: auth() }, async (req: any) => {
    startDueBatches();
    const q = (v: unknown) => {
      const d = new Date(String(v ?? ''));
      return Number.isNaN(d.getTime()) ? '' : d.toISOString();
    };
    const from = q(req.query.from),
      to = q(req.query.to);
    const rows =
      from && to
        ? db.prepare(ROW + ' WHERE k.end > ? AND k.start < ? AND b.deleted_at IS NULL ORDER BY k.start').all(from, to)
        : [];
    return {
      equipment: equipmentList(),
      // the equipment this user is trained on (they can book it), and out-of-service periods in view
      trained: (
        db.prepare('SELECT equipment_id FROM equipment_training WHERE user_id=?').all(req.user.id) as {
          equipment_id: number;
        }[]
      ).map((r) => r.equipment_id),
      off:
        from && to
          ? db.prepare('SELECT * FROM equipment_off WHERE end > ? AND start < ? ORDER BY start').all(from, to)
          : [],
      bookings: (rows as any[]).map((r) => out(r, req.user)),
      // the batches this user can book for
      batches: db
        .prepare(
          "SELECT id, code, name, status FROM batches WHERE owner_id=? AND status IN ('planned','running') AND deleted_at IS NULL ORDER BY status DESC, id DESC",
        )
        .all(req.user.id),
      // finished batches, for the J–V measurement equipment (the latest first)
      finished: db
        .prepare(
          "SELECT id, code, name, status FROM batches WHERE owner_id=? AND status='done' AND deleted_at IS NULL ORDER BY COALESCE(done_at, updated_at) DESC, id DESC LIMIT 40",
        )
        .all(req.user.id),
    };
  });
  app.get('/api/batches/:id/bookings', { preHandler: auth() }, async (req: any) =>
    (db.prepare(ROW + ' WHERE k.batch_id=? ORDER BY k.start').all(+req.params.id) as any[]).map((r) =>
      out(r, req.user),
    ),
  );

  const check = (req: any, reply: any, d: any, id = 0) => {
    const e = db.prepare('SELECT name, role FROM equipment WHERE id=?').get(d.equipment_id) as any;
    if (!e) return reply.code(400).send({ error: 'choose the equipment' });
    // trained on it (admins need not be), and it is booked by itself (not inside other equipment)
    const no = bookingRefusal(req.user, d.equipment_id);
    if (no) return reply.code(403).send({ error: no });
    // bookings start from now on; a booking that has begun keeps its start (its end can still move, but not into the past)
    const was = id ? (db.prepare('SELECT start, end FROM bookings WHERE id=?').get(id) as any) : null;
    const gone = (t: string) => new Date(t).getTime() < Date.now() - PAST_GRACE;
    if ((gone(d.start) && (!was || was.start !== d.start)) || (gone(d.end) && (!was || was.end !== d.end)))
      return reply.code(400).send({ error: 'that time has passed: bookings start from now on' });
    const measure = e.role === 'measure';
    if (!d.batch_id) {
      if (!d.purpose)
        return reply.code(400).send({
          error: measure
            ? `say why ${e.name} is booked, or choose a finished batch`
            : 'say what the booking is for, or choose one of your batches',
        });
    } else {
      const b = db
        .prepare('SELECT owner_id, status FROM batches WHERE id=? AND deleted_at IS NULL')
        .get(d.batch_id) as any;
      if (!b) return reply.code(400).send({ error: 'choose one of your batches' });
      if (b.owner_id !== req.user.id && req.user.role !== 'admin')
        return reply.code(403).send({ error: 'you can only book for your own batches' });
      if (measure && b.status !== 'done')
        return reply.code(400).send({
          error: `${e.name} measures finished batches: choose a Done batch, or no batch and say why it is booked`,
        });
      if (!measure && !id && b.status === 'done')
        return reply.code(400).send({ error: 'this batch is done; book for a Planned or Running batch' });
      const lk = lockFor(d.batch_id, d.equipment_id);
      if (lk) return reply.code(423).send({ error: lk });
    }
    if (!(new Date(d.end) > new Date(d.start)))
      return reply.code(400).send({ error: 'the end must be after the start' });
    const least = minBookingOf(d.equipment_id);
    if (minutes(d.start, d.end) < least)
      return reply.code(400).send({ error: `a booking of ${e.name} is at least ${hm(least)}` });
    const off = offDuring(d.equipment_id, d.start, d.end);
    if (off.length && !(d.force && req.user.role === 'admin'))
      return reply.code(409).send({
        error: `${e.name} is out of service ${dm(off[0].start)}–${dm(off[0].end)}${off[0].reason ? ` (${off[0].reason})` : ''}`,
      });
    const c = clashes(d.equipment_id, d.start, d.end, id);
    if (c.length && !(d.force && req.user.role === 'admin')) {
      const x = c[0];
      return reply.code(409).send({ error: clashText(x, d.start, d.end), clash: x });
    }
    return null;
  };
  app.post('/api/bookings', { preHandler: auth() }, async (req: any, reply) => {
    const p = BookingIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const d = p.data;
    const no = check(req, reply, d);
    if (no) return no;
    const id = Number(
      db
        .prepare(
          'INSERT INTO bookings(equipment_id,batch_id,purpose,user_id,step,note,start,end,forced) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(
          d.equipment_id,
          d.batch_id || null,
          d.batch_id ? '' : (d.purpose ?? ''),
          req.user.id,
          d.batch_id ? (d.step ?? '') : '',
          d.note ?? '',
          d.start,
          d.end,
          d.force ? 1 : 0,
        ).lastInsertRowid,
    );
    startDueBatches();
    return { id, offHours: offHours(req.user, d) };
  });
  app.put('/api/bookings/:id', { preHandler: auth() }, async (req: any, reply) => {
    const k = db.prepare('SELECT * FROM bookings WHERE id=?').get(+req.params.id) as any;
    if (!k) return reply.code(404).send({ error: 'not found' });
    if (k.user_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'not your booking' });
    const p = BookingIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const d = p.data;
    const was = lockFor(k.batch_id, k.equipment_id);
    if (was) return reply.code(423).send({ error: was });
    const no = check(req, reply, d, k.id);
    if (no) return no;
    db.prepare(
      'UPDATE bookings SET equipment_id=?,batch_id=?,purpose=?,step=?,note=?,start=?,end=?,forced=? WHERE id=?',
    ).run(
      d.equipment_id,
      d.batch_id || null,
      d.batch_id ? '' : (d.purpose ?? ''),
      d.batch_id ? (d.step ?? '') : '',
      d.note ?? '',
      d.start,
      d.end,
      d.force ? 1 : 0,
      k.id,
    );
    startDueBatches();
    return { ok: true, offHours: offHours(req.user, d, k) };
  });
  app.delete('/api/bookings/:id', { preHandler: auth() }, async (req: any, reply) => {
    const k = db.prepare('SELECT user_id,batch_id,equipment_id FROM bookings WHERE id=?').get(+req.params.id) as any;
    if (!k) return reply.code(404).send({ error: 'not found' });
    if (k.user_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'not your booking' });
    const lk = lockFor(k.batch_id, k.equipment_id);
    if (lk) return reply.code(423).send({ error: lk });
    db.prepare('DELETE FROM bookings WHERE id=?').run(+req.params.id);
    return { ok: true };
  });
}
