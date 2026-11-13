import type { FastifyInstance } from 'fastify';
import { toBase } from '@psc/core';
import { db, tx } from './db.js';
import { canSee, item, type ChemUse } from './modules.js';

/**
 * What records take from the containers (0.45). A module reports what one of its records used (a batch's recipes) and which
 * container each substance came from; the amounts are taken from those containers when the record starts (`take`) and put back
 * when it goes to the trash (`giveBack`). Each take is kept, so a container shows what took from it, and a record what it took.
 * The container's amount stays what people can correct by hand: weighing a bottle and typing what is left is always right.
 * Taking does not change who last edited the container: the takes are its record of that. When the record's amounts change
 * (run data give what was really weighed, 0.45.1), `retake` takes them again from the same containers, keeping the date.
 */
export type Use = ChemUse & {
  /** the container the record says it used (the one its recipes took when it started) */
  box?: number | null;
};
export type Draw = {
  id: number;
  subject: string;
  subject_id: number;
  substance: string;
  container_id: number | null;
  mg: number | null;
  ul: number | null;
  /** taken from the container, in its own unit (null when it could not be worked out) */
  amount: number | null;
  unit: string;
  /** why nothing, or not all, was taken ('' when it was) */
  note: string;
  /** where the amount comes from: 'planned' (the recipe), 'run' (run data) or 'partly' (some of each) */
  basis: string;
  at: string;
  returned_at: string | null;
};

// what is left keeps four decimals of its unit (0.1 mg in g), what was taken six
const round = (v: number, d = 6) => Math.round(v * 10 ** d) / 10 ** d;

/** The amount of a use in a container's unit: mass and volume convert with the substance's density (g/mL). */
function inUnit(u: Use, unit: string, density: number | null): number | null {
  const base = /L$/.test(unit) ? 'µL' : 'mg';
  let sum = 0;
  for (const [v, from] of [
    [u.mg, 'mg'],
    [u.ul, 'µL'],
  ] as const) {
    if (!v) continue;
    const b = toBase(v, from, base, density);
    if (b === null) return null;
    sum += b;
  }
  const one = toBase(1, unit, base, density);
  return one ? sum / one : null;
}

/** The container a use is taken from: the one the record names while it is still in stock, else the substance's one for recipes. */
function containerFor(u: Use, keep?: number) {
  // taken again: from the container it came from before, whatever it holds now
  const kept = keep && (db.prepare('SELECT id, amount, unit, chem_id FROM containers WHERE id=?').get(keep) as any);
  if (kept) return kept;
  const named =
    u.box &&
    (db.prepare("SELECT id, amount, unit, chem_id FROM containers WHERE id=? AND status<>'empty'").get(u.box) as any);
  if (named) return named;
  return db
    .prepare(
      `SELECT c.id, c.amount, c.unit, c.chem_id FROM containers c JOIN chemicals s ON s.id=c.chem_id
       WHERE lower(s.name)=lower(?) AND c.status<>'empty' ORDER BY c.use DESC, c.added_at DESC, c.id DESC LIMIT 1`,
    )
    .get(u.name.trim()) as any;
}

/**
 * Take what a record used from the containers, once: nothing happens when it already took (and has not given back). Uses of the
 * same substance and container are summed. Returns the takes.
 */
