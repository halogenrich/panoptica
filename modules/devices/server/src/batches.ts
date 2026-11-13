import type { FastifyInstance } from 'fastify';
import { BatchIn, BatchPatch, VariantsIn } from '@psc/devices/schema';
import { CORE_VERSION } from '@psc/devices';
import { canSee, db, substances, type User } from '@psc/server/api';
import { lockOf, lockText, markDone, UNLOCK_DAYS } from './batchlock.js';

/** Batches (0.43, from the core's entry file): a stack frozen when the run starts, the values recorded during it, its variants. */
const preset = (u: User, id: string) => {
  if (!id) return null;
  const r = db.prepare('SELECT name,data,owner_id,visibility FROM presets WHERE id=?').get(+id) as any;
  if (!r || !canSee(u, r)) throw new Error('a preset used in this stack is not available');
  return { name: r.name, data: JSON.parse(r.data) };
};
const batchOf = (req: any, reply: any, edit = false) => {
  const b = db
    .prepare(
      'SELECT b.*,u.name AS owner FROM batches b JOIN users u ON u.id=b.owner_id WHERE b.id=? AND b.deleted_at IS NULL',
    )
    .get(+req.params.id) as any;
  const u = req.user as User,
    editable = b && (b.owner_id === u.id || u.role === 'admin');
  if (!b || !(editable || b.visibility === 'shared')) {
    reply.code(404).send({ error: 'not found' });
    return null;
  }
  if (edit && !editable) {
    reply.code(403).send({ error: 'not your batch' });
    return null;
  }
  const lock = lockOf(b);
  if (edit && lock.locked) {
    reply.code(423).send({ error: lockText(b.code) });
    return null;
  }
  return {
    ...b,
    editable: !!editable && !lock.locked,
    snapshot: JSON.parse(b.snapshot),
    record: JSON.parse(b.record),
    variants: JSON.parse(b.variants),
    mine: b.owner_id === u.id,
    lock,
  };
};
/** Every layer's presets resolved (frozen copy of name and data); a recipe the user cannot see resolves to null. */
const resolveStack = (u: User, stack: { sl?: { a: string; b: string }[] }, strict = false) => {
  const resolved: Record<number, { a: unknown; b: unknown }> = {};
  const one = (id: string) => {
    try {
      return preset(u, id);
    } catch (e) {
      if (strict) throw e;
      return null;
    }
  };
  (stack.sl ?? []).forEach((x, i) => (resolved[i] = { a: one(x.a), b: one(x.b) }));
  return resolved;
};

/**
 * The substances as a batch freezes them (0.44): identity, roles, and the container recipes use, whose purity the masses are
 * for (its supplier and lot are kept with the batch).
 */
const frozenChems = () =>
  substances().map((c) => ({
    name: c.name,
    role: c.role,
    roles: c.roles,
    f: c.f,
    M: c.M,
    d: c.d,
    pur: c.pur,
    brand: c.brand,
    bottle: c.bottle
      ? { id: c.bottle.id, supplier: c.bottle.supplier, lot: c.bottle.lot, purity: c.bottle.purity }
      : null,
  }));

