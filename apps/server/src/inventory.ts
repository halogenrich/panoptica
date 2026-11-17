import type { FastifyInstance } from 'fastify';
import { AreaIn, ShelfIn, ContainerIn, InventoryImport, OrderIn, StorageTypeIn } from '@psc/schema';
import { db, tx } from './db.js';
import { modules } from './modules.js';
import { checkDuplicates, substanceFor, useBottle } from './chemicals.js';

/**
 * Inventory: storage areas (cabinets, desiccators, gloveboxes, fridges…) with shelves, and the containers on them.
 * Everyone reads; admins and users with the Inventory tag edit. Containers record who added and last changed them, and when.
 */

type U = { id: number; role: string; all?: boolean; inventory?: boolean; manager?: boolean };
const cols = [
  'name',
  'chem_id',
  'cas',
  'amount',
  'size',
  'unit',
  'status',
  'area_id',
  'shelf_id',
  'supplier',
  'lot',
  'purity',
  'expires',
  'opened',
  'notes',
  'barcode',
] as const;

/** Find or make an area / shelf by name (import). */
function areaByName(name: string, uid: number) {
  const r = db.prepare('SELECT id FROM storage_areas WHERE lower(name)=lower(?)').get(name) as
    { id: number } | undefined;
  if (r) return r.id;
  const icon = /glove/i.test(name)
    ? 'glovebox'
    : /desic/i.test(name)
      ? 'desiccator'
      : /fridge|refrig|geladeira/i.test(name)
        ? 'fridge'
        : /freez|freezer/i.test(name)
          ? 'freezer'
          : 'cabinet';
  const type =
    (
      db.prepare('SELECT id FROM storage_types WHERE icon=? ORDER BY pos LIMIT 1').get(icon) as
        { id: number } | undefined
    )?.id ?? null;
  return Number(
    db
      .prepare(
        'INSERT INTO storage_areas(name,kind,type_id,created_by,pos) VALUES(?,?,?,?,(SELECT COALESCE(MAX(pos),0)+1 FROM storage_areas))',
      )
      .run(name, icon, type, uid).lastInsertRowid,
  );
}
function shelfByName(area: number, name: string) {
  const r = db.prepare('SELECT id FROM shelves WHERE area_id=? AND lower(name)=lower(?)').get(area, name) as
    { id: number } | undefined;
  return r
    ? r.id
    : Number(
        db
          .prepare(
            'INSERT INTO shelves(area_id,name,pos) VALUES(?,?,(SELECT COALESCE(MAX(pos),0)+1 FROM shelves WHERE area_id=?))',
          )
          .run(area, name, area).lastInsertRowid,
      );
}
export function registerInventory(app: FastifyInstance, auth: (need?: any) => any, bad: (reply: any, p: any) => any) {
  app.get('/api/inventory', { preHandler: auth() }, async () => ({
    types: db
      .prepare(
        'SELECT t.*, (SELECT COUNT(*) FROM storage_areas a WHERE a.type_id=t.id) AS n FROM storage_types t ORDER BY t.pos, t.id',
      )
      .all(),
    areas: (
      db
        .prepare(
          'SELECT a.*, u.name AS created_by_name FROM storage_areas a LEFT JOIN users u ON u.id=a.created_by ORDER BY a.pos, a.id',
        )
        .all() as any[]
    ).map((a) => ({
      ...a,
      shelves: db.prepare('SELECT id,name,pos FROM shelves WHERE area_id=? ORDER BY pos, id').all(a.id),
    })),
    containers: db
      .prepare(
        `SELECT c.*, a.name AS added_by_name, b.name AS updated_by_name FROM containers c
      LEFT JOIN users a ON a.id=c.added_by LEFT JOIN users b ON b.id=c.updated_by WHERE c.deleted_at IS NULL
      ORDER BY c.name COLLATE NOCASE`,
      )
      .all(),
  }));

  // ---- areas and shelves ----
  app.post('/api/inventory/areas', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = AreaIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const d = p.data;
    return tx(() => {
      const id = Number(
        db
          .prepare(
            'INSERT INTO storage_areas(name,type_id,place,notes,created_by,pos) VALUES(?,?,?,?,?,(SELECT COALESCE(MAX(pos),0)+1 FROM storage_areas))',
          )
          .run(d.name, d.type_id ?? null, d.place ?? '', d.notes ?? '', req.user.id).lastInsertRowid,
      );
      (d.shelves ?? []).forEach((s, i) =>
        db.prepare('INSERT INTO shelves(area_id,name,pos) VALUES(?,?,?)').run(id, s, i),
      );
      return { id };
    });
  });
  app.patch('/api/inventory/areas/:id', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = AreaIn.partial().safeParse(req.body);
    if (!p.success) return bad(reply, p);
    for (const k of ['name', 'type_id', 'place', 'notes'] as const)
      if (p.data[k] !== undefined)
        db.prepare(`UPDATE storage_areas SET ${k}=? WHERE id=?`).run(p.data[k]!, +req.params.id);
    return { ok: true };
  });
  app.delete('/api/inventory/areas/:id', { preHandler: auth('inventory') }, async (req: any) => {
    // containers stay, without a place
    db.prepare('DELETE FROM storage_areas WHERE id=?').run(+req.params.id);
    return { ok: true };
  });
  // ---- storage types (Cabinet, Glovebox… editable list) ----
  app.post('/api/inventory/types', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = StorageTypeIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    try {
      return {
        id: Number(
          db
            .prepare(
              'INSERT INTO storage_types(name,icon,pos) VALUES(?,?,(SELECT COALESCE(MAX(pos),0)+1 FROM storage_types))',
            )
            .run(p.data.name, p.data.icon ?? 'cabinet').lastInsertRowid,
        ),
      };
    } catch {
      return reply.code(409).send({ error: 'this type already exists' });
    }
  });
  app.patch('/api/inventory/types/:id', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = StorageTypeIn.partial().safeParse(req.body);
    if (!p.success) return bad(reply, p);
    try {
      if (p.data.name) db.prepare('UPDATE storage_types SET name=? WHERE id=?').run(p.data.name, +req.params.id);
      if (p.data.icon) db.prepare('UPDATE storage_types SET icon=? WHERE id=?').run(p.data.icon, +req.params.id);
      return { ok: true };
    } catch {
      return reply.code(409).send({ error: 'this type already exists' });
    }
  });
  app.delete('/api/inventory/types/:id', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const n = (
      db.prepare('SELECT COUNT(*) AS n FROM storage_areas WHERE type_id=?').get(+req.params.id) as { n: number }
    ).n;
    if (n)
      return reply.code(400).send({
        error: `${n} storage place${n === 1 ? ' uses' : 's use'} this type; change ${n === 1 ? 'it' : 'them'} first`,
      });
    db.prepare('DELETE FROM storage_types WHERE id=?').run(+req.params.id);
    return { ok: true };
  });

  app.post('/api/inventory/areas/:id/shelves', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = ShelfIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    return {
      id: Number(
        db
          .prepare(
            'INSERT INTO shelves(area_id,name,pos) VALUES(?,?,(SELECT COALESCE(MAX(pos),0)+1 FROM shelves WHERE area_id=?))',
          )
          .run(+req.params.id, p.data.name, +req.params.id).lastInsertRowid,
      ),
    };
  });
  /** The divisions of a storage place in a new order (dragged in the app). */
  app.put('/api/inventory/areas/:id/shelves/order', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = OrderIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const up = db.prepare('UPDATE shelves SET pos=? WHERE id=? AND area_id=?');
    tx(() => p.data.ids.forEach((id, i) => up.run(i, id, +req.params.id)));
    return { ok: true };
  });
  app.patch('/api/inventory/shelves/:id', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = ShelfIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    db.prepare('UPDATE shelves SET name=? WHERE id=?').run(p.data.name, +req.params.id);
    return { ok: true };
  });
  app.delete('/api/inventory/shelves/:id', { preHandler: auth('inventory') }, async (req: any) => {
    db.prepare('DELETE FROM shelves WHERE id=?').run(+req.params.id);
    return { ok: true };
  });

  // ---- containers ----
  const write = (d: Record<string, unknown>, uid: number, id?: number): number => {
    const text = new Set(['cas', 'supplier', 'lot', 'notes', 'barcode']);
    // the substance it is of (0.44): the one picked, else found or made by CAS and name; the container carries its name
    const chem =
      d.chem_id && db.prepare('SELECT 1 FROM chemicals WHERE id=? AND deleted_at IS NULL').get(d.chem_id as number)
        ? (d.chem_id as number)
        : substanceFor(String(d.name ?? ''), String(d.cas ?? ''), (d.substance as any) ?? {});
    const sub = db.prepare('SELECT name, cas FROM chemicals WHERE id=?').get(chem) as { name: string; cas: string };
    d = { ...d, chem_id: chem, name: sub.name, cas: sub.cas || d.cas || '' };
    const v = cols.map((k) =>
      d[k] === undefined || d[k] === null
        ? text.has(k)
          ? ''
          : k === 'status'
            ? 'in use'
            : k === 'unit'
              ? 'g'
              : null
        : d[k],
    );
    if (d.shelf_id && !d.area_id)
      v[cols.indexOf('area_id')] =
        (db.prepare('SELECT area_id FROM shelves WHERE id=?').get(d.shelf_id as number) as any)?.area_id ?? null;
    let at = id;
    if (at === undefined)
      at = Number(
        db
          .prepare(`INSERT INTO containers(${cols.join(',')},added_by) VALUES(${cols.map(() => '?').join(',')},?)`)
          .run(...(v as any[]), uid).lastInsertRowid,
      );
    else
      db.prepare(
        `UPDATE containers SET ${cols.map((k) => k + '=?').join(',')},updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      ).run(...(v as any[]), uid, at);
    if (d.use !== undefined) useBottle(at, !!d.use && d.status !== 'empty');
    if (d.status === 'empty') useBottle(at, false);
    return at;
  };
  app.post('/api/inventory/containers', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = ContainerIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const id = write(p.data, req.user.id);
    checkDuplicates();
    return { id };
  });
  app.put('/api/inventory/containers/:id', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = ContainerIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    if (!db.prepare('SELECT 1 FROM containers WHERE id=? AND deleted_at IS NULL').get(+req.params.id))
      return reply.code(404).send({ error: 'not found' });
    write(p.data, req.user.id, +req.params.id);
    checkDuplicates();
    return { ok: true };
  });
  app.delete('/api/inventory/containers/:id', { preHandler: auth('inventory') }, async (req: any) => {
    db.prepare('DELETE FROM containers WHERE id=?').run(+req.params.id);
    return { ok: true };
  });

  /**
   * Import an inventory export (0.44): the substances first, found by CAS number or name or made (what the lab already knows
   * about a substance is kept), then the containers, each of its substance. Storage places and divisions are made by name.
   */
  app.post('/api/inventory/import', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = InventoryImport.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const done = tx(() => {
      const ids = new Map<string, number>();
      for (const { key, name, cas, ...rest } of p.data.substances) ids.set(key, substanceFor(name, cas ?? '', rest));
      let n = 0;
      for (const { key, area: an, shelf: sn, ...r } of p.data.containers) {
        const chem = ids.get(key);
        if (!chem) continue;
        const area = an ? areaByName(an, req.user.id) : null,
          shelf = area && sn ? shelfByName(area, sn) : null;
        write(
          { ...r, chem_id: chem, area_id: area, shelf_id: shelf, status: r.status ?? 'in use', unit: r.unit || 'g' },
          req.user.id,
        );
        n++;
      }
      return { imported: n, substances: ids.size };
    });
    checkDuplicates();
    return done;
  });

  /**
   * Consumption (0.42): what each module reports it took from the inventory; the page sums it per chemical and period. Everyone
   * with inventory, manager or professor access (and admins) gets all of it, since stock is shared; others get what they can see.
   */
  app.get('/api/inventory/use', { preHandler: auth() }, async (req: any) => {
    const u = req.user as U,
      every = !!(u.all || u.inventory || u.manager);
    const parts = modules()
      .filter((m) => m.uses)
      .map((m) => {
        const ev = m.uses!.events().filter((e) => every || e.owner_id === u.id || e.shared);
        return {
          basis: m.uses!.basis(ev.length),
          events: ev.map((e) => ({ label: e.label, date: e.date, uses: e.uses })),
        };
      });
    return { basis: parts.map((p) => p.basis), events: parts.flatMap((p) => p.events) };
  });
}