export function take(
  subject: string,
  id: number,
  uses: Use[],
  again?: { keep: Map<string, number>; at: string },
): Draw[] {
  return tx(() => {
    if (
      db
        .prepare('SELECT 1 FROM container_draws WHERE subject=? AND subject_id=? AND returned_at IS NULL')
        .get(subject, id)
    )
      return drawsOf(subject, id);
    const sum = new Map<string, Use & { parts: number; runs: number }>();
    for (const u of uses) {
      if (!u.mg && !u.ul) continue;
      const k = u.name.trim().toLowerCase() + '|' + (u.box ?? '');
      const s = sum.get(k) ?? { name: u.name.trim(), box: u.box ?? null, parts: 0, runs: 0 };
      s.mg = (s.mg ?? 0) + (u.mg ?? 0) || undefined;
      s.ul = (s.ul ?? 0) + (u.ul ?? 0) || undefined;
      s.parts++;
      if (u.run) s.runs++;
      sum.set(k, s);
    }
    const add = db.prepare(
      'INSERT INTO container_draws(subject,subject_id,substance,container_id,mg,ul,amount,unit,note,basis,at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    );
    const at = again?.at ?? new Date().toISOString().replace('T', ' ').slice(0, 19);
    for (const u of sum.values()) {
      const basis = !u.runs ? 'planned' : u.runs === u.parts ? 'run' : 'partly',
        c = containerFor(u, again?.keep.get(u.name.toLowerCase()));
      if (!c) {
        add.run(subject, id, u.name, null, u.mg ?? null, u.ul ?? null, null, '', 'no container in stock', basis, at);
        continue;
      }
      const s = db.prepare('SELECT data FROM chemicals WHERE id=?').get(c.chem_id) as { data: string } | undefined,
        density = JSON.parse(s?.data || '{}').d ?? null,
        x = inUnit(u, c.unit, density);
      let note = '';
      if (x === null) note = density ? 'its unit cannot hold this amount' : 'mass and volume need its density';
      else if (c.amount === null) note = 'the container’s amount is not known';
      else if (x > c.amount) note = 'more than the container held';
      if (x !== null && c.amount !== null)
        db.prepare('UPDATE containers SET amount=? WHERE id=?').run(round(Math.max(0, c.amount - x), 4), c.id);
      // what was really taken: all of it, or what the container held
      const taken = x === null || c.amount === null ? null : round(Math.min(x, c.amount));
      add.run(subject, id, u.name, c.id, u.mg ?? null, u.ul ?? null, taken, c.unit, note, basis, at);
    }
    return drawsOf(subject, id);
  });
}

/** Put back what a record took (it went to the trash, or its start was undone). */
export function giveBack(subject: string, id: number) {
  tx(() => {
    for (const d of db
      .prepare('SELECT * FROM container_draws WHERE subject=? AND subject_id=? AND returned_at IS NULL')
      .all(subject, id) as Draw[]) {
      if (d.container_id && d.amount)
        db.prepare('UPDATE containers SET amount=amount+? WHERE id=? AND amount IS NOT NULL AND unit=?').run(
          d.amount,
          d.container_id,
          d.unit,
        );
      db.prepare('UPDATE container_draws SET returned_at=CURRENT_TIMESTAMP WHERE id=?').run(d.id);
    }
  });
}

/**
 * The record's amounts changed (run data entered, changed or deleted): put back what it took and take the new amounts from the
 * same containers, under the same date. A record that has not taken yet is left alone.
 */
export function retake(subject: string, id: number, uses: Use[]) {
  tx(() => {
    const was = drawsOf(subject, id);
    if (!was.length) return;
    const keep = new Map<string, number>();
    for (const d of was) if (d.container_id) keep.set(d.substance.toLowerCase(), d.container_id);
    giveBack(subject, id);
    take(subject, id, uses, { keep, at: was[0].at });
  });
}

export const drawsOf = (subject: string, id: number) =>
  db
    .prepare('SELECT * FROM container_draws WHERE subject=? AND subject_id=? AND returned_at IS NULL ORDER BY id')
    .all(subject, id) as Draw[];

export function registerDraws(app: FastifyInstance, auth: (need?: any) => any) {
  /** What a record took, with the container each amount came from (its supplier, lot, purity and where it is). */
  app.get('/api/inventory/draws/:subject/:id', { preHandler: auth() }, async (req: any, reply) => {
    const k = item(req.params.subject),
      r = k && (db.prepare(`SELECT * FROM ${k.table} WHERE id=?`).get(+req.params.id) as any);
    if (!r || !canSee(req.user, r)) return reply.code(404).send({ error: 'not found' });
    return db
      .prepare(
        `SELECT d.*, c.supplier, c.lot, c.purity, c.status, c.amount AS left,
           COALESCE(a.name, '') || COALESCE(', ' || s.name, '') AS place
         FROM container_draws d LEFT JOIN containers c ON c.id=d.container_id
         LEFT JOIN storage_areas a ON a.id=c.area_id LEFT JOIN shelves s ON s.id=c.shelf_id
         WHERE d.subject=? AND d.subject_id=? AND d.returned_at IS NULL ORDER BY d.substance COLLATE NOCASE`,
      )
      .all(req.params.subject, +req.params.id);
  });
  /** What took from a container, newest first; a record the person cannot open is named only by its type. */
  app.get('/api/inventory/containers/:id/draws', { preHandler: auth() }, async (req: any) =>
    (
      db
        .prepare('SELECT * FROM container_draws WHERE container_id=? AND returned_at IS NULL ORDER BY at DESC, id DESC')
        .all(+req.params.id) as Draw[]
    ).map((d) => {
      const k = item(d.subject),
        r = k && (db.prepare(`SELECT * FROM ${k.table} WHERE id=?`).get(d.subject_id) as any);
      const w = r && !r.deleted_at && canSee(req.user, r) ? k!.describe(r) : null;
      // a record the person cannot open (someone's private batch) is named only by its type
      return { ...d, what: w ? (w.title ?? w.name) : `a private ${k?.kind ?? 'record'}`, link: w?.link ?? null };
    }),
  );
}
