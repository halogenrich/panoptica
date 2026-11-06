import type { FastifyInstance } from 'fastify';
import { ComparisonIn, ComparisonPatch } from '@psc/schema';
import { db } from './db.js';
import { linkNames } from './iv.js';

/**
 * Comparisons (0.30): custom groups of devices (sample + substrate of a measurement) picked from any measurements, compared with
 * box plots, J–V curves and a table. The groups are stored as references, so a comparison always shows the measurements as they
 * are now (a pixel ticked out later is left out here too). Private by default; shared ones are read-only for others.
 */
type U = { id: number; role: 'admin' | 'member'; all?: boolean; name?: string };
const visible = (u: U, r: { owner_id: number; visibility: string }) =>
  r.owner_id === u.id || r.visibility === 'shared' || !!u.all;
const editable = (u: U, r: { owner_id: number }) => r.owner_id === u.id || u.role === 'admin';

export function registerComparisons(
  app: FastifyInstance,
  auth: (admin?: boolean) => any,
  bad: (reply: any, p: any) => any,
) {
  db.exec(`
CREATE TABLE IF NOT EXISTS comparisons(
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')), notes TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT);`);

  const row = (id: number) =>
    db
      .prepare(
        'SELECT c.*,u.name AS owner FROM comparisons c JOIN users u ON u.id=c.owner_id WHERE c.id=? AND c.deleted_at IS NULL',
      )
      .get(id) as any;
  const out = (r: any, u: U) => {
    const data = JSON.parse(r.data);
    return {
      id: r.id,
      name: r.name,
      visibility: r.visibility,
      notes: r.notes,
      owner: r.owner,
      mine: r.owner_id === u.id,
      editable: editable(u, r),
      created_at: r.created_at,
      updated_at: r.updated_at,
      data,
      groups: data.groups?.length ?? 0,
      devices: (data.groups ?? []).reduce((a: number, g: any) => a + (g.members?.length ?? 0), 0),
    };
  };

  app.get('/api/comparisons', { preHandler: auth() }, async (req: any) =>
    (
      db
        .prepare(
          'SELECT c.*,u.name AS owner FROM comparisons c JOIN users u ON u.id=c.owner_id WHERE c.deleted_at IS NULL ORDER BY c.updated_at DESC, c.id DESC',
        )
        .all() as any[]
    )
      .filter((r) => visible(req.user, r))
      .map((r) => {
        const { data: _d, ...rest } = out(r, req.user);
        return rest;
      }),
  );

  /**
   * Every device the user can see, for picking: one row per sample + substrate of each measurement (follow-ups of stability tests
   * left out), with its batch, the best counted PCE and how many pixels count (check sweeps and pixels ticked out never count).
   */
  app.get('/api/comparisons/devices', { preHandler: auth() }, async (req: any) => {
    const sets = (
      db
        .prepare(
          'SELECT s.*,u.name AS owner FROM iv_sets s JOIN users u ON u.id=s.owner_id WHERE s.deleted_at IS NULL AND s.stability_of IS NULL ORDER BY s.date DESC, s.id DESC',
        )
        .all() as any[]
    ).filter((s) => visible(req.user, s));
    if (!sets.length) return [];
    const byId = new Map(sets.map((s) => [s.id, s]));
    const curves = db
      .prepare(
        `SELECT set_id,sample,substrate,pixel,metrics,use,kind FROM iv_curves WHERE set_id IN (${sets.map(() => '?').join(',')})`,
      )
      .all(...sets.map((s) => s.id)) as any[];
    const dev = new Map<string, { set: number; sample: string; substrate: string; best: number; px: Set<string> }>();
    for (const c of curves) {
      const k = `${c.set_id}|${c.sample}|${c.substrate}`;
      const d = dev.get(k) ?? { set: c.set_id, sample: c.sample, substrate: c.substrate, best: 0, px: new Set() };
      dev.set(k, d);
      const m = JSON.parse(c.metrics);
      const counted = c.use === 1 || (c.use === null && m.status === 'ok' && c.kind !== 'check');
      if (counted && Number.isFinite(m.pce)) {
        d.best = Math.max(d.best, m.pce);
        d.px.add(c.pixel);
      }
    }
    const links = new Map(sets.map((s) => [s.id, linkNames(JSON.parse(s.links))]));
    const order = new Map(sets.map((s, i) => [s.id, i]));
    const num = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
    return [...dev.values()]
      .sort((a, b) => order.get(a.set)! - order.get(b.set)! || num(a.sample, b.sample) || num(a.substrate, b.substrate))
      .map((d) => {
        const s = byId.get(d.set),
          l = links.get(d.set)?.[d.sample] ?? null,
          info = JSON.parse(s.devices || '{}')[`${d.sample}|${d.substrate}`] ?? {};
        return {
          set: d.set,
          setName: s.name,
          date: s.date || String(s.created_at).slice(0, 10),
          system: s.system,
          owner: s.owner,
          mine: s.owner_id === req.user.id,
          sample: d.sample,
          substrate: d.substrate,
          link: l,
          group: info.g ?? '',
          off: !!info.off,
          best: d.best,
          pixels: d.px.size,
        };
      });
  });

  app.get('/api/comparisons/:id', { preHandler: auth() }, async (req: any, reply) => {
    const r = row(+req.params.id);
    if (!r || !visible(req.user, r)) return reply.code(404).send({ error: 'not found' });
    return out(r, req.user);
  });

  app.post('/api/comparisons', { preHandler: auth() }, async (req: any, reply) => {
    const p = ComparisonIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const d = p.data;
    const r = db
      .prepare('INSERT INTO comparisons(owner_id,name,visibility,notes,data) VALUES(?,?,?,?,?)')
      .run(req.user.id, d.name, d.visibility, d.notes, JSON.stringify(d.data));
    return { id: Number(r.lastInsertRowid) };
  });

  app.patch('/api/comparisons/:id', { preHandler: auth() }, async (req: any, reply) => {
    const r = row(+req.params.id);
    if (!r || !visible(req.user, r)) return reply.code(404).send({ error: 'not found' });
    if (!editable(req.user, r)) return reply.code(403).send({ error: 'not your comparison: make a copy to change it' });
    const p = ComparisonPatch.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const d = p.data;
    db.prepare(
      'UPDATE comparisons SET name=COALESCE(?,name),visibility=COALESCE(?,visibility),notes=COALESCE(?,notes),data=COALESCE(?,data),updated_at=CURRENT_TIMESTAMP WHERE id=?',
    ).run(d.name ?? null, d.visibility ?? null, d.notes ?? null, d.data ? JSON.stringify(d.data) : null, r.id);
    return { ok: true };
  });

  app.delete('/api/comparisons/:id', { preHandler: auth() }, async (req: any, reply) => {
    const r = row(+req.params.id);
    if (!r || !visible(req.user, r)) return reply.code(404).send({ error: 'not found' });
    if (!editable(req.user, r)) return reply.code(403).send({ error: 'not your comparison' });
    db.prepare('UPDATE comparisons SET deleted_at=? WHERE id=?').run(new Date().toISOString(), r.id); // to the trash
    return { ok: true, trash: true };
  });
}
