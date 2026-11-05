import type { FastifyInstance } from 'fastify';
import { ivMetrics } from '@psc/core';
import { IvCurvePatch, IvSetIn, IvSetPatch } from '@psc/schema';
import { db, tx } from './db.js';
import { checkRecord } from './social.js';

type U = { id: number; role: 'admin' | 'member'; all?: boolean };
type Link = { kind: 'batch' | 'stack'; id: number } | null;
const visible = (u: U, r: { owner_id: number; visibility: string }) =>
  r.owner_id === u.id || r.visibility === 'shared' || !!u.all;
const editable = (u: U, r: { owner_id: number }) => r.owner_id === u.id || u.role === 'admin';
const fin = (x: number) => (Number.isFinite(x) ? x : null); // JSON has no NaN/Infinity

/** Names for the batches and stacks samples are linked to (the groups shown in the statistics). */
function linkNames(links: Record<string, Link>) {
  const out: Record<string, { kind: string; id: number; label: string } | null> = {};
  for (const [s, l] of Object.entries(links)) {
    if (!l) {
      out[s] = null;
      continue;
    }
    const r =
      l.kind === 'batch'
        ? (db.prepare('SELECT code,name FROM batches WHERE id=?').get(l.id) as
            { code: string; name: string } | undefined)
        : (db.prepare("SELECT name FROM presets WHERE id=? AND segment='stk'").get(l.id) as
            { name: string } | undefined);
    out[s] = r
      ? {
          ...l,
          label:
            l.kind === 'batch'
              ? `${(r as any).code}${(r as any).name ? ' · ' + (r as any).name : ''}`
              : (r as any).name,
        }
      : null;
  }
  return out;
}

