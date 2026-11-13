import type { FastifyInstance } from 'fastify';
import { SubstanceIn } from '@psc/schema';
import { molarMass, normCas } from '@psc/core';
import { db } from './db.js';

/**
 * Substances (0.44): what recipes name (PbI2, DMF), made from the containers people add or import; there is no list to keep
 * by hand. Each substance has its identity (formula, molar mass, density, CAS, melting and boiling point, refractive index),
 * its roles as filters, hazard pictograms and whether the Federal Police or the Army controls it. Purity, supplier and lot
 * belong to each container. One container per substance is the one recipes use (the bottle in the glovebox): marked by hand,
 * or the newest one not empty.
 */
export type Bottle = {
  id: number;
  supplier: string;
  lot: string;
  purity: number | null;
  amount: number | null;
  unit: string;
  status: string;
  use: boolean;
  place: string;
};
export type Substance = {
  id: number;
  name: string;
  cas: string;
  f: string;
  M: number;
  d: number | null;
  mp: number | null;
  bp: number | null;
  nD: number | null;
  roles: string[];
  ghs: string[];
  pf: boolean;
  army: boolean;
  notes: string;
  /** its containers that are not empty, the one recipes use first */
  bottles: Bottle[];
  /** the container recipes use, or null when none is in stock */
  bottle: Bottle | null;
  /** as recipes read it: the first role, and the purity of the container they use (100 % when there is none) */
  role: string;
  pur: number;
  brand: string;
};

const parse = (r: { id: number; name: string; cas: string; data: string }) => {
  const d = JSON.parse(r.data || '{}');
  return {
    id: r.id,
    name: r.name,
    cas: r.cas ?? '',
    f: d.f ?? '',
    M: d.M ?? 0,
    d: d.d ?? null,
    mp: d.mp ?? null,
    bp: d.bp ?? null,
    nD: d.nD ?? null,
    roles: Array.isArray(d.roles) ? d.roles : d.role && d.role !== 'other' ? [d.role] : [],
    ghs: d.ghs ?? [],
    pf: !!d.pf,
    army: !!d.army,
    notes: d.notes ?? '',
  };
};

/** Every substance with its containers in stock; recipes, batches and the inventory read this. */
export function substances(): Substance[] {
  const boxes = db
    .prepare(
      `SELECT c.id, c.chem_id, c.supplier, c.lot, c.purity, c.amount, c.unit, c.status, c.use, c.added_at,
         COALESCE(a.name, '') || COALESCE(', ' || s.name, '') AS place
       FROM containers c LEFT JOIN storage_areas a ON a.id=c.area_id LEFT JOIN shelves s ON s.id=c.shelf_id
       WHERE c.chem_id IS NOT NULL AND c.status <> 'empty'
       ORDER BY c.use DESC, c.added_at DESC, c.id DESC`,
    )
    .all() as any[];
  return (db.prepare('SELECT id, name, cas, data FROM chemicals ORDER BY name').all() as any[]).map((r) => {
    const s = parse(r),
      bottles: Bottle[] = boxes
        .filter((b) => b.chem_id === r.id)
        .map((b) => ({
          id: b.id,
          supplier: b.supplier,
          lot: b.lot,
          purity: b.purity,
          amount: b.amount,
          unit: b.unit,
          status: b.status,
          use: !!b.use,
          place: b.place,
        }));
    const bottle = bottles[0] ?? null;
    return {
      ...s,
      bottles,
      bottle,
      role: s.roles[0] ?? 'other',
      pur: bottle?.purity ?? 100,
      brand: bottle?.supplier ?? '',
    };
  });
}

/**
 * The substance a container is of: by its CAS number, else by its name; made when there is none (with what the container or
 * the import knows about it). Returns its id.
 */
