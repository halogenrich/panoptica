import type { FastifyInstance } from 'fastify';
import { BookingIn, EquipmentIn, OrderIn, OutcomeIn, ScheduleIn } from '@psc/schema';
import { tx } from './db.js';
import { db } from './db.js';
import { notify } from './social.js';
import { lockedById, markDone } from './batchlock.js';

/**
 * Equipment calendar. Every booking belongs to one of the user's Planned (or already Running) batches; when the first booked step of a batch starts,
 * the batch switches to Running by itself. Bookings of the same equipment cannot overlap, unless an admin books anyway.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS equipment(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, color TEXT NOT NULL DEFAULT '#2563eb',
  place TEXT NOT NULL DEFAULT '', pos INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS bookings(
  id INTEGER PRIMARY KEY, equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE, batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id), step TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  start TEXT NOT NULL, end TEXT NOT NULL, forced INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS bookings_time ON bookings(start, end);
`);
// 0.22.1: what each equipment is used for (the batch scheduler picks by this), and the outcome of each booking once it has ended
const ecols = (db.prepare('PRAGMA table_info(equipment)').all() as { name: string }[]).map((c) => c.name);
if (!ecols.includes('role')) db.exec("ALTER TABLE equipment ADD COLUMN role TEXT NOT NULL DEFAULT ''");
const bcols = (db.prepare('PRAGMA table_info(bookings)').all() as { name: string }[]).map((c) => c.name);
if (!bcols.includes('outcome')) {
  db.exec('ALTER TABLE bookings ADD COLUMN outcome TEXT');
  db.exec("ALTER TABLE bookings ADD COLUMN reason TEXT NOT NULL DEFAULT ''");
  db.exec('ALTER TABLE bookings ADD COLUMN outcome_at TEXT');
  db.exec('ALTER TABLE bookings ADD COLUMN outcome_by INTEGER REFERENCES users(id)');
}
/** The glovebox equipment the scheduler needs, by role; created, or renamed from the first defaults, once. */
const GB: [string, string, string, string?][] = [
  ['scale', 'GB: Scale', '#0d9488'],
  ['spinner', 'GB: Spinner', '#7c3aed', 'Spin coater (glovebox)'],
  ['organic', 'GB: Minivap (Organic Evaporator)', '#2563eb'],
  ['metal', 'GB: Metal Evaporator', '#b45309', 'Thermal evaporator'],
];
if (!db.prepare("SELECT 1 FROM meta WHERE key='gb-equipment'").get()) {
  for (const [role, name, color, old] of GB) {
    const ex = (old && db.prepare('SELECT id FROM equipment WHERE name=?').get(old)) as { id: number } | undefined;
    if (ex) db.prepare('UPDATE equipment SET name=?, role=? WHERE id=?').run(name, role, ex.id);
    else if (!db.prepare('SELECT 1 FROM equipment WHERE name=?').get(name))
      db.prepare(
        'INSERT INTO equipment(name,color,role,pos) VALUES(?,?,?,(SELECT COALESCE(MAX(pos),0)+1 FROM equipment))',
      ).run(name, color, role);
  }
  db.prepare("INSERT INTO meta(key,value) VALUES('gb-equipment',?)").run(new Date().toISOString());
}
// 0.31: minutes the equipment is blocked after each booking to clean it (gloveboxes: 20), so the next person finds it clean
if (!ecols.includes('cleanup')) {
  db.exec('ALTER TABLE equipment ADD COLUMN cleanup INTEGER NOT NULL DEFAULT 0');
  db.exec("UPDATE equipment SET cleanup=20 WHERE name LIKE 'GB:%'");
}
// 0.32: the UV-ozone cleaner does the substrate preparation in the batch scheduler (once; admins can change it under Equipment)
if (!db.prepare("SELECT 1 FROM meta WHERE key='prep-equipment'").get()) {
  db.exec(
    "UPDATE equipment SET role='prep' WHERE role='' AND (name LIKE '%UV-ozone%' OR name LIKE '%UV ozone%' OR name LIKE '%UVO%')",
  );
  db.prepare("INSERT INTO meta(key,value) VALUES('prep-equipment',?)").run(new Date().toISOString());
}
/** Shortest booking, in minutes. */
export const MIN_BOOKING = 60;
// times are compared as text, so every stored time must be UTC ISO (…Z)
for (const r of db
  .prepare("SELECT id,start,end FROM bookings WHERE start NOT LIKE '%Z' OR end NOT LIKE '%Z'")
  .all() as any[])
  db.prepare('UPDATE bookings SET start=?, end=? WHERE id=?').run(
    new Date(r.start).toISOString(),
    new Date(r.end).toISOString(),
    r.id,
  );
