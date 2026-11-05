import type { FastifyInstance } from 'fastify';
import { AreaIn, ShelfIn, ContainerIn, InventoryImport, StorageTypeIn } from '@psc/schema';
import { db, tx } from './db.js';

/**
 * Inventory: storage areas (cabinets, desiccators, gloveboxes, fridges…) with shelves, and the containers on them.
 * Everyone reads; admins and users with the Inventory tag edit. Containers record who added and last changed them, and when.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS storage_areas(id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'cabinet', place TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', pos INTEGER NOT NULL DEFAULT 0, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS shelves(id INTEGER PRIMARY KEY, area_id INTEGER NOT NULL REFERENCES storage_areas(id) ON DELETE CASCADE, name TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS containers(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, chem_id INTEGER REFERENCES chemicals(id) ON DELETE SET NULL, cas TEXT NOT NULL DEFAULT '',
  amount REAL, size REAL, unit TEXT NOT NULL DEFAULT 'g', status TEXT NOT NULL DEFAULT 'in use',
  area_id INTEGER REFERENCES storage_areas(id) ON DELETE SET NULL, shelf_id INTEGER REFERENCES shelves(id) ON DELETE SET NULL,
  supplier TEXT NOT NULL DEFAULT '', lot TEXT NOT NULL DEFAULT '', purity REAL, expires TEXT, opened TEXT, notes TEXT NOT NULL DEFAULT '',
  added_by INTEGER REFERENCES users(id), added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by INTEGER REFERENCES users(id), updated_at TEXT);
CREATE INDEX IF NOT EXISTS containers_area ON containers(area_id);
CREATE TABLE IF NOT EXISTS storage_types(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, icon TEXT NOT NULL DEFAULT 'cabinet', pos INTEGER NOT NULL DEFAULT 0);
`);
// storage types are a list the Inventory people edit; the first run makes the usual ones and links existing areas by kind
if (!db.prepare('SELECT 1 FROM storage_types LIMIT 1').get()) {
  const ins = db.prepare('INSERT INTO storage_types(name,icon,pos) VALUES(?,?,?)');
  [['Cabinet', 'cabinet'], ['Desiccator', 'desiccator'], ['Glovebox', 'glovebox'], ['Fridge', 'fridge'], ['Freezer', 'freezer'], ['Open shelf', 'shelf']].forEach(([n, i], k) => ins.run(n, i, k));
}
if (!(db.prepare('PRAGMA table_info(storage_areas)').all() as { name: string }[]).some((c) => c.name === 'type_id')) {
  db.exec('ALTER TABLE storage_areas ADD COLUMN type_id INTEGER REFERENCES storage_types(id) ON DELETE SET NULL');
  db.exec("UPDATE storage_areas SET type_id=(SELECT id FROM storage_types t WHERE t.icon=storage_areas.kind)");
}

type U = { id: number; role: string; all?: boolean; inventory?: boolean; manager?: boolean };
const cols = ['name', 'chem_id', 'cas', 'amount', 'size', 'unit', 'status', 'area_id', 'shelf_id', 'supplier', 'lot', 'purity', 'expires', 'opened', 'notes'] as const;

/** Find or make an area / shelf by name (import). */
function areaByName(name: string, uid: number) {
  const r = db.prepare('SELECT id FROM storage_areas WHERE lower(name)=lower(?)').get(name) as { id: number } | undefined;
  if (r) return r.id;
  const icon = /glove/i.test(name) ? 'glovebox' : /desic/i.test(name) ? 'desiccator' : /fridge|refrig|geladeira/i.test(name) ? 'fridge' : /freez|freezer/i.test(name) ? 'freezer' : 'cabinet';
  const type = (db.prepare('SELECT id FROM storage_types WHERE icon=? ORDER BY pos LIMIT 1').get(icon) as { id: number } | undefined)?.id ?? null;
  return Number(db.prepare('INSERT INTO storage_areas(name,kind,type_id,created_by,pos) VALUES(?,?,?,?,(SELECT COALESCE(MAX(pos),0)+1 FROM storage_areas))').run(name, icon, type, uid).lastInsertRowid);
}
function shelfByName(area: number, name: string) {
  const r = db.prepare('SELECT id FROM shelves WHERE area_id=? AND lower(name)=lower(?)').get(area, name) as { id: number } | undefined;
  return r ? r.id : Number(db.prepare('INSERT INTO shelves(area_id,name,pos) VALUES(?,?,(SELECT COALESCE(MAX(pos),0)+1 FROM shelves WHERE area_id=?))').run(area, name, area).lastInsertRowid);
}
const chemByName = (name: string) => (db.prepare('SELECT id FROM chemicals WHERE lower(name)=lower(?)').get(name) as { id: number } | undefined)?.id ?? null;