export function substanceFor(
  name: string,
  cas = '',
  extra: Partial<Omit<ReturnType<typeof parse>, 'id' | 'name' | 'cas'>> = {},
): number {
  const c = normCas(cas),
    nm = name.trim();
  const found = ((c && db.prepare('SELECT id, name, cas, data FROM chemicals WHERE cas=?').get(c)) ||
    // by name only when the CAS numbers do not disagree
    db
      .prepare("SELECT id, name, cas, data FROM chemicals WHERE lower(name)=lower(?) AND (?='' OR cas='' OR cas=?)")
      .get(nm, c, c)) as any;
  if (found) {
    // fill in what it did not know yet; what people entered is never overwritten
    const s = parse(found),
      d = JSON.parse(found.data || '{}');
    const next = {
      ...d,
      f: s.f || extra.f || '',
      M: s.M || extra.M || (extra.f ? (molarMass(extra.f) ?? 0) : 0),
      d: s.d ?? extra.d ?? null,
      mp: s.mp ?? extra.mp ?? null,
      bp: s.bp ?? extra.bp ?? null,
      nD: s.nD ?? extra.nD ?? null,
      roles: [...new Set([...s.roles, ...(extra.roles ?? [])])],
      ghs: [...new Set([...s.ghs, ...(extra.ghs ?? [])])],
      pf: s.pf || !!extra.pf,
      army: s.army || !!extra.army,
      notes: s.notes || extra.notes || '',
    };
    db.prepare('UPDATE chemicals SET cas=?, data=? WHERE id=?').run(s.cas || c, JSON.stringify(next), found.id);
    return found.id;
  }
  // a different substance with the same name (another CAS): keep both, told apart by the CAS number
  const taken = !!db.prepare('SELECT 1 FROM chemicals WHERE lower(name)=lower(?)').get(nm);
  const data = {
    f: extra.f ?? '',
    M: extra.M || (extra.f ? (molarMass(extra.f) ?? 0) : 0),
    d: extra.d ?? null,
    mp: extra.mp ?? null,
    bp: extra.bp ?? null,
    nD: extra.nD ?? null,
    roles: extra.roles ?? [],
    ghs: extra.ghs ?? [],
    pf: !!extra.pf,
    army: !!extra.army,
    notes: extra.notes ?? '',
  };
  return Number(
    db
      .prepare('INSERT INTO chemicals(name, cas, data) VALUES(?,?,?)')
      .run(taken ? `${nm} (${c || 'another'})` : nm, c, JSON.stringify(data)).lastInsertRowid,
  );
}

/** The container recipes use for its substance (the others of that substance stop being it). */
export function useBottle(container: number, on = true) {
  const r = db.prepare('SELECT chem_id FROM containers WHERE id=?').get(container) as { chem_id: number } | undefined;
  if (!r) return;
  if (on) db.prepare('UPDATE containers SET use=0 WHERE chem_id=? AND id<>?').run(r.chem_id, container);
  db.prepare('UPDATE containers SET use=? WHERE id=?').run(on ? 1 : 0, container);
}

export function registerChemicals(app: FastifyInstance, auth: (need?: any) => any, bad: (reply: any, p: any) => any) {
  app.get('/api/chemicals', { preHandler: auth() }, async () => substances());
  /** A substance's identity, roles and flags; its containers keep their own purity, supplier and lot. */
  app.put('/api/chemicals/:id', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = SubstanceIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const old = db.prepare('SELECT data FROM chemicals WHERE id=?').get(+req.params.id) as { data: string } | undefined;
    if (!old) return reply.code(404).send({ error: 'not found' });
    const { name, cas, ...rest } = p.data;
    const data = {
      ...JSON.parse(old.data || '{}'),
      ...rest,
      // a molar mass left at 0 is worked out from the formula when it can be
      M: rest.M || (rest.f ? (molarMass(rest.f) ?? 0) : 0),
    };
    delete data.role;
    delete data.pur;
    delete data.brand;
    try {
      db.prepare('UPDATE chemicals SET name=?, cas=?, data=? WHERE id=?').run(
        name,
        normCas(cas ?? ''),
        JSON.stringify(data),
        +req.params.id,
      );
      // its containers carry its name (search, lists)
      db.prepare('UPDATE containers SET name=?, cas=? WHERE chem_id=?').run(name, normCas(cas ?? ''), +req.params.id);
      return { ok: true };
    } catch {
      return reply.code(409).send({ error: 'another substance has this name' });
    }
  });
  /** Only a substance with no containers left can go; recipes that name it then say it is not in stock. */
  app.delete('/api/chemicals/:id', { preHandler: auth('inventory') }, async (req: any, reply) => {
    if (db.prepare('SELECT 1 FROM containers WHERE chem_id=?').get(+req.params.id))
      return reply.code(409).send({ error: 'it still has containers: delete them first' });
    db.prepare('DELETE FROM chemicals WHERE id=?').run(+req.params.id);
    return { ok: true };
  });
  app.put('/api/inventory/containers/:id/use', { preHandler: auth('inventory') }, async (req: any, reply) => {
    if (!db.prepare("SELECT 1 FROM containers WHERE id=? AND status<>'empty'").get(+req.params.id))
      return reply.code(404).send({ error: 'not found, or empty' });
    useBottle(+req.params.id, req.body?.use !== false);
    return { ok: true };
  });
}
