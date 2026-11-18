import type { FastifyInstance } from 'fastify';
import { AtmoIn, BookingIn, OutcomeIn } from '@psc/schema';
import { bookingRefusal, equipmentList, minBookingOf, offDuring } from './equipment.js';
import { db } from './db.js';
import { notify } from './social.js';
import { withinHours } from '@psc/core';
import { lab } from './lab.js';
import { measuring, stepDefs, subject, subjects, type EqFacts, type SubjectInfo, type Who } from './modules.js';

/**
 * Equipment calendar (core). A booking is for a subject a module defines (the Electronic Devices module: a batch; 0.41), or for
 * nothing but a stated purpose. The calendar only knows subjects through the module registry (modules.ts): who owns one, whether
 * it can be booked for, whether it is locked, whether an outcome is asked when a booking ends. Measuring equipment (a step
 * flagged `measures`, J–V measurement say) takes finished subjects or a purpose and asks no outcome. Bookings of the same
 * equipment cannot overlap, cleanup included, unless an admin books anyway.
 */

/** dd/mm HH:MM, in the lab's (this computer's) time. */
const dm = (iso: string) => {
  const d = new Date(iso),
    z = (n: number) => String(n).padStart(2, '0');
  return `${z(d.getDate())}/${z(d.getMonth() + 1)} ${z(d.getHours())}:${z(d.getMinutes())}`;
};
/** 90 → "1 h 30", 60 → "1 hour", 45 → "45 min". */
export const hm = (m: number) =>
  m === 60 ? '1 hour' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`;
/** Bookings start from now on: a minute of grace for the time a drop takes. */
export const PAST_GRACE = 60_000;
export const minutes = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 6e4;
export const after = (t: string, min: number) => new Date(new Date(t).getTime() + min * 6e4).toISOString();
const before = (t: string, min: number) => after(t, -min);
export const cleanupOf = (eq: number) =>
  (db.prepare('SELECT cleanup FROM equipment WHERE id=?').get(eq) as { cleanup: number } | undefined)?.cleanup ?? 0;

/** What a subject sees of an equipment. */
export function eqFacts(eq: number): EqFacts | null {
  const e = db.prepare('SELECT id, name, steps FROM equipment WHERE id=?').get(eq) as any;
  return e ? { id: e.id, name: e.name, measuring: measuring(JSON.parse(e.steps || '[]')) } : null;
}
const factsOf = (r: any): EqFacts => ({
  id: r.equipment_id,
  name: r.equipment,
  measuring: measuring(JSON.parse(r.eq_steps || '[]')),
});

/** Atmosphere is asked for bookings that ended after the release that started recording it (0.38), not for older ones. */
const ATMO_SINCE = (() => {
  const r = db.prepare("SELECT value FROM meta WHERE key='atmo-since'").get() as { value: string } | undefined;
  if (r) return r.value;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO meta(key,value) VALUES('atmo-since',?)").run(now);
  return now;
})();

export const ROW = `SELECT k.*, e.name AS equipment, e.color, e.atmosphere, e.steps AS eq_steps, u.name AS user_name, u.photo_v AS photoV
  FROM bookings k JOIN equipment e ON e.id=k.equipment_id JOIN users u ON u.id=k.user_id`;
/**
 * Bookings with their subject's code, name, status and owner (from its module), without those whose subject is gone (deleted, or
 * in the trash).
 */
export function withSubjects(rows: any[]): any[] {
  const byKind = new Map<string, number[]>();
  for (const r of rows) if (r.subject) byKind.set(r.subject, [...(byKind.get(r.subject) ?? []), r.subject_id]);
  const info = new Map<string, Map<number, SubjectInfo>>();
  for (const [k, ids] of byKind) info.set(k, subject(k)?.info([...new Set(ids)]) ?? new Map());
  const out: any[] = [];
  for (const r of rows) {
    if (!r.subject) {
      out.push({ ...r, subject_code: '', subject_name: '', subject_status: '', subject_owner: null, subject_noun: '' });
      continue;
    }
    const i = info.get(r.subject)?.get(r.subject_id);
    if (!i || i.gone) continue;
    out.push({
      ...r,
      subject_code: i.code,
      subject_name: i.name,
      subject_status: i.status,
      subject_owner: i.owner_id,
      subject_noun: subject(r.subject)!.noun,
    });
  }
  return out;
}
const out = (r: any, u: Who) => {
  const { eq_steps, ...rest } = r;
  return {
    ...rest,
    measuring: measuring(JSON.parse(eq_steps || '[]')),
    forced: !!r.forced,
    mine: r.user_id === u.id,
    editable: r.user_id === u.id || u.role === 'admin',
  };
};
/** What a booking is for, in words: its subject ("batch B-…"), or the purpose given for a booking outside one. */
const forWhat = (x: any) => (x.subject ? `${x.subject_noun} ${x.subject_code}` : x.purpose || 'another use');
/** All registered subjects: bookings were added or moved, or time passed. */
export const tickSubjects = () => subjects().forEach((s) => s.tick());

/**
 * Bookings outside the lab's working days and hours are allowed, and the admins are told (0.36). A move only tells them when
 * the booking was inside the hours before.
 */
function offHours(
  by: { id: number; name: string },
  d: {
    equipment_id: number;
    subject?: string;
    subject_id?: number | null;
    purpose?: string;
    start: string;
    end: string;
  },
  was?: { start: string; end: string },
) {
  const h = lab().hours,
    out = !withinHours(h, new Date(d.start), new Date(d.end));
  if (!out || (was && !withinHours(h, new Date(was.start), new Date(was.end)))) return out;
  const eq = db.prepare('SELECT name FROM equipment WHERE id=?').get(d.equipment_id) as { name: string } | undefined;
  const sub = d.subject && d.subject_id ? subject(d.subject) : undefined,
    code = sub?.info([d.subject_id!]).get(d.subject_id!)?.code;
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
    `${by.name} booked ${eq?.name ?? 'equipment'} outside working hours: ${dm(d.start)}–${dm(d.end).slice(6)}${sub && code ? ` (${sub.noun} ${code})` : d.purpose ? ` (${d.purpose})` : ''}`,
    { view: 'calendar', id: 0 },
    by.name,
  );
  return out;
}

export const capacityOf = (eq: number) =>
  (db.prepare('SELECT capacity FROM equipment WHERE id=?').get(eq) as { capacity: number } | undefined)?.capacity ?? 1;

/**
 * The bookings a new one from start to end would be one too many with, other than `except` (empty: it fits). The cleanup time
 * after each booking counts as taken: a booking cannot start during the cleanup of the one before, nor end so late that its own
 * cleanup runs into the next. Equipment several people use at once (0.60.1, "people at the same time") takes that many
 * overlapping bookings: it clashes only where that many already overlap one another and the new one.
 */
export const clashes = (eq: number, start: string, end: string, except = 0) => {
  const cl = cleanupOf(eq),
    cap = capacityOf(eq);
  const near = withSubjects(
    db
      .prepare(ROW + ' WHERE k.equipment_id=? AND k.end > ? AND k.start < ? AND k.id<>?')
      .all(eq, before(start, cl), after(end, cl), except) as any[],
  );
  if (near.length < cap) return [];
  // each booking holds a place from its start to the end of its cleanup; find a moment in the new one's span where all are taken
  const a = new Date(start).getTime(),
    z = new Date(after(end, cl)).getTime(),
    span = (k: any) => [new Date(k.start).getTime(), new Date(after(k.end, cl)).getTime()] as const;
  const moments = [a, ...near.map((k) => span(k)[0]).filter((t) => t > a && t < z)];
  for (const t of moments) {
    const at = near.filter((k) => {
      const [s0, s1] = span(k);
      return s0 <= t && s1 > t;
    });
    if (at.length >= cap) return at;
  }
  return [];
};
export const clashText = (x: any, start: string, end: string) => {
  const cap = capacityOf(x.equipment_id);
  if (cap > 1) return `${x.equipment} already has ${cap} people booked at that time`;
  return x.end > start && x.start < end
    ? `${x.equipment} is booked by ${x.user_name} for ${forWhat(x)} at that time`
    : `${x.equipment} needs ${cleanupOf(x.equipment_id)} min of cleanup between bookings, and this is too close to the booking of ${x.user_name} (${forWhat(x)})`;
};
/**
 * Why `u` cannot book equipment `eq` from start to end (null when they can): bookable and trained, in the future, longer than
 * the equipment's shortest booking, not while it is out of service. Overlaps are checked separately (clashes).
 */
export function slotProblem(u: Who, eq: number, start: string, end: string): { status: number; error: string } | null {
  if (new Date(start).getTime() < Date.now() - PAST_GRACE) return { status: 400, error: 'that time has passed' };
  if (!(end > start)) return { status: 400, error: 'the end must be after the start' };
  if (minutes(start, end) < minBookingOf(eq))
    return { status: 400, error: `a booking is at least ${hm(minBookingOf(eq))}` };
  const no = bookingRefusal(u, eq);
  if (no) return { status: 403, error: no };
  if (offDuring(eq, start, end).length) return { status: 409, error: 'the equipment is out of service then' };
  return null;
}

/** The nouns of the subjects, for messages ("batch", "batch or sample"; "batches"). */
const nouns = () =>
  subjects()
    .map((s) => s.noun)
    .join(' or ') || 'subject';
const plurals = () =>
  subjects()
    .map((s) => s.plural)
    .join(' or ') || 'subjects';

export function registerCalendar(app: FastifyInstance, auth: (need?: any) => any, bad: (reply: any, p: any) => any) {
  setInterval(tickSubjects, 60_000).unref?.();

  /**
   * Ended bookings that still need something from this person: the outcome, for bookings of a subject that asks one (booked by
   * them or for a subject they own); and (0.38) O₂ and H₂O, for their bookings of equipment that records its atmosphere.
   */
  app.get('/api/bookings/pending', { preHandler: auth() }, async (req: any) => {
    const me = req.user.id;
    const rows = withSubjects(
      db
        .prepare(
          ROW +
            ` WHERE k.end <= ? AND ((k.outcome IS NULL AND k.subject<>'')
              OR (e.atmosphere=1 AND k.atmo='' AND k.user_id=? AND k.end > ?)) ORDER BY k.start`,
        )
        .all(new Date().toISOString(), me, ATMO_SINCE) as any[],
    );
    const res: any[] = [];
    for (const r of rows) {
      const eq = factsOf(r),
        asks = !!r.subject && !!subject(r.subject)?.asksOutcome(eq);
      const outcome = !r.outcome && asks && (r.user_id === me || r.subject_owner === me);
      const atmo = !!r.atmosphere && !r.atmo && r.user_id === me && r.end > ATMO_SINCE && (!asks || !!r.outcome);
      if (outcome || atmo) res.push({ ...out(r, req.user), atmoOnly: !outcome });
    }
    return res;
  });
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
    const [k] = withSubjects([db.prepare(ROW + ' WHERE k.id=?').get(+req.params.id)].filter(Boolean) as any[]);
    const sub = k?.subject ? subject(k.subject) : undefined;
    if (!k || !sub) return reply.code(404).send({ error: 'not found' });
    if (k.user_id !== req.user.id && k.subject_owner !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'not your booking' });
    const lk = sub.locked(k.subject_id, factsOf(k));
    if (lk) return reply.code(423).send({ error: lk });
    const p = OutcomeIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    if (k.atmosphere && p.data.outcome === 'done' && !p.data.atmo && !k.atmo)
      return reply.code(400).send({ error: 'write down the O₂ and H₂O of the glovebox (ppm)' });
    if (p.data.atmo) db.prepare('UPDATE bookings SET atmo=? WHERE id=?').run(JSON.stringify(p.data.atmo), k.id);
    db.prepare('UPDATE bookings SET outcome=?, reason=?, outcome_at=?, outcome_by=? WHERE id=?').run(
      p.data.outcome,
      p.data.reason ?? '',
      new Date().toISOString(),
      req.user.id,
      k.id,
    );
    sub.outcomeGiven(k.subject_id);
    return { ok: true };
  });

  app.get('/api/calendar', { preHandler: auth() }, async (req: any) => {
    tickSubjects();
    const q = (v: unknown) => {
      const d = new Date(String(v ?? ''));
      return Number.isNaN(d.getTime()) ? '' : d.toISOString();
    };
    const from = q(req.query.from),
      to = q(req.query.to);
    const rows =
      from && to
        ? withSubjects(db.prepare(ROW + ' WHERE k.end > ? AND k.start < ? ORDER BY k.start').all(from, to) as any[])
        : [];
    // what this person can book for, from every module: open subjects, and finished ones for measuring equipment
    const open: any[] = [],
      finished: any[] = [];
    for (const s of subjects()) {
      const c = s.choices(req.user);
      open.push(...c.open.map((x) => ({ ...x, subject: s.kind, noun: s.noun })));
      finished.push(...c.finished.map((x) => ({ ...x, subject: s.kind, noun: s.noun })));
    }
    return {
      equipment: equipmentList(),
      steps: stepDefs(),
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
      bookings: rows.map((r) => out(r, req.user)),
      open,
      finished,
      // what bookings can be for, from the modules (0.43): its name, the page it opens on, a hint when there is none
      subjects: subjects().map((s) => ({
        kind: s.kind,
        noun: s.noun,
        plural: s.plural,
        view: s.view ?? null,
        hint: s.hint ?? '',
        steps: !!s.steps,
      })),
    };
  });
  /** The steps of something bookings are for (a batch's layers), offered in the booking form. */
  app.get('/api/subjects/:kind/:id/steps', { preHandler: auth() }, async (req: any, reply) => {
    const s = subject(req.params.kind);
    if (!s?.steps) return reply.code(404).send({ error: 'not found' });
    return s.steps(req.user, +req.params.id);
  });

  const check = (req: any, reply: any, d: any, id = 0) => {
    const e = eqFacts(d.equipment_id);
    if (!e) return reply.code(400).send({ error: 'choose the equipment' });
    // trained on it (admins need not be), and it is booked by itself (not inside other equipment)
    const no = bookingRefusal(req.user, d.equipment_id);
    if (no) return reply.code(403).send({ error: no });
    // bookings start from now on; a booking that has begun keeps its start (its end can still move, but not into the past)
    const was = id ? (db.prepare('SELECT start, end FROM bookings WHERE id=?').get(id) as any) : null;
    const gone = (t: string) => new Date(t).getTime() < Date.now() - PAST_GRACE;
    if ((gone(d.start) && (!was || was.start !== d.start)) || (gone(d.end) && (!was || was.end !== d.end)))
      return reply.code(400).send({ error: 'that time has passed: bookings start from now on' });
    if (!d.subject) {
      if (!d.purpose)
        return reply.code(400).send({
          error: e.measuring
            ? `say why ${e.name} is booked, or choose a finished ${nouns()}`
            : `say what the booking is for, or choose one of your ${plurals()}`,
        });
    } else {
      const sub = subject(d.subject);
      if (!sub) return reply.code(400).send({ error: 'choose what the booking is for' });
      const r = sub.refuse(req.user, d.subject_id, e, !id);
      if (r) return reply.code(r.status).send({ error: r.error });
      const lk = sub.locked(d.subject_id, e);
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
      return reply.code(409).send({ error: clashText(x, d.start, d.end), clash: out(x, req.user) });
    }
    return null;
  };
  /** The current booking's subject lock, before it is changed or removed. */
  const lockOf = (k: any) => {
    const sub = k.subject ? subject(k.subject) : undefined,
      e = eqFacts(k.equipment_id);
    return sub && e ? sub.locked(k.subject_id, e) : null;
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
          'INSERT INTO bookings(equipment_id,subject,subject_id,purpose,user_id,step,note,start,end,forced) VALUES(?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          d.equipment_id,
          d.subject ?? '',
          d.subject ? d.subject_id! : null,
          d.subject ? '' : (d.purpose ?? ''),
          req.user.id,
          d.subject ? (d.step ?? '') : '',
          d.note ?? '',
          d.start,
          d.end,
          d.force ? 1 : 0,
        ).lastInsertRowid,
    );
    tickSubjects();
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
    const was = lockOf(k);
    if (was) return reply.code(423).send({ error: was });
    const no = check(req, reply, d, k.id);
    if (no) return no;
    db.prepare(
      'UPDATE bookings SET equipment_id=?,subject=?,subject_id=?,purpose=?,step=?,note=?,start=?,end=?,forced=? WHERE id=?',
    ).run(
      d.equipment_id,
      d.subject ?? '',
      d.subject ? d.subject_id! : null,
      d.subject ? '' : (d.purpose ?? ''),
      d.subject ? (d.step ?? '') : '',
      d.note ?? '',
      d.start,
      d.end,
      d.force ? 1 : 0,
      k.id,
    );
    tickSubjects();
    return { ok: true, offHours: offHours(req.user, d, k) };
  });
  app.delete('/api/bookings/:id', { preHandler: auth() }, async (req: any, reply) => {
    const k = db.prepare('SELECT * FROM bookings WHERE id=?').get(+req.params.id) as any;
    if (!k) return reply.code(404).send({ error: 'not found' });
    if (k.user_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'not your booking' });
    const lk = lockOf(k);
    if (lk) return reply.code(423).send({ error: lk });
    db.prepare('DELETE FROM bookings WHERE id=?').run(+req.params.id);
    return { ok: true };
  });
}

/** Re-exported for the modules: the person type and equipment facts. */
export type { Who, EqFacts };
/** A booking row joined with its equipment and person, for a module's own queries. */
export const bookingsWhere = (where: string, ...args: any[]) =>
  withSubjects(db.prepare(ROW + ' WHERE ' + where).all(...args) as any[]);
export const bookingOut = out;
