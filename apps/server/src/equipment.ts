import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { EquipmentIn, EquipmentRole } from '@psc/schema';
import { STEP_KEYS, roleFromSteps, stepsFromRole, wouldLoop } from '@psc/core';
import { db, tx } from './db.js';
import { notify } from './social.js';

/**
 * 0.38: the lab as a map of places and equipment. Equipment can hold other equipment (a glovebox and what is inside it), says
 * which recipe steps it can do, whether it is booked, how long a booking is at least, whether its atmosphere (O₂, H₂O) is
 * recorded after each booking, who is responsible for it and who is trained on it. Moves keep their history, so a batch keeps
 * where each step was done at the time.
 *
 * Rights: admins and the Equipment management permission manage everything; an equipment's responsible people change its
 * settings, move it, train people on it and set it out of service; the Equipment training permission trains people on any
 * equipment. Booking needs training on the booked equipment (admins excepted, so the lab is never locked out).
 */

type U = { id: number; name: string; role: string; equipment?: boolean; training?: boolean };
const isAdmin = (u: U) => u.role === 'admin';
export const responsible = (eq: number, uid: number) =>
  !!db.prepare('SELECT 1 FROM equipment_people WHERE equipment_id=? AND user_id=?').get(eq, uid);
/** Manage every equipment: add, remove, everything. */
export const canManage = (u: U) => isAdmin(u) || !!u.equipment;
/** Change one equipment's settings, move it, set it out of service. */
export const canEdit = (u: U, eq: number) => canManage(u) || responsible(eq, u.id);
/** Train people on it. */
export const canTrain = (u: U, eq: number) => canEdit(u, eq) || !!u.training;
export const isTrained = (eq: number, uid: number) =>
  !!db.prepare('SELECT 1 FROM equipment_training WHERE equipment_id=? AND user_id=?').get(eq, uid);
/** Shortest booking of an equipment, in minutes (60 unless set). */
export const minBookingOf = (eq: number) =>
  (db.prepare('SELECT min_booking FROM equipment WHERE id=?').get(eq) as { min_booking: number } | undefined)
    ?.min_booking ?? 60;
/** Out-of-service periods of an equipment overlapping a time. */
export const offDuring = (eq: number, start: string, end: string) =>
  db
    .prepare('SELECT * FROM equipment_off WHERE equipment_id=? AND end > ? AND start < ? ORDER BY start')
    .all(eq, start, end) as { id: number; start: string; end: string; reason: string }[];
/**
 * Why `u` cannot book `eq` (null when they can): it must be bookable, and they must be trained on it (admins need not be).
 */
export function bookingRefusal(u: U, eq: number): string | null {
  const e = db.prepare('SELECT name, booked, active FROM equipment WHERE id=?').get(eq) as any;
  if (!e) return 'choose the equipment';
  if (!e.booked) return `${e.name} is not booked: it is used inside other equipment or freely`;
  if (!isAdmin(u) && !isTrained(eq, u.id)) {
    const who = (
      db
        .prepare(
          'SELECT u.name FROM equipment_people p JOIN users u ON u.id=p.user_id WHERE p.equipment_id=? AND u.deleted=0 ORDER BY u.name',
        )
        .all(eq) as { name: string }[]
    ).map((r) => r.name);
    return `you are not trained on ${e.name} yet${who.length ? `; ask ${who.join(' or ')}` : '; ask an admin'}`;
  }
  return null;
}

const Steps = z.array(z.enum(STEP_KEYS as [string, ...string[]])).max(STEP_KEYS.length);
const EqPatch = z.object({
  name: z.string().trim().min(1, 'name the equipment').max(80).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  art: EquipmentIn.shape.art, // one of the drawings
  active: z.boolean().optional(),
  booked: z.boolean().optional(),
  atmosphere: z.boolean().optional(),
  cleanup: z.number().int().min(0).max(240).optional(),
  min_booking: z
    .number()
    .int()
    .min(15)
    .max(24 * 60)
    .optional(),
  steps: Steps.optional(),
});
const EqNew = EqPatch.extend({
  name: z.string().trim().min(1, 'name the equipment').max(80),
  /** before 0.38: one procedure instead of steps (still accepted from the API) */
  role: EquipmentRole.optional(),
  place_id: z.number().int().nullable().optional(),
  parent_id: z.number().int().nullable().optional(),
});
const MoveIn = z.object({ place_id: z.number().int().nullable(), parent_id: z.number().int().nullable() });
const OffIn = z.object({
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  reason: z.string().trim().max(200).default(''),
});

