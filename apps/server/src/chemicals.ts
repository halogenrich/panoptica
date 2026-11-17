import type { FastifyInstance } from 'fastify';
import { SubstanceIn, SubstanceMerge, SubstancePair } from '@psc/schema';
import { chemRef, duplicatePairs, fold, molarMass, normCas, withRef } from '@psc/core';
import { db, tagHas, tx } from './db.js';
import { addCoreItem, modules } from './modules.js';
import { notify } from './social.js';

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
  /** short name, shown wherever it is set (DMF, MeO-2PACz), and other names that search also finds (0.54) */
  s: string;
  aka: string[];
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
    s: (d.s ?? '') as string,
    aka: (Array.isArray(d.aka) ? d.aka : []) as string[],
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
       WHERE c.chem_id IS NOT NULL AND c.status <> 'empty' AND c.deleted_at IS NULL
       ORDER BY c.use DESC, c.added_at DESC, c.id DESC`,
    )
    .all() as any[];
  return (
    db.prepare('SELECT id, name, cas, data FROM chemicals WHERE deleted_at IS NULL ORDER BY name').all() as any[]
  ).map((r) => {
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

/** Columns of a substance found by `substanceFor`, in the trash or not. */
const SEL = 'SELECT id, name, cas, data, deleted_at FROM chemicals';

/**
 * A substance that was in the trash comes back when a container of it is added again (0.54): its containers that went to the
 * trash with it were thrown away with it, so they are removed for good; the new container replaces them.
 */
function revive(id: number) {
  db.prepare('DELETE FROM containers WHERE chem_id=? AND deleted_at IS NOT NULL').run(id);
  db.prepare('UPDATE chemicals SET deleted_at=NULL, owner_id=NULL WHERE id=?').run(id);
}

/**
 * The substance a container is of: by its CAS number, else by its name; made when there is none (with what the container or
 * the import knows about it, and what the reference list knows of a common compound, 0.54). Returns its id.
 */
export function substanceFor(
  name: string,
  cas = '',
  extra: Partial<Omit<ReturnType<typeof parse>, 'id' | 'name' | 'cas'>> = {},
): number {
  const c = normCas(cas),
    nm = name.trim(),
    ref = chemRef(c);
  const pick = (deleted: boolean) =>
    ((c && db.prepare(`${SEL} WHERE cas=? AND deleted_at IS ${deleted ? 'NOT ' : ''}NULL`).get(c)) ||
      // by name only when the CAS numbers do not disagree
      db
        .prepare(
          `${SEL} WHERE lower(name)=lower(?) AND (?='' OR cas='' OR cas=?) AND deleted_at IS ${deleted ? 'NOT ' : ''}NULL`,
        )
        .get(nm, c, c)) as any;
  const found = pick(false) || pick(true);
  if (found) {
    if (found.deleted_at) revive(found.id);
    // fill in what it did not know yet; what people entered is never overwritten
    const s = parse(found),
      d = JSON.parse(found.data || '{}');
    const next = withRef(
      {
        ...d,
        s: s.s || extra.s || '',
        aka: [...new Set([...s.aka, ...(extra.aka ?? [])])],
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
      },
      chemRef(s.cas || c),
    );
    db.prepare('UPDATE chemicals SET cas=?, data=? WHERE id=?').run(s.cas || c, JSON.stringify(next), found.id);
    return found.id;
  }
  // a different substance with the same name (another CAS): keep both, told apart by the CAS number
  const taken = !!db.prepare('SELECT 1 FROM chemicals WHERE lower(name)=lower(?)').get(nm);
  const data = withRef(
    {
      s: extra.s ?? '',
      aka: extra.aka ?? [],
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
    },
    ref,
  );
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

/** Recipes and other records that name a substance follow it when it is renamed or merged into another (0.54). */
function renamed(from: string, to: string) {
  if (from === to) return;
  for (const m of modules()) m.substanceRenamed?.(from, to);
}

// ------------------------------------------------------------------ possible duplicates (0.54)
type DupRow = { id: number; name: string; cas: string; data: string };
const live = () =>
  (db.prepare('SELECT id, name, cas, data FROM chemicals WHERE deleted_at IS NULL').all() as DupRow[]).map((r) => {
    const d = JSON.parse(r.data || '{}');
    return {
      id: r.id,
      name: r.name,
      cas: r.cas ?? '',
      f: d.f ?? '',
      s: d.s ?? '',
      aka: Array.isArray(d.aka) ? d.aka : [],
    };
  });
/** Pairs that may be one substance, without those people said are not the same. */
export function duplicates() {
  const not = new Set(
    (db.prepare("SELECT a, b FROM chem_pairs WHERE state='not'").all() as { a: number; b: number }[]).map(
      (p) => `${p.a}:${p.b}`,
    ),
  );
  return duplicatePairs(live()).filter((p) => !not.has(`${p.a}:${p.b}`));
}
/** Who looks after the inventory: admins and people with the Inventory tag. */
const editors = () =>
  (
    db
      .prepare(
        `SELECT id FROM users u WHERE u.active=1 AND u.deleted=0 AND (u.role='admin' OR EXISTS (
           SELECT 1 FROM user_tags ut JOIN tags t ON t.id=ut.tag_id WHERE ut.user_id=u.id AND ${tagHas('inventory')}))`,
      )
      .all() as { id: number }[]
  ).map((r) => r.id);
/**
 * Tells the inventory's editors about pairs found since the last time (once per pair): after containers are added, imported
 * or a substance is edited, and when the server starts (an update may find pairs in substances the lab already had).
 */
export function checkDuplicates() {
  const told = new Set(
    (db.prepare('SELECT a, b FROM chem_pairs').all() as { a: number; b: number }[]).map((p) => `${p.a}:${p.b}`),
  );
  const fresh = duplicates().filter((p) => !told.has(`${p.a}:${p.b}`));
  if (!fresh.length) return;
  const mark = db.prepare("INSERT OR IGNORE INTO chem_pairs(a, b, state) VALUES(?, ?, 'told')");
  for (const p of fresh) mark.run(p.a, p.b);
  const name = (id: number) => (db.prepare('SELECT name FROM chemicals WHERE id=?').get(id) as { name: string }).name;
  const text =
    fresh.length === 1
      ? `${name(fresh[0].a)} and ${name(fresh[0].b)} may be the same substance`
      : `${fresh.length} pairs of substances may be the same substance`;
  notify(editors(), 'inventory', text, { view: 'duplicates', id: null });
}

/** A substance in the trash (0.54): kind 'substance' in `/api/trash`; its containers go and come back with it. */
addCoreItem({
  kind: 'substance',
  module: 'core',
  table: 'chemicals',
  cols: 'name',
  describe: (r) => ({ name: r.name, type: 'Substance', link: { view: 'chem', id: null } }),
  purge: (id) => db.prepare('DELETE FROM containers WHERE chem_id=? AND deleted_at IS NOT NULL').run(id),
  restored: (id) => {
    db.prepare('UPDATE containers SET deleted_at=NULL WHERE chem_id=?').run(id);
    checkDuplicates();
  },
});

export function registerChemicals(app: FastifyInstance, auth: (need?: any) => any, bad: (reply: any, p: any) => any) {
  app.get('/api/chemicals', { preHandler: auth() }, async () => substances());
  /** A substance's identity, roles and flags; its containers keep their own purity, supplier and lot. */
  app.put('/api/chemicals/:id', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = SubstanceIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const old = db.prepare('SELECT name, data FROM chemicals WHERE id=? AND deleted_at IS NULL').get(+req.params.id) as
      { name: string; data: string } | undefined;
    if (!old) return reply.code(404).send({ error: 'not found' });
    const { name, cas, ...rest } = p.data;
    const data = {
      ...JSON.parse(old.data || '{}'),
      ...rest,
      // other names: one of each, none that is its own name or short name
      aka: (rest.aka ?? [])
        .map((x) => x.trim())
        .filter(
          (x, i, l) =>
            x &&
            fold(x) !== fold(name) &&
            fold(x) !== fold(rest.s ?? '') &&
            l.findIndex((y) => fold(y) === fold(x)) === i,
        ),
      // a molar mass left at 0 is worked out from the formula when it can be
      M: rest.M || (rest.f ? (molarMass(rest.f) ?? 0) : 0),
    };
    delete data.role;
    delete data.pur;
    delete data.brand;
    try {
      tx(() => {
        db.prepare('UPDATE chemicals SET name=?, cas=?, data=? WHERE id=?').run(
          name,
          normCas(cas ?? ''),
          JSON.stringify(data),
          +req.params.id,
        );
        // its containers carry its name (search, lists), and recipes that name it follow (0.54)
        db.prepare('UPDATE containers SET name=?, cas=? WHERE chem_id=?').run(name, normCas(cas ?? ''), +req.params.id);
        renamed(old.name, name);
      });
    } catch {
      return reply.code(409).send({ error: 'another substance has this name (in the trash too)' });
    }
    checkDuplicates();
    return { ok: true };
  });
  /**
   * To the trash (0.54), with its containers: recipes that name it then say it is not in the inventory; past batches keep what
   * they recorded. Restored from the trash, it comes back with them.
   */
  app.delete('/api/chemicals/:id', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const id = +req.params.id;
    if (!db.prepare('SELECT 1 FROM chemicals WHERE id=? AND deleted_at IS NULL').get(id))
      return reply.code(404).send({ error: 'not found' });
    const at = new Date().toISOString();
    tx(() => {
      db.prepare('UPDATE chemicals SET deleted_at=?, owner_id=? WHERE id=?').run(at, req.user.id, id);
      db.prepare('UPDATE containers SET deleted_at=?, use=0 WHERE chem_id=? AND deleted_at IS NULL').run(at, id);
    });
    return { ok: true };
  });
  /**
   * Merge one substance into another (0.54): its containers move to the one kept, recipes that name it name the kept one, its
   * names become other names of the kept one, and what the kept one did not know is filled in. Cannot be undone.
   */
  app.post('/api/chemicals/:id/merge', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = SubstanceMerge.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const from = +req.params.id,
      into = p.data.into;
    const get = (id: number) =>
      db.prepare('SELECT id, name, cas, data FROM chemicals WHERE id=? AND deleted_at IS NULL').get(id) as
        { id: number; name: string; cas: string; data: string } | undefined;
    const a = get(from),
      b = get(into);
    if (!a || !b || from === into) return reply.code(404).send({ error: 'not found' });
    if (a.cas && b.cas && normCas(a.cas) !== normCas(b.cas))
      return reply.code(409).send({ error: 'their CAS numbers differ: they are not the same substance' });
    const x = parse(a),
      y = parse(b),
      dy = JSON.parse(b.data || '{}');
    const names = [...y.aka];
    for (const n of [x.name, x.s, ...x.aka])
      if (n && fold(n) !== fold(y.name) && fold(n) !== fold(y.s) && !names.some((m) => fold(m) === fold(n)))
        names.push(n);
    const next = {
      ...dy,
      s: y.s || x.s,
      aka: names,
      f: y.f || x.f,
      M: y.M || x.M,
      d: y.d ?? x.d,
      mp: y.mp ?? x.mp,
      bp: y.bp ?? x.bp,
      nD: y.nD ?? x.nD,
      roles: [...new Set([...y.roles, ...x.roles])],
      ghs: [...new Set([...y.ghs, ...x.ghs])],
      pf: y.pf || x.pf,
      army: y.army || x.army,
      notes: [y.notes, x.notes].filter(Boolean).join('\n'),
    };
    tx(() => {
      // the kept one's container for recipes stays; the merged one's stops being one
      if (db.prepare('SELECT 1 FROM containers WHERE chem_id=? AND use=1').get(into))
        db.prepare('UPDATE containers SET use=0 WHERE chem_id=?').run(from);
      db.prepare('UPDATE containers SET chem_id=?, name=?, cas=? WHERE chem_id=?').run(
        into,
        b.name,
        b.cas || a.cas,
        from,
      );
      db.prepare('UPDATE chemicals SET cas=?, data=? WHERE id=?').run(b.cas || a.cas, JSON.stringify(next), into);
      db.prepare('DELETE FROM chem_pairs WHERE a=? OR b=?').run(from, from);
      db.prepare('DELETE FROM chemicals WHERE id=?').run(from);
      renamed(a.name, b.name);
    });
    return { ok: true };
  });
  /** Possible duplicates (0.54), with what tells the two apart. */
  app.get('/api/chemicals/duplicates', { preHandler: auth() }, async () => {
    const all = new Map(substances().map((c) => [c.id, c]));
    return duplicates().flatMap((p) => {
      const a = all.get(p.a),
        b = all.get(p.b);
      return a && b ? [{ why: p.why, a, b }] : [];
    });
  });
  /** "Not a duplicate": the pair is not shown or told again. */
  app.post('/api/chemicals/duplicates/not', { preHandler: auth('inventory') }, async (req: any, reply) => {
    const p = SubstancePair.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const [a, b] = p.data.a < p.data.b ? [p.data.a, p.data.b] : [p.data.b, p.data.a];
    db.prepare("INSERT OR REPLACE INTO chem_pairs(a, b, state) VALUES(?, ?, 'not')").run(a, b);
    return { ok: true };
  });
  app.put('/api/inventory/containers/:id/use', { preHandler: auth('inventory') }, async (req: any, reply) => {
    if (
      !db.prepare("SELECT 1 FROM containers WHERE id=? AND status<>'empty' AND deleted_at IS NULL").get(+req.params.id)
    )
      return reply.code(404).send({ error: 'not found, or empty' });
    useBottle(+req.params.id, req.body?.use !== false);
    return { ok: true };
  });
}
