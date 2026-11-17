import type { FastifyInstance } from 'fastify';
import { ivMetrics, sweepDir } from '@psc/devices';
import { classifySet, markShortsInSet } from './ivdata.js';
import { IvCurvePatch, IvSetIn, IvSetPatch } from '@psc/devices/schema';
import { checkRecord } from './notices.js';
import { canSee, db, tx } from '@psc/server/api';

type U = { id: number; role: 'admin' | 'member'; all?: boolean };
type Link = { kind: 'batch' | 'stack'; id: number; variant?: string } | null;
const editable = (u: U, r: { owner_id: number }) => r.owner_id === u.id || u.role === 'admin';
const fin = (x: number) => (Number.isFinite(x) ? x : null); // JSON has no NaN/Infinity

/** Names for the batches and stacks samples are linked to (the groups shown in the statistics). */
export function linkNames(links: Record<string, Link>) {
  const out: Record<string, { kind: string; id: number; variant?: string; label: string } | null> = {};
  for (const [s, l] of Object.entries(links)) {
    if (!l) {
      out[s] = null;
      continue;
    }
    if (l.kind === 'batch') {
      const r = db.prepare('SELECT code,name,variants FROM batches WHERE id=?').get(l.id) as
        { code: string; name: string; variants: string } | undefined;
      // a variant that was removed from the batch falls back to the batch itself
      const v = l.variant
        ? (JSON.parse(r?.variants ?? '{}').list ?? []).find((x: { id: string }) => x.id === l.variant)
        : null;
      out[s] = r
        ? {
            kind: 'batch',
            id: l.id,
            ...(v ? { variant: v.id } : {}),
            label: v ? `${r.name} · ${v.name}` : r.name,
          }
        : null;
      continue;
    }
    const r = db.prepare("SELECT name FROM presets WHERE id=? AND segment='stk'").get(l.id) as
      { name: string } | undefined;
    out[s] = r ? { kind: 'stack', id: l.id, label: r.name } : null;
  }
  return out;
}

export function registerIv(app: FastifyInstance, auth: (admin?: boolean) => any, bad: (reply: any, p: any) => any) {
  const classify = (setId: number) => classifySet(db, setId);
  const markShorts = (setId: number) => markShortsInSet(db, setId);
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
    const c = db.prepare('SELECT sample,substrate,metrics,use,kind FROM iv_curves WHERE set_id=?').all(s.id) as {
      sample: string;
      substrate: string;
      metrics: string;
      use: number | null;
      kind: string | null;
    }[];
    const ms = c.map((x) => ({ ...JSON.parse(x.metrics), use: x.use, kind: x.kind }));
    // counted: ticked in, or working and not a check sweep nor a later reading of a lifetime run (kind set)
    const ok = ms.filter((m) => m.status === 'ok' && (m.use === 1 || (m.use === null && !m.kind)));
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
      kind: s.kind ?? 'jv',
      ...(s.kind === 'lifetime' && s.life
        ? (() => {
            const l = JSON.parse(s.life);
            return { life: { run: l.run, start: l.start, points: l.times.length, span: l.times.at(-1) ?? 0 } };
          })()
        : {}),
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
      .filter((s) => canSee(req.user, s))
      .map((s) => ({ ...summary(s), mine: s.owner_id === req.user.id })),
  );

  app.get('/api/iv/:id', { preHandler: auth() }, async (req: any, reply) => {
    const s = setRow(+req.params.id);
    if (!s || !canSee(req.user, s)) return reply.code(404).send({ error: 'not found' });
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
      kind: c.kind ?? null,
      t: c.t ?? null,
    }));
    return {
      ...summary(s),
      notes: s.notes,
      editable: editable(req.user, s),
      rawLinks: JSON.parse(s.links),
      curves,
      ...(s.life ? { lifeRun: JSON.parse(s.life) } : {}),
    };
  });

  app.post('/api/iv', { preHandler: auth(), bodyLimit: 50 * 1024 * 1024 }, async (req: any, reply) => {
    const p = IvSetIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const d = p.data;
    const id = tx(() => {
      const r = db
        .prepare(
          'INSERT INTO iv_sets(owner_id,name,date,system,visibility,links,notes,devices,stability_of,measured_at,kind,life) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
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
          d.measured_at ?? (d.kind === 'lifetime' && d.life ? new Date(d.life.start).toISOString() : null),
          d.kind,
          d.kind === 'lifetime' && d.life ? JSON.stringify(d.life) : null,
        );
      const ins = db.prepare(
        'INSERT INTO iv_curves(set_id,sample,substrate,scan,pixel,dir,file,area,pin,data,metrics,inst,t) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
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
          sweepDir(c.V) ?? c.dir, // the voltages decide the direction, whatever the client sent (0.55.3)
          c.file,
          c.area,
          c.pin,
          JSON.stringify({ V: c.V, J: c.J }),
          JSON.stringify(mj),
          c.inst ? JSON.stringify(c.inst) : null,
          c.t ?? null,
        );
      }
      classify(Number(r.lastInsertRowid));
      // a lifetime run counts its first reading like any measurement; the later readings are the ageing, kept out of statistics
      if (d.kind === 'lifetime')
        db.prepare(
          "UPDATE iv_curves SET kind='life' WHERE set_id=? AND scan > (SELECT MIN(scan) FROM iv_curves WHERE set_id=?)",
        ).run(r.lastInsertRowid, r.lastInsertRowid);
      markShorts(Number(r.lastInsertRowid));
      return Number(r.lastInsertRowid);
    });
    const record = d.stability_of ? null : checkRecord(id, req.user); // a follow-up of an aged device is no record
    return { id, record };
  });

  app.patch('/api/iv/:id', { preHandler: auth() }, async (req: any, reply) => {
    const s = setRow(+req.params.id);
    if (!s || !canSee(req.user, s)) return reply.code(404).send({ error: 'not found' });
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
    if (!c || !canSee(req.user, c)) return reply.code(404).send({ error: 'not found' });
    if (!editable(req.user, c)) return reply.code(403).send({ error: 'not your measurement' });
    const p = IvCurvePatch.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    db.prepare('UPDATE iv_curves SET use=? WHERE id=?').run(p.data.use === null ? null : p.data.use ? 1 : 0, c.id);
    return { ok: true };
  });

  app.delete('/api/iv/:id', { preHandler: auth() }, async (req: any, reply) => {
    const s = setRow(+req.params.id);
    if (!s || !canSee(req.user, s)) return reply.code(404).send({ error: 'not found' });
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
    if (!b || !canSee(req.user, b)) return reply.code(404).send({ error: 'not found' });
    const sets = [
      b,
      ...(
        db
          .prepare(
            'SELECT s.*,u.name AS owner FROM iv_sets s JOIN users u ON u.id=s.owner_id WHERE s.stability_of=? AND s.deleted_at IS NULL',
          )
          .all(base) as any[]
      ).filter((s) => canSee(req.user, s)),
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
            .prepare('SELECT sample,substrate,pixel,scan,dir,metrics,use,kind FROM iv_curves WHERE set_id=?')
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
          kind: c.kind ?? null,
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
      .filter((s) => canSee(req.user, s))
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