/** One equipment as the app shows it. */
function rowOut(e: any) {
  const steps: string[] = JSON.parse(e.steps || '[]');
  return {
    ...e,
    steps,
    booked: !!e.booked,
    atmosphere: !!e.atmosphere,
    active: !!e.active,
    people: (
      db
        .prepare(
          'SELECT u.id,u.name,u.photo_v AS photoV FROM equipment_people p JOIN users u ON u.id=p.user_id WHERE p.equipment_id=? AND u.deleted=0 ORDER BY u.name',
        )
        .all(e.id) as any[]
    ).map((p) => ({ ...p })),
    trainedCount: (
      db.prepare('SELECT COUNT(*) AS n FROM equipment_training WHERE equipment_id=?').get(e.id) as { n: number }
    ).n,
  };
}
export const equipmentList = () => (db.prepare('SELECT * FROM equipment ORDER BY pos, id').all() as any[]).map(rowOut);

export function registerEquipment(app: FastifyInstance, auth: (need?: any) => any, bad: (reply: any, p: any) => any) {
  const placeOf = (id: number) => db.prepare('SELECT id FROM places WHERE id=?').get(id);
  const deny = (reply: any, what = 'only the equipment’s responsible people, Equipment management or admins') =>
    reply.code(403).send({ error: what });

  app.get('/api/equipment', { preHandler: auth() }, async (req: any) => ({
    places: db.prepare('SELECT * FROM places ORDER BY pos, name').all(),
    equipment: equipmentList(),
    trained: (
      db.prepare('SELECT equipment_id FROM equipment_training WHERE user_id=?').all(req.user.id) as {
        equipment_id: number;
      }[]
    ).map((r) => r.equipment_id),
    can: { manage: canManage(req.user) },
  }));
  /** Everything about one equipment: people, training, moves, out-of-service periods, what the viewer may change. */
  app.get('/api/equipment/:id', { preHandler: auth() }, async (req: any, reply) => {
    const id = +req.params.id,
      e = db.prepare('SELECT * FROM equipment WHERE id=?').get(id);
    if (!e) return reply.code(404).send({ error: 'not found' });
    return {
      ...rowOut(e),
      trained: db
        .prepare(
          `SELECT t.user_id AS id, u.name, u.photo_v AS photoV, t.at, t.note, b.name AS by
           FROM equipment_training t JOIN users u ON u.id=t.user_id LEFT JOIN users b ON b.id=t.by_id
           WHERE t.equipment_id=? AND u.deleted=0 ORDER BY u.name`,
        )
        .all(id),
      moves: db
        .prepare(
          `SELECT m.at, p.name AS place, q.name AS inside, u.name AS by FROM equipment_moves m
           LEFT JOIN places p ON p.id=m.place_id LEFT JOIN equipment q ON q.id=m.parent_id LEFT JOIN users u ON u.id=m.by_id
           WHERE m.equipment_id=? ORDER BY m.at DESC LIMIT 50`,
        )
        .all(id),
      off: db
        .prepare(
          'SELECT o.*, u.name AS by FROM equipment_off o LEFT JOIN users u ON u.id=o.by_id WHERE o.equipment_id=? AND o.end > ? ORDER BY o.start',
        )
        .all(id, new Date().toISOString()),
      can: { edit: canEdit(req.user, id), train: canTrain(req.user, id), manage: canManage(req.user) },
    };
  });

  /** The lab's people (names and photos), for choosing who is responsible for equipment or whom to train. */
  app.get('/api/people', { preHandler: auth() }, async () =>
    db
      .prepare(
        'SELECT id,name,username,photo_v AS photoV FROM users WHERE deleted=0 AND active=1 ORDER BY name COLLATE NOCASE',
      )
      .all(),
  );
  // ---- places ----
  app.post('/api/places', { preHandler: auth() }, async (req: any, reply) => {
    if (!canManage(req.user)) return deny(reply, 'only Equipment management or admins add places');
    const name = String(req.body?.name ?? '').trim();
    if (!name || name.length > 80) return reply.code(400).send({ error: 'name the place' });
    try {
      return {
        id: Number(
          db.prepare('INSERT INTO places(name,pos) VALUES(?,(SELECT COALESCE(MAX(pos),0)+1 FROM places))').run(name)
            .lastInsertRowid,
        ),
      };
    } catch {
      return reply.code(409).send({ error: 'this place already exists' });
    }
  });
  app.patch('/api/places/:id', { preHandler: auth() }, async (req: any, reply) => {
    if (!canManage(req.user)) return deny(reply);
    const name = String(req.body?.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'name the place' });
    try {
      db.prepare('UPDATE places SET name=? WHERE id=?').run(name, +req.params.id);
      return { ok: true };
    } catch {
      return reply.code(409).send({ error: 'this place already exists' });
    }
  });
  app.delete('/api/places/:id', { preHandler: auth() }, async (req: any, reply) => {
    if (!canManage(req.user)) return deny(reply);
    const n = (db.prepare('SELECT COUNT(*) AS n FROM equipment WHERE place_id=?').get(+req.params.id) as { n: number })
      .n;
    if (n) return reply.code(400).send({ error: `${n} equipment ${n === 1 ? 'is' : 'are'} there; move it first` });
    db.prepare('DELETE FROM places WHERE id=?').run(+req.params.id);
    return { ok: true };
  });

  // ---- equipment ----
  app.post('/api/equipment', { preHandler: auth() }, async (req: any, reply) => {
    if (!canManage(req.user)) return deny(reply, 'only Equipment management or admins add equipment');
    const p = EqNew.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const d = p.data;
    if (d.place_id && !placeOf(d.place_id)) return reply.code(400).send({ error: 'choose a place' });
    const steps = d.steps ?? (d.role ? stepsFromRole(d.role, d.name) : []);
    try {
      const id = Number(
        db
          .prepare(
            `INSERT INTO equipment(name,color,role,cleanup,art,steps,booked,min_booking,atmosphere,place_id,parent_id,pos)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(pos),0)+1 FROM equipment))`,
          )
          .run(
            d.name,
            d.color ?? '#2563eb',
            roleFromSteps(steps),
            d.cleanup ?? 0,
            d.art ?? '',
            JSON.stringify(steps),
            d.parent_id ? 0 : d.booked === false ? 0 : 1, // inside other equipment: booked with it
            d.min_booking ?? 60,
            d.atmosphere ? 1 : 0,
            d.parent_id ? null : (d.place_id ?? null),
            d.parent_id ?? null,
          ).lastInsertRowid,
      );
      return { id };
    } catch {
      return reply.code(409).send({ error: 'this equipment already exists' });
    }
  });
  app.patch('/api/equipment/:id', { preHandler: auth() }, async (req: any, reply) => {
    const id = +req.params.id;
    if (!canEdit(req.user, id)) return deny(reply);
    const p = EqPatch.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const d = p.data;
    try {
      tx(() => {
        for (const k of ['name', 'color', 'art', 'cleanup', 'min_booking'] as const)
          if (d[k] !== undefined) db.prepare(`UPDATE equipment SET ${k}=? WHERE id=?`).run(d[k]!, id);
        for (const k of ['active', 'booked', 'atmosphere'] as const)
          if (d[k] !== undefined) db.prepare(`UPDATE equipment SET ${k}=? WHERE id=?`).run(d[k] ? 1 : 0, id);
        if (d.steps)
          db.prepare('UPDATE equipment SET steps=?, role=? WHERE id=?').run(
            JSON.stringify([...new Set(d.steps)]),
            roleFromSteps(d.steps),
            id,
          );
      });
      return { ok: true };
    } catch {
      return reply.code(409).send({ error: 'this equipment already exists' });
    }
  });
  /** Equipment in a new order: the order of the Day view's columns, the filter and the pickers. */
  app.put('/api/equipment/order', { preHandler: auth() }, async (req: any, reply) => {
    if (!canManage(req.user)) return deny(reply);
    const ids = z.object({ ids: z.array(z.number().int()).max(500) }).safeParse(req.body);
    if (!ids.success) return bad(reply, ids);
    const up = db.prepare('UPDATE equipment SET pos=? WHERE id=?');
    tx(() => ids.data.ids.forEach((x, i) => up.run(i, x)));
    return { ok: true };
  });
  /** Move it: to a place, or inside other equipment (then it is booked with that one). Kept in its history. */
  app.post('/api/equipment/:id/move', { preHandler: auth() }, async (req: any, reply) => {
    const id = +req.params.id;
    if (!canEdit(req.user, id)) return deny(reply, 'only the equipment’s responsible people move it');
    const p = MoveIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const { place_id, parent_id } = p.data;
    if (place_id && !placeOf(place_id)) return reply.code(400).send({ error: 'choose a place' });
    if (parent_id) {
      if (!db.prepare('SELECT 1 FROM equipment WHERE id=?').get(parent_id))
        return reply.code(400).send({ error: 'choose the equipment to put it in' });
      const all = db.prepare('SELECT id, parent_id FROM equipment').all() as { id: number; parent_id: number | null }[];
      if (parent_id === id || wouldLoop(id, parent_id, all))
        return reply.code(400).send({ error: 'it cannot go inside itself or inside something it holds' });
    }
    const was = db.prepare('SELECT parent_id FROM equipment WHERE id=?').get(id) as { parent_id: number | null };
    tx(() => {
      // out of other equipment, on its own again: booked by itself
      if (!parent_id && was?.parent_id) db.prepare('UPDATE equipment SET booked=1 WHERE id=?').run(id);
      db.prepare('UPDATE equipment SET place_id=?, parent_id=? WHERE id=?').run(
        parent_id ? null : place_id,
        parent_id,
        id,
      );
      // inside other equipment it is booked with that one
      if (parent_id) db.prepare('UPDATE equipment SET booked=0 WHERE id=?').run(id);
      db.prepare('INSERT INTO equipment_moves(equipment_id,place_id,parent_id,at,by_id) VALUES(?,?,?,?,?)').run(
        id,
        parent_id ? null : place_id,
        parent_id,
        new Date().toISOString(),
        req.user.id,
      );
    });
    return { ok: true };
  });
  app.put('/api/equipment/:id/people', { preHandler: auth() }, async (req: any, reply) => {
    const id = +req.params.id;
    if (!canManage(req.user)) return deny(reply, 'only Equipment management or admins choose who is responsible');
    const p = z.object({ ids: z.array(z.number().int()).max(20) }).safeParse(req.body);
    if (!p.success) return bad(reply, p);
    tx(() => {
      db.prepare('DELETE FROM equipment_people WHERE equipment_id=?').run(id);
      const ins = db.prepare('INSERT OR IGNORE INTO equipment_people VALUES(?,?)');
      // the people responsible for an equipment are trained on it
      const tr = db.prepare(
        "INSERT OR IGNORE INTO equipment_training(equipment_id,user_id,by_id,at,note) VALUES(?,?,?,?,'responsible for it')",
      );
      for (const u of p.data.ids) {
        ins.run(id, u);
        tr.run(id, u, req.user.id, new Date().toISOString());
      }
    });
    return { ok: true };
  });
  app.post('/api/equipment/:id/training/:uid', { preHandler: auth() }, async (req: any, reply) => {
    const id = +req.params.id,
      uid = +req.params.uid;
    if (!canTrain(req.user, id)) return deny(reply, 'only the equipment’s responsible people or Equipment training');
    const e = db.prepare('SELECT name FROM equipment WHERE id=?').get(id) as { name: string } | undefined;
    if (!e || !db.prepare('SELECT 1 FROM users WHERE id=? AND deleted=0').get(uid))
      return reply.code(404).send({ error: 'not found' });
    db.prepare(
      'INSERT INTO equipment_training(equipment_id,user_id,by_id,at,note) VALUES(?,?,?,?,?) ON CONFLICT DO UPDATE SET by_id=excluded.by_id, at=excluded.at, note=excluded.note',
    ).run(id, uid, req.user.id, new Date().toISOString(), String(req.body?.note ?? '').slice(0, 200));
    if (uid !== req.user.id)
      notify([uid], 'training', `${req.user.name} marked you as trained on ${e.name}: you can book it now`, {
        view: 'cal',
        id: 0,
      });
    return { ok: true };
  });
  app.delete('/api/equipment/:id/training/:uid', { preHandler: auth() }, async (req: any, reply) => {
    const id = +req.params.id;
    if (!canTrain(req.user, id)) return deny(reply, 'only the equipment’s responsible people or Equipment training');
    db.prepare('DELETE FROM equipment_training WHERE equipment_id=? AND user_id=?').run(id, +req.params.uid);
    return { ok: true };
  });
  /** A person's training, for the user details window: every equipment, trained or not. */
  app.get('/api/users/:id/training', { preHandler: auth() }, async (req: any) => {
    const uid = +req.params.id;
    return (
      db
        .prepare(
          `SELECT e.id, e.name, e.color, e.booked, t.at, t.note, b.name AS by FROM equipment e
           LEFT JOIN equipment_training t ON t.equipment_id=e.id AND t.user_id=? LEFT JOIN users b ON b.id=t.by_id
           WHERE e.booked=1 ORDER BY e.pos, e.id`,
        )
        .all(uid) as any[]
    ).map((r) => ({ ...r, trained: !!r.at, canTrain: canTrain(req.user, r.id) }));
  });
  app.post('/api/equipment/:id/off', { preHandler: auth() }, async (req: any, reply) => {
    const id = +req.params.id;
    if (!canEdit(req.user, id)) return deny(reply);
    const p = OffIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    if (!(p.data.end > p.data.start)) return reply.code(400).send({ error: 'the end must be after the start' });
    const r = db
      .prepare('INSERT INTO equipment_off(equipment_id,start,end,reason,by_id) VALUES(?,?,?,?,?)')
      .run(id, new Date(p.data.start).toISOString(), new Date(p.data.end).toISOString(), p.data.reason, req.user.id);
    // people with bookings in that time are told
    const e = db.prepare('SELECT name FROM equipment WHERE id=?').get(id) as { name: string };
    const hit = db
      .prepare('SELECT DISTINCT user_id FROM bookings WHERE equipment_id=? AND end > ? AND start < ?')
      .all(id, p.data.start, p.data.end) as { user_id: number }[];
    notify(
      hit.map((h) => h.user_id),
      'hours',
      `${e.name} is out of service during your booking${p.data.reason ? ` (${p.data.reason})` : ''}: move it`,
      { view: 'cal', id: 0 },
      req.user.name,
    );
    return { id: Number(r.lastInsertRowid) };
  });
  app.delete('/api/equipment/off/:oid', { preHandler: auth() }, async (req: any, reply) => {
    const o = db.prepare('SELECT equipment_id FROM equipment_off WHERE id=?').get(+req.params.oid) as any;
    if (!o) return reply.code(404).send({ error: 'not found' });
    if (!canEdit(req.user, o.equipment_id)) return deny(reply);
    db.prepare('DELETE FROM equipment_off WHERE id=?').run(+req.params.oid);
    return { ok: true };
  });
  app.delete('/api/equipment/:id', { preHandler: auth() }, async (req: any, reply) => {
    if (!canManage(req.user)) return deny(reply, 'only Equipment management or admins remove equipment');
    const id = +req.params.id;
    const n = (
      db
        .prepare('SELECT COUNT(*) AS n FROM bookings WHERE equipment_id=? AND end > ?')
        .get(id, new Date().toISOString()) as any
    ).n;
    if (n)
      return reply.code(400).send({
        error: `${n} upcoming booking${n === 1 ? '' : 's'}; hide the equipment instead, or remove the bookings first`,
      });
    tx(() => {
      db.prepare('UPDATE equipment SET parent_id=NULL WHERE parent_id=?').run(id); // what was inside stays, on its own
      db.prepare('DELETE FROM equipment WHERE id=?').run(id);
    });
    return { ok: true };
  });
}