export function registerIv(app: FastifyInstance, auth: (admin?: boolean) => any, bad: (reply: any, p: any) => any) {
  db.exec(`
CREATE TABLE IF NOT EXISTS iv_sets(
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, date TEXT NOT NULL DEFAULT '', system TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'shared' CHECK(visibility IN ('private','shared')), links TEXT NOT NULL DEFAULT '{}', notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS iv_curves(
  id INTEGER PRIMARY KEY, set_id INTEGER NOT NULL REFERENCES iv_sets(id) ON DELETE CASCADE,
  sample TEXT NOT NULL, substrate TEXT NOT NULL, scan TEXT NOT NULL, pixel TEXT NOT NULL, dir TEXT NOT NULL, file TEXT NOT NULL,
  area REAL NOT NULL, pin REAL NOT NULL, data TEXT NOT NULL, metrics TEXT NOT NULL, inst TEXT, use INTEGER);
CREATE INDEX IF NOT EXISTS iv_curves_set ON iv_curves(set_id);`);
  // device groups and devices left out of the plots (added in 0.17)
  if (!(db.prepare('PRAGMA table_info(iv_sets)').all() as { name: string }[]).some((c) => c.name === 'devices'))
    db.exec("ALTER TABLE iv_sets ADD COLUMN devices TEXT NOT NULL DEFAULT '{}'");
  if (!(db.prepare('PRAGMA table_info(iv_sets)').all() as { name: string }[]).some((c) => c.name === 'deleted_at'))
    db.exec('ALTER TABLE iv_sets ADD COLUMN deleted_at TEXT');
  // 0.23: stability tests. A follow-up measurement points at the first one of the series; measured_at is when it was measured
  if (!(db.prepare('PRAGMA table_info(iv_sets)').all() as { name: string }[]).some((c) => c.name === 'stability_of')) {
    db.exec('ALTER TABLE iv_sets ADD COLUMN stability_of INTEGER REFERENCES iv_sets(id) ON DELETE SET NULL');
    db.exec('ALTER TABLE iv_sets ADD COLUMN measured_at TEXT');
  }
  /** The first measurement of a series (follow-ups may point at another follow-up). */
  const baseOf = (id: number) => {
    let cur = id;
    for (let i = 0; i < 20; i++) {
      const r = db.prepare('SELECT stability_of FROM iv_sets WHERE id=?').get(cur) as
        { stability_of: number | null } | undefined;
      if (!r?.stability_of) return cur;
      cur = r.stability_of;
    }
    return cur;
  };
  const when = (s: any) =>
    s.measured_at ||
    (s.date ? `${s.date}T12:00:00.000Z` : new Date(s.created_at.replace(' ', 'T') + 'Z').toISOString());

  const setRow = (id: number) =>
    db
      .prepare(
        'SELECT s.*,u.name AS owner FROM iv_sets s JOIN users u ON u.id=s.owner_id WHERE s.id=? AND s.deleted_at IS NULL',
      )
      .get(id) as any;
  const summary = (s: any) => {
    const c = db.prepare('SELECT sample,substrate,metrics,use FROM iv_curves WHERE set_id=?').all(s.id) as {
      sample: string;
      substrate: string;
      metrics: string;
      use: number | null;
    }[];
    const ms = c.map((x) => ({ ...JSON.parse(x.metrics), use: x.use }));
    const ok = ms.filter((m) => m.status === 'ok' && m.use !== 0);
    return {
      id: s.id,
      name: s.name,
      date: s.date,
      system: s.system,
      visibility: s.visibility,
      owner: s.owner,
      created_at: s.created_at,
      samples: [...new Set(c.map((x) => x.sample))],
      substrates: new Set(c.map((x) => x.sample + '|' + x.substrate)).size,
      curves: c.length,
      working: ok.length,
      best: ok.reduce((b, m) => Math.max(b, m.pce ?? 0), 0),
      links: linkNames(JSON.parse(s.links)),
      devices: JSON.parse(s.devices || '{}'),
      stabilityOf: s.stability_of ?? null,
      measuredAt: when(s),
      followUps: (
        db.prepare('SELECT COUNT(*) AS n FROM iv_sets WHERE stability_of=? AND deleted_at IS NULL').get(s.id) as {
          n: number;
        }
      ).n,
    };
  };

  app.get('/api/iv', { preHandler: auth() }, async (req: any) =>
    (
      db
        .prepare(
          'SELECT s.*,u.name AS owner FROM iv_sets s JOIN users u ON u.id=s.owner_id WHERE s.deleted_at IS NULL ORDER BY s.date DESC, s.id DESC',
        )
        .all() as any[]
    )
      .filter((s) => visible(req.user, s))
      .map((s) => ({ ...summary(s), mine: s.owner_id === req.user.id })),
  );

  app.get('/api/iv/:id', { preHandler: auth() }, async (req: any, reply) => {
    const s = setRow(+req.params.id);
    if (!s || !visible(req.user, s)) return reply.code(404).send({ error: 'not found' });
    const curves = (
      db
        .prepare(
          'SELECT * FROM iv_curves WHERE set_id=? ORDER BY sample,CAST(substrate AS INTEGER),substrate,scan,pixel,dir',
        )
        .all(s.id) as any[]
    ).map((c) => ({
      id: c.id,
      sample: c.sample,
      substrate: c.substrate,
      scan: c.scan,
      pixel: c.pixel,
      dir: c.dir,
      file: c.file,
      area: c.area,
      pin: c.pin,
      ...JSON.parse(c.data),
      m: JSON.parse(c.metrics),
      inst: c.inst ? JSON.parse(c.inst) : null,
      use: c.use === null ? null : !!c.use,
    }));
    return { ...summary(s), notes: s.notes, editable: editable(req.user, s), rawLinks: JSON.parse(s.links), curves };
  });

  app.post('/api/iv', { preHandler: auth(), bodyLimit: 50 * 1024 * 1024 }, async (req: any, reply) => {
    const p = IvSetIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const d = p.data;
    const id = tx(() => {
      const r = db
        .prepare(
          'INSERT INTO iv_sets(owner_id,name,date,system,visibility,links,notes,devices,stability_of,measured_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          req.user.id,
          d.name,
          d.date,
          d.system,
          d.visibility,
          JSON.stringify(d.links),
          d.notes,
          JSON.stringify(d.devices),
          d.stability_of ? baseOf(d.stability_of) : null,
          d.measured_at ?? null,
        );
      const ins = db.prepare(
        'INSERT INTO iv_curves(set_id,sample,substrate,scan,pixel,dir,file,area,pin,data,metrics,inst) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      );
      for (const c of d.curves) {
        const m = ivMetrics(c.V, c.J, c.pin); // computed here so every client and every import uses the same numbers
        const mj = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' ? fin(v) : v]));
        ins.run(
          r.lastInsertRowid,
          c.sample,
          c.substrate,
          c.scan,
          c.pixel,
          c.dir,
          c.file,
          c.area,
          c.pin,
          JSON.stringify({ V: c.V, J: c.J }),
          JSON.stringify(mj),
          c.inst ? JSON.stringify(c.inst) : null,
        );
      }
      return Number(r.lastInsertRowid);
    });
    const record = d.stability_of ? null : checkRecord(id, req.user); // a follow-up of an aged device is no record
    return { id, record };
  });

  app.patch('/api/iv/:id', { preHandler: auth() }, async (req: any, reply) => {
    const s = setRow(+req.params.id);
    if (!s || !visible(req.user, s)) return reply.code(404).send({ error: 'not found' });
    if (!editable(req.user, s)) return reply.code(403).send({ error: 'not your measurement' });
    const p = IvSetPatch.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const d = p.data;
    if (d.name !== undefined) db.prepare('UPDATE iv_sets SET name=? WHERE id=?').run(d.name, s.id);
    if (d.visibility) db.prepare('UPDATE iv_sets SET visibility=? WHERE id=?').run(d.visibility, s.id);
    if (d.notes !== undefined) db.prepare('UPDATE iv_sets SET notes=? WHERE id=?').run(d.notes, s.id);
    if (d.links)
      db.prepare('UPDATE iv_sets SET links=? WHERE id=?').run(
        JSON.stringify({ ...JSON.parse(s.links), ...d.links }),
        s.id,
      );
    if (d.devices)
      db.prepare('UPDATE iv_sets SET devices=? WHERE id=?').run(
        JSON.stringify({ ...JSON.parse(s.devices || '{}'), ...d.devices }),
        s.id,
      );
    if (d.stability_of !== undefined) {
      const base = d.stability_of ? baseOf(d.stability_of) : null;
      if (base === s.id) return reply.code(400).send({ error: 'a measurement cannot follow itself' });
      if (
        base &&
        (
          db.prepare('SELECT COUNT(*) AS n FROM iv_sets WHERE stability_of=? AND deleted_at IS NULL').get(s.id) as {
            n: number;
          }
        ).n
      )
        return reply
          .code(400)
          .send({ error: 'this measurement already has follow-ups, so it is the first of its series' });
      db.prepare('UPDATE iv_sets SET stability_of=? WHERE id=?').run(base, s.id);
    }
    if (d.measured_at !== undefined) db.prepare('UPDATE iv_sets SET measured_at=? WHERE id=?').run(d.measured_at, s.id);
    return { ok: true };
  });

  app.patch('/api/iv/curves/:cid', { preHandler: auth() }, async (req: any, reply) => {
    const c = db
      .prepare('SELECT c.id,s.owner_id,s.visibility FROM iv_curves c JOIN iv_sets s ON s.id=c.set_id WHERE c.id=?')
      .get(+req.params.cid) as any;
    if (!c || !visible(req.user, c)) return reply.code(404).send({ error: 'not found' });
    if (!editable(req.user, c)) return reply.code(403).send({ error: 'not your measurement' });
    const p = IvCurvePatch.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    db.prepare('UPDATE iv_curves SET use=? WHERE id=?').run(p.data.use === null ? null : p.data.use ? 1 : 0, c.id);
    return { ok: true };
  });

  app.delete('/api/iv/:id', { preHandler: auth() }, async (req: any, reply) => {
    const s = setRow(+req.params.id);
    if (!s || !visible(req.user, s)) return reply.code(404).send({ error: 'not found' });
    if (!editable(req.user, s)) return reply.code(403).send({ error: 'not your measurement' });
    db.prepare('UPDATE iv_sets SET deleted_at=? WHERE id=?').run(new Date().toISOString(), s.id); // to the trash
    return { ok: true, trash: true };
  });

  /**
   * A stability series: the first measurement and its follow-ups, with each curve's numbers (no data points), for plotting the
   * devices against time. Pixels are matched by sample, substrate and pixel.
   */
  app.get('/api/iv/:id/stability', { preHandler: auth() }, async (req: any, reply) => {
    const base = baseOf(+req.params.id),
      b = setRow(base);
    if (!b || !visible(req.user, b)) return reply.code(404).send({ error: 'not found' });
    const sets = [
      b,
      ...(
        db
          .prepare(
            'SELECT s.*,u.name AS owner FROM iv_sets s JOIN users u ON u.id=s.owner_id WHERE s.stability_of=? AND s.deleted_at IS NULL',
          )
          .all(base) as any[]
      ).filter((s) => visible(req.user, s)),
    ];
    return {
      base,
      sets: sets
        .map((s) => ({ id: s.id, name: s.name, measuredAt: when(s) }))
        .sort((x, y) => x.measuredAt.localeCompare(y.measuredAt)),
      links: linkNames(JSON.parse(b.links)),
      points: sets.flatMap((s) =>
        (
          db
            .prepare('SELECT sample,substrate,pixel,scan,dir,metrics,use FROM iv_curves WHERE set_id=?')
            .all(s.id) as any[]
        ).map((c) => ({
          set: s.id,
          sample: c.sample,
          substrate: c.substrate,
          pixel: c.pixel,
          scan: c.scan,
          dir: c.dir,
          m: JSON.parse(c.metrics),
          use: c.use === null ? null : !!c.use,
        })),
      ),
    };
  });

  /** Measurement sets with at least one sample linked to this batch (or to the stack it was started from). */
  app.get('/api/batches/:id/iv', { preHandler: auth() }, async (req: any) => {
    const bid = +req.params.id;
    return (
      db
        .prepare(
          'SELECT s.*,u.name AS owner FROM iv_sets s JOIN users u ON u.id=s.owner_id WHERE s.deleted_at IS NULL ORDER BY s.date DESC',
        )
        .all() as any[]
    )
      .filter((s) => visible(req.user, s))
      .map((s) => ({
        s,
        samples: Object.entries(JSON.parse(s.links) as Record<string, Link>)
          .filter(([, l]) => l?.kind === 'batch' && l.id === bid)
          .map(([k]) => k),
      }))
      .filter((x) => x.samples.length)
      .map((x) => ({ ...summary(x.s), linkedSamples: x.samples }));
  });
}