if (!db.prepare('SELECT 1 FROM equipment LIMIT 1').get()) {
  const ins = db.prepare('INSERT INTO equipment(name,color,pos) VALUES(?,?,?)');
  [
    ['Solar simulator (J–V)', '#dc2626'],
    ['UV-ozone cleaner', '#0891b2'],
  ].forEach(([n, c], i) => ins.run(n, c, i));
}

type U = { id: number; name: string; role: string; manager?: boolean };
const minutes = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 6e4;
const after = (t: string, min: number) => new Date(new Date(t).getTime() + min * 6e4).toISOString();
const before = (t: string, min: number) => after(t, -min);
const cleanupOf = (eq: number) =>
  (db.prepare('SELECT cleanup FROM equipment WHERE id=?').get(eq) as { cleanup: number } | undefined)?.cleanup ?? 0;
const ROW = `SELECT k.*, e.name AS equipment, e.color, b.code AS batch_code, b.name AS batch_name, b.status AS batch_status, u.name AS user_name, u.photo_v AS photoV
  FROM bookings k JOIN equipment e ON e.id=k.equipment_id JOIN batches b ON b.id=k.batch_id JOIN users u ON u.id=k.user_id`;
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
  const b = db.prepare('SELECT status, code, owner_id FROM batches WHERE id=?').get(id) as any;
  const ks = db.prepare('SELECT outcome FROM bookings WHERE batch_id=?').all(id) as { outcome: string | null }[];
  if (!b || b.status === 'done' || !ks.length || ks.some((k) => !k.outcome || k.outcome === 'postponed')) return;
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
            ' WHERE k.outcome IS NULL AND k.end <= ? AND b.deleted_at IS NULL AND (k.user_id=? OR b.owner_id=?) ORDER BY k.start',
        )
        .all(new Date().toISOString(), req.user.id, req.user.id) as any[]
    ).map((r) => out(r, req.user)),
  );
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
      ? `${x.equipment} is booked by ${x.user_name} for batch ${x.batch_code} at that time`
      : `${x.equipment} needs ${cleanupOf(x.equipment_id)} min of cleanup between bookings, and this is too close to the booking of ${x.user_name} (batch ${x.batch_code})`;

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
      if (!(it.end > it.start))
        return reply.code(400).send({ error: `${it.step}: the end must be after the start`, index: i });
      if (minutes(it.start, it.end) < MIN_BOOKING)
        return reply.code(400).send({ error: `${it.step}: a booking is at least 1 hour`, index: i });
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
          "DELETE FROM bookings WHERE batch_id=? AND outcome IS NULL AND start > ? AND equipment_id IN (SELECT id FROM equipment WHERE role<>'')",
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
      equipment: db.prepare('SELECT * FROM equipment ORDER BY pos, id').all(),
      bookings: (rows as any[]).map((r) => out(r, req.user)),
      // the batches this user can book for
      batches: db
        .prepare(
          "SELECT id, code, name, status FROM batches WHERE owner_id=? AND status IN ('planned','running') AND deleted_at IS NULL ORDER BY status DESC, id DESC",
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
    const b = db
      .prepare('SELECT owner_id, status FROM batches WHERE id=? AND deleted_at IS NULL')
      .get(d.batch_id) as any;
    if (!b) return reply.code(400).send({ error: 'choose one of your batches' });
    if (b.owner_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'you can only book for your own batches' });
    if (!id && b.status === 'done')
      return reply.code(400).send({ error: 'this batch is done; book for a Planned or Running batch' });
    const lk = lockedById(d.batch_id);
    if (lk) return reply.code(423).send({ error: lk });
    if (!(new Date(d.end) > new Date(d.start)))
      return reply.code(400).send({ error: 'the end must be after the start' });
    if (minutes(d.start, d.end) < MIN_BOOKING) return reply.code(400).send({ error: 'a booking is at least 1 hour' });
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
          'INSERT INTO bookings(equipment_id,batch_id,user_id,step,note,start,end,forced) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(d.equipment_id, d.batch_id, req.user.id, d.step ?? '', d.note ?? '', d.start, d.end, d.force ? 1 : 0)
        .lastInsertRowid,
    );
    startDueBatches();
    return { id };
  });
  app.put('/api/bookings/:id', { preHandler: auth() }, async (req: any, reply) => {
    const k = db.prepare('SELECT * FROM bookings WHERE id=?').get(+req.params.id) as any;
    if (!k) return reply.code(404).send({ error: 'not found' });
    if (k.user_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'not your booking' });
    const p = BookingIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const d = p.data;
    const was = lockedById(k.batch_id);
    if (was) return reply.code(423).send({ error: was });
    const no = check(req, reply, d, k.id);
    if (no) return no;
    db.prepare('UPDATE bookings SET equipment_id=?,batch_id=?,step=?,note=?,start=?,end=?,forced=? WHERE id=?').run(
      d.equipment_id,
      d.batch_id,
      d.step ?? '',
      d.note ?? '',
      d.start,
      d.end,
      d.force ? 1 : 0,
      k.id,
    );
    startDueBatches();
    return { ok: true };
  });
  app.delete('/api/bookings/:id', { preHandler: auth() }, async (req: any, reply) => {
    const k = db.prepare('SELECT user_id,batch_id FROM bookings WHERE id=?').get(+req.params.id) as any;
    if (!k) return reply.code(404).send({ error: 'not found' });
    if (k.user_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'not your booking' });
    const lk = lockedById(k.batch_id);
    if (lk) return reply.code(423).send({ error: lk });
    db.prepare('DELETE FROM bookings WHERE id=?').run(+req.params.id);
    return { ok: true };
  });

  // ---- equipment: admins ----
  app.post('/api/equipment', { preHandler: auth(true) }, async (req: any, reply) => {
    const p = EquipmentIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    try {
      return {
        id: Number(
          db
            .prepare(
              'INSERT INTO equipment(name,color,place,role,cleanup,pos) VALUES(?,?,?,?,?,(SELECT COALESCE(MAX(pos),0)+1 FROM equipment))',
            )
            .run(
              p.data.name,
              p.data.color ?? '#2563eb',
              p.data.place ?? '',
              p.data.role ?? '',
              p.data.cleanup ?? (/^GB:/i.test(p.data.name) ? 20 : 0), // gloveboxes are cleaned after each use
            ).lastInsertRowid,
        ),
      };
    } catch {
      return reply.code(409).send({ error: 'this equipment already exists' });
    }
  });
  /** Equipment in a new order: the order of the Day view's columns, the filter and the pickers. */
  app.put('/api/equipment/order', { preHandler: auth(true) }, async (req: any, reply) => {
    const p = OrderIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const up = db.prepare('UPDATE equipment SET pos=? WHERE id=?');
    tx(() => p.data.ids.forEach((id, i) => up.run(i, id)));
    return { ok: true };
  });
  app.patch('/api/equipment/:id', { preHandler: auth(true) }, async (req: any, reply) => {
    const p = EquipmentIn.partial().safeParse(req.body);
    if (!p.success) return bad(reply, p);
    try {
      for (const k of ['name', 'color', 'place', 'role', 'cleanup'] as const)
        if (p.data[k] !== undefined)
          db.prepare(`UPDATE equipment SET ${k}=? WHERE id=?`).run(p.data[k]!, +req.params.id);
      if (p.data.active !== undefined)
        db.prepare('UPDATE equipment SET active=? WHERE id=?').run(p.data.active ? 1 : 0, +req.params.id);
      return { ok: true };
    } catch {
      return reply.code(409).send({ error: 'this equipment already exists' });
    }
  });
  app.delete('/api/equipment/:id', { preHandler: auth(true) }, async (req: any, reply) => {
    const n = (
      db
        .prepare('SELECT COUNT(*) AS n FROM bookings WHERE equipment_id=? AND end > ?')
        .get(+req.params.id, new Date().toISOString()) as any
    ).n;
    if (n)
      return reply.code(400).send({
        error: `${n} upcoming booking${n === 1 ? '' : 's'}; hide the equipment instead, or remove the bookings first`,
      });
    db.prepare('DELETE FROM equipment WHERE id=?').run(+req.params.id);
    return { ok: true };
  });
}