export function registerInventory(app: FastifyInstance, auth: (need?: any) => any, bad: (reply: any, p: any) => any) {
  app.get('/api/inventory', { preHandler: auth() }, async () => ({
    types: db.prepare('SELECT t.*, (SELECT COUNT(*) FROM storage_areas a WHERE a.type_id=t.id) AS n FROM storage_types t ORDER BY t.pos, t.id').all(),
    areas: (db.prepare('SELECT a.*, u.name AS created_by_name FROM storage_areas a LEFT JOIN users u ON u.id=a.created_by ORDER BY a.pos, a.id').all() as any[])
      .map((a) => ({ ...a, shelves: db.prepare('SELECT id,name,pos FROM shelves WHERE area_id=? ORDER BY pos, id').all(a.id) })),
    containers: db.prepare(`SELECT c.*, a.name AS added_by_name, b.name AS updated_by_name FROM containers c
      LEFT JOIN users a ON a.id=c.added_by LEFT JOIN users b ON b.id=c.updated_by ORDER BY c.name COLLATE NOCASE`).all(),
  }));

  // ---- areas and shelves ----
  app.post('/api/inventory/areas', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = AreaIn.safeParse(req.body); if (!p.success) return bad(reply, p);
    const d = p.data;
    return tx(() => {
      const id = Number(db.prepare('INSERT INTO storage_areas(name,type_id,place,notes,created_by,pos) VALUES(?,?,?,?,?,(SELECT COALESCE(MAX(pos),0)+1 FROM storage_areas))')
        .run(d.name, d.type_id ?? null, d.place ?? '', d.notes ?? '', req.user.id).lastInsertRowid);
      (d.shelves ?? []).forEach((s, i) => db.prepare('INSERT INTO shelves(area_id,name,pos) VALUES(?,?,?)').run(id, s, i));
      return { id };
    });
  });
  app.patch('/api/inventory/areas/:id', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = AreaIn.partial().safeParse(req.body); if (!p.success) return bad(reply, p);
    for (const k of ['name', 'type_id', 'place', 'notes'] as const) if (p.data[k] !== undefined) db.prepare(`UPDATE storage_areas SET ${k}=? WHERE id=?`).run(p.data[k]!, +req.params.id);
    return { ok: true };
  });
  app.delete('/api/inventory/areas/:id', { preHandler: auth('inventory') }, async (req: any) => {
    // containers stay, without a place
    db.prepare('DELETE FROM storage_areas WHERE id=?').run(+req.params.id);
    return { ok: true };
  });
  // ---- storage types (Cabinet, Glovebox… editable list) ----
  app.post('/api/inventory/types', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = StorageTypeIn.safeParse(req.body); if (!p.success) return bad(reply, p);
    try { return { id: Number(db.prepare('INSERT INTO storage_types(name,icon,pos) VALUES(?,?,(SELECT COALESCE(MAX(pos),0)+1 FROM storage_types))').run(p.data.name, p.data.icon ?? 'cabinet').lastInsertRowid) }; }
    catch { return reply.code(409).send({ error: 'this type already exists' }); }
  });
  app.patch('/api/inventory/types/:id', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = StorageTypeIn.partial().safeParse(req.body); if (!p.success) return bad(reply, p);
    try {
      if (p.data.name) db.prepare('UPDATE storage_types SET name=? WHERE id=?').run(p.data.name, +req.params.id);
      if (p.data.icon) db.prepare('UPDATE storage_types SET icon=? WHERE id=?').run(p.data.icon, +req.params.id);
      return { ok: true };
    } catch { return reply.code(409).send({ error: 'this type already exists' }); }
  });
  app.delete('/api/inventory/types/:id', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const n = (db.prepare('SELECT COUNT(*) AS n FROM storage_areas WHERE type_id=?').get(+req.params.id) as { n: number }).n;
    if (n) return reply.code(400).send({ error: `${n} storage place${n === 1 ? ' uses' : 's use'} this type; change ${n === 1 ? 'it' : 'them'} first` });
    db.prepare('DELETE FROM storage_types WHERE id=?').run(+req.params.id);
    return { ok: true };
  });

  app.post('/api/inventory/areas/:id/shelves', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = ShelfIn.safeParse(req.body); if (!p.success) return bad(reply, p);
    return { id: Number(db.prepare('INSERT INTO shelves(area_id,name,pos) VALUES(?,?,(SELECT COALESCE(MAX(pos),0)+1 FROM shelves WHERE area_id=?))').run(+req.params.id, p.data.name, +req.params.id).lastInsertRowid) };
  });
  app.patch('/api/inventory/shelves/:id', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = ShelfIn.safeParse(req.body); if (!p.success) return bad(reply, p);
    db.prepare('UPDATE shelves SET name=? WHERE id=?').run(p.data.name, +req.params.id);
    return { ok: true };
  });
  app.delete('/api/inventory/shelves/:id', { preHandler: auth('inventory') }, async (req: any) => {
    db.prepare('DELETE FROM shelves WHERE id=?').run(+req.params.id);
    return { ok: true };
  });

  // ---- containers ----
  const write = (d: Record<string, unknown>, uid: number, id?: number) => {
    const text = new Set(['cas', 'supplier', 'lot', 'notes']);
    const v = cols.map((k) => (d[k] === undefined || d[k] === null ? (text.has(k) ? '' : k === 'status' ? 'in use' : k === 'unit' ? 'g' : null) : d[k]));
    if (d.shelf_id && !d.area_id) v[cols.indexOf('area_id')] = (db.prepare('SELECT area_id FROM shelves WHERE id=?').get(d.shelf_id as number) as any)?.area_id ?? null;
    if (!d.chem_id && d.name) v[cols.indexOf('chem_id')] = chemByName(String(d.name));
    if (id === undefined) return Number(db.prepare(`INSERT INTO containers(${cols.join(',')},added_by) VALUES(${cols.map(() => '?').join(',')},?)`).run(...(v as any[]), uid).lastInsertRowid);
    db.prepare(`UPDATE containers SET ${cols.map((k) => k + '=?').join(',')},updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...(v as any[]), uid, id);
    return id;
  };
  app.post('/api/inventory/containers', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = ContainerIn.safeParse(req.body); if (!p.success) return bad(reply, p);
    return { id: write(p.data, req.user.id) };
  });
  app.put('/api/inventory/containers/:id', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = ContainerIn.safeParse(req.body); if (!p.success) return bad(reply, p);
    if (!db.prepare('SELECT 1 FROM containers WHERE id=?').get(+req.params.id)) return reply.code(404).send({ error: 'not found' });
    write(p.data, req.user.id, +req.params.id);
    return { ok: true };
  });
  app.delete('/api/inventory/containers/:id', { preHandler: auth('inventory') }, async (req: any) => {
    db.prepare('DELETE FROM containers WHERE id=?').run(+req.params.id);
    return { ok: true };
  });

  /** Import rows from a CSV export (OpenEnventory or a spreadsheet); storage areas and shelves are made by name when missing. */
  app.post('/api/inventory/import', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = InventoryImport.safeParse(req.body); if (!p.success) return bad(reply, p);
    return tx(() => {
      let n = 0;
      for (const r of p.data.rows) {
        const area = r.area ? areaByName(r.area, req.user.id) : null, shelf = area && r.shelf ? shelfByName(area, r.shelf) : null;
        write({ ...r, area_id: area, shelf_id: shelf, status: r.status ?? 'in use', unit: r.unit || 'g' }, req.user.id); n++;
      }
      return { imported: n };
    });
  });

  /**
   * Batches for the consumption estimate: running and done, with their frozen recipes. Everyone with inventory, manager or
   * professor access (and admins) gets all of them, since stock is shared; others get the ones they can see.
   */
  app.get('/api/inventory/batches', { preHandler: auth() }, async (req: any) => {
    const u = req.user as U, every = u.all || u.inventory || u.manager;
    return (db.prepare(`SELECT id,code,status,owner_id,visibility,snapshot,created_at,updated_at FROM batches WHERE deleted_at IS NULL AND status IN ('running','done') ORDER BY created_at`).all() as any[])
      .filter((b) => every || b.owner_id === u.id || b.visibility === 'shared')
      .map((b) => ({ id: b.id, code: b.code, status: b.status, created_at: b.created_at, snapshot: JSON.parse(b.snapshot) }));
  });
}