export function registerBatches(app: FastifyInstance, auth: (need?: any) => any, bad: (reply: any, p: any) => any) {
  app.get('/api/batches', { preHandler: auth() }, async (req: any) => {
    const rows = db
      .prepare(
        `SELECT b.id,b.code,b.name,b.status,b.visibility,(b.owner_id=@uid) AS mine,u.name AS owner,b.created_at,b.updated_at,b.record,
      json_extract(b.snapshot,'$.stack.arch') AS arch, b.variants, b.done_at, b.unlocked_until, json_array_length(b.snapshot,'$.stack.sl') AS total, json_extract(b.snapshot,'$.stack.thumb') AS thumb,
      (SELECT COUNT(*) FROM run_data r WHERE r.batch=b.code) AS runs,
      (SELECT COUNT(*) FROM bookings k JOIN equipment e ON e.id=k.equipment_id WHERE k.subject='batch' AND k.subject_id=b.id AND e.role<>'measure' AND COALESCE(k.outcome,'')<>'canceled') AS steps,
      (SELECT COUNT(*) FROM bookings k JOIN equipment e ON e.id=k.equipment_id WHERE k.subject='batch' AND k.subject_id=b.id AND e.role<>'measure' AND k.outcome='done') AS concluded
      FROM batches b JOIN users u ON u.id=b.owner_id
      WHERE b.deleted_at IS NULL AND (b.owner_id=@uid OR b.visibility='shared' OR @all=1) ORDER BY b.id DESC`,
      )
      .all({ uid: req.user.id, all: req.user.all ? 1 : 0 }) as any[];
    // progress follows the calendar: booked steps concluded out of booked steps (canceled ones left out)
    return rows.map(({ record: _r, done_at, unlocked_until, variants, ...r }) => ({
      ...r,
      // the variants by id and name (for linking measured samples)
      variants: ((JSON.parse(variants).list ?? []) as { id: string; name: string }[]).map((v) => ({
        id: v.id,
        name: v.name,
      })),
      locked: lockOf({ code: r.code, status: r.status, done_at, unlocked_until }).locked,
    }));
  });
  /** Run-data entries recorded under this batch's code, on any preset the user can see. */
  app.get('/api/batches/:id/runs', { preHandler: auth() }, async (req: any, reply) => {
    const b = batchOf(req, reply);
    if (!b) return;
    return (
      db
        .prepare(
          `SELECT r.id,r.preset_id,r.data,r.created_at,r.owner_id,u.name AS author,p.name AS preset,p.segment FROM run_data r
      JOIN users u ON u.id=r.owner_id JOIN presets p ON p.id=r.preset_id
      WHERE r.batch=@code AND (p.owner_id=@uid OR p.visibility='shared' OR @all=1) ORDER BY r.id`,
        )
        .all({ code: b.code, uid: req.user.id, all: req.user.all ? 1 : 0 }) as any[]
    ).map((r) => ({ ...r, ...JSON.parse(r.data), data: undefined, mine: r.owner_id === req.user.id ? 1 : 0 }));
  });
  app.get('/api/batches/:id', { preHandler: auth() }, async (req: any, reply) => batchOf(req, reply));
  /**
   * A stack with its recipes resolved as a batch would freeze them, without making a batch: comparisons read the recipes of devices
   * linked to a stack this way ("what changed" between groups).
   */
  app.get('/api/stacks/:id/snapshot', { preHandler: auth() }, async (req: any, reply) => {
    const r = db
      .prepare("SELECT * FROM presets WHERE id=? AND segment='stk' AND deleted_at IS NULL")
      .get(+req.params.id) as any;
    if (!r || !canSee(req.user, r)) return reply.code(404).send({ error: 'not found' });
    const stack = JSON.parse(r.data),
      resolved = resolveStack(req.user, stack);
    const chems = frozenChems();
    return { id: r.id, code: r.name, snapshot: { stack, resolved, chems } };
  });
  app.post('/api/batches', { preHandler: auth() }, async (req: any, reply) => {
    const p = BatchIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const resolved: Record<number, unknown> = {};
    try {
      p.data.stack.sl.forEach((x, i) => {
        resolved[i] = { a: preset(req.user, x.a), b: preset(req.user, x.b) };
      });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    const chems = frozenChems();
    // batches are started by name; the code is the next free number of the day (trashed batches keep theirs)
    let code = p.data.code.trim();
    if (!code) {
      const t = new Date(),
        day = `B-${String(t.getFullYear()).slice(2)}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}-`,
        taken = new Set(
          (db.prepare('SELECT code FROM batches WHERE code LIKE ?').all(day + '%') as { code: string }[]).map(
            (r) => r.code,
          ),
        );
      let n = 1;
      while (taken.has(day + n)) n++;
      code = day + n;
    }
    if (!p.data.name.trim() && !p.data.code.trim()) return reply.code(400).send({ error: 'give the batch a name' });
    try {
      const r = db
        .prepare('INSERT INTO batches(owner_id,code,name,visibility,snapshot) VALUES(?,?,?,?,?)')
        .run(
          req.user.id,
          code,
          p.data.name,
          p.data.visibility,
          JSON.stringify({ stack: p.data.stack, resolved, chems, coreVersion: CORE_VERSION, source: p.data.source }),
        );
      return { id: r.lastInsertRowid };
    } catch {
      return reply.code(409).send({
        error: (db.prepare('SELECT deleted_at FROM batches WHERE code=?').get(code) as any)?.deleted_at
          ? 'a batch with this code is in the trash: restore it or empty it from the trash first'
          : 'batch code already exists',
      });
    }
  });
  app.patch('/api/batches/:id', { preHandler: auth() }, async (req: any, reply) => {
    const p = BatchPatch.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const d = p.data,
      id = +req.params.id;
    // sharing stays open on a locked batch; everything else needs it unlocked
    const onlyShare = d.visibility && d.name === undefined && !d.status && !d.record;
    if (onlyShare) {
      const b = batchOf(req, reply);
      if (!b) return;
      if (!(b.owner_id === req.user.id || req.user.role === 'admin'))
        return reply.code(403).send({ error: 'not your batch' });
    } else if (!batchOf(req, reply, true)) return;
    if (d.name !== undefined) db.prepare('UPDATE batches SET name=? WHERE id=?').run(d.name, id);
    if (d.status) {
      db.prepare('UPDATE batches SET status=? WHERE id=?').run(d.status, id);
      markDone(id);
    }
    if (d.visibility) db.prepare('UPDATE batches SET visibility=? WHERE id=?').run(d.visibility, id);
    if (d.record) db.prepare('UPDATE batches SET record=? WHERE id=?').run(JSON.stringify(d.record), id);
    db.prepare('UPDATE batches SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
    return { ok: true };
  });
  app.delete('/api/batches/:id', { preHandler: auth() }, async (req: any, reply) => {
    if (!batchOf(req, reply, true)) return;
    db.prepare('UPDATE batches SET deleted_at=? WHERE id=?').run(new Date().toISOString(), +req.params.id); // to the trash
    return { ok: true, trash: true };
  });
  /**
   * The batch's variants. Recipes and stacks are frozen when first linked (like the batch itself); a link kept from before keeps its
   * frozen copy, so editing a variant's name does not pick up later edits of its recipes.
   */
  app.put('/api/batches/:id/variants', { preHandler: auth() }, async (req: any, reply) => {
    const b = batchOf(req, reply, true);
    if (!b) return;
    const p = VariantsIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const sl = b.snapshot.stack.sl as { n: string; m: string }[],
      old = (b.variants?.list ?? []) as any[];
    const ids = p.data.list.map((v) => v.id);
    if (new Set(ids).size !== ids.length) return reply.code(400).send({ error: 'two variants have the same id' });
    const kept = new Map<string, unknown>();
    for (const v of old)
      for (const c of v.changes ?? []) {
        if (c.t === 'recipe' && c.name !== undefined) kept.set('p' + c.id, { name: c.name, data: c.data });
        if (c.t === 'layer') {
          if (c.a && c.ra) kept.set('p' + c.a, c.ra);
          if (c.b && c.rb) kept.set('p' + c.b, c.rb);
        }
      }
    const frozen = (id: string | number) => {
      if (!id) return null;
      if (!kept.has('p' + id)) kept.set('p' + id, preset(req.user, String(id)));
      return kept.get('p' + id) as { name: string; data: unknown };
    };
    try {
      const list = p.data.list.map((v) => {
        if (v.stack) {
          const was = old.find((o) => o.stack?.id === v.stack);
          if (was) return { ...v, changes: [], stack: was.stack };
          const r = db
            .prepare("SELECT * FROM presets WHERE id=? AND segment='stk' AND deleted_at IS NULL")
            .get(v.stack) as any;
          if (!r || !canSee(req.user, r)) throw new Error('the linked stack is not available');
          const stack = JSON.parse(r.data);
          return {
            ...v,
            changes: [],
            stack: { id: r.id, name: r.name, stack, resolved: resolveStack(req.user, stack, true) },
          };
        }
        const changes = v.changes.map((c) => {
          const at = c.t === 'layer' ? c.after : c.t === 'other' ? c.slot : c.slot;
          if (at !== null && at >= sl.length)
            throw new Error(`${v.name}: a change refers to a layer the batch does not have`);
          if (c.t === 'recipe') {
            if (c.which === 'b' && sl[c.slot].m !== 'Spin')
              throw new Error(`${v.name}: only spin coating has a program`);
            return { ...c, ...frozen(c.id) };
          }
          if (c.t === 'layer') return { ...c, ra: frozen(c.a), rb: frozen(c.b) };
          return c;
        });
        return { ...v, stack: null, changes };
      });
      db.prepare('UPDATE batches SET variants=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(
        JSON.stringify({ control: p.data.control, list }),
        b.id,
      );
      return { control: p.data.control, list };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
  /** Admin: open a locked batch for changes for a few days (it locks again by itself), or lock it again now. */
  app.post('/api/batches/:id/unlock', { preHandler: auth(true) }, async (req: any, reply) => {
    const b = batchOf(req, reply);
    if (!b) return;
    const until = new Date(Date.now() + UNLOCK_DAYS * 864e5).toISOString();
    db.prepare('UPDATE batches SET unlocked_until=? WHERE id=?').run(until, b.id);
    return { unlockedUntil: until };
  });
  app.post('/api/batches/:id/lock', { preHandler: auth(true) }, async (req: any, reply) => {
    const b = batchOf(req, reply);
    if (!b) return;
    db.prepare('UPDATE batches SET unlocked_until=NULL WHERE id=?').run(b.id);
    return { ok: true };
  });
}
