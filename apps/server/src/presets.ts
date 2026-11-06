import type { FastifyInstance } from 'fastify';
import { lockedByCode } from './batchlock.js';
import { PresetIn, RunIn } from '@psc/schema';
import { db } from './db.js';
import { notifyFork } from './social.js';

type U = { id: number; role: 'admin' | 'member'; all?: boolean };
type Row = {
  id: number;
  segment: string;
  name: string;
  visibility: string;
  data: string;
  owner_id: number;
  parent_id: number | null;
  owner: string;
  updated_at: string;
};

const visible = (u: U, r: { owner_id: number; visibility: string }) =>
  r.owner_id === u.id || r.visibility === 'shared' || !!u.all;
const SELECT = `SELECT p.id,p.segment,p.name,p.visibility,p.data,p.owner_id,p.parent_id,u.name AS owner,p.updated_at FROM presets p JOIN users u ON u.id=p.owner_id`;

/** Where each preset is referenced: stacks (live references) and batches (frozen snapshots). */
type Usage = {
  stacks: { id: number; name: string }[];
  batches: { id: number; code: string }[];
  presets: { id: number; name: string; segment: string }[];
};
const REF_KEYS = ['subId', 'maskId']; // design references inside other presets (masks -> substrate, recipes -> substrate/mask)
function usageMap() {
  const m = new Map<string, Usage>();
  const at = (k: string) => {
    if (!m.has(k)) m.set(k, { stacks: [], batches: [], presets: [] });
    return m.get(k)!;
  };
  for (const r of db
    .prepare("SELECT id,name,segment,data FROM presets WHERE segment<>'stk' AND deleted_at IS NULL")
    .all() as { id: number; name: string; segment: string; data: string }[]) {
    const d = JSON.parse(r.data);
    for (const k of REF_KEYS) if (d[k]) at(String(d[k])).presets.push({ id: r.id, name: r.name, segment: r.segment });
  }
  for (const r of db.prepare("SELECT id,name,data FROM presets WHERE segment='stk' AND deleted_at IS NULL").all() as {
    id: number;
    name: string;
    data: string;
  }[])
    for (const k of new Set((JSON.parse(r.data).sl ?? []).flatMap((x: any) => [x.a, x.b]).filter(Boolean) as string[]))
      at(k).stacks.push({ id: r.id, name: r.name });
  for (const r of db.prepare('SELECT id,code,snapshot FROM batches WHERE deleted_at IS NULL').all() as {
    id: number;
    code: string;
    snapshot: string;
  }[])
    for (const k of new Set(
      (JSON.parse(r.snapshot).stack?.sl ?? []).flatMap((x: any) => [x.a, x.b]).filter(Boolean) as string[],
    ))
      at(k).batches.push({ id: r.id, code: r.code });
  return (id: number): Usage => m.get(String(id)) ?? { stacks: [], batches: [], presets: [] };
}

/** All presets in the same family tree (root ancestor and every descendant). */
function family(id: number) {
  const seg = (db.prepare('SELECT segment FROM presets WHERE id=?').get(id) as { segment: string }).segment;
  const all = db
    .prepare(SELECT.replace(' FROM presets', ', p.deleted_at AS gone FROM presets') + ' WHERE p.segment=?')
    .all(seg) as (Row & { gone: string | null })[];
  const byId = new Map(all.map((r) => [r.id, r]));
  let root = byId.get(id)!;
  const seen = new Set<number>();
  while (root.parent_id && byId.has(root.parent_id) && !seen.has(root.id)) {
    seen.add(root.id);
    root = byId.get(root.parent_id)!;
  }
  const out: (Row & { gone: string | null })[] = [],
    stack = [root];
  while (stack.length) {
    const r = stack.pop()!;
    out.push(r);
    stack.push(...all.filter((c) => c.parent_id === r.id));
  }
  return out.filter((r) => !r.gone); // trashed versions keep the tree connected but are not listed
}

const nextName = (name: string, fam: Row[]) => {
  const base = name.replace(/ v\d+$/, '');
  const n = Math.max(1, ...fam.map((r) => (r.name.startsWith(base + ' v') ? +r.name.slice(base.length + 2) || 1 : 1)));
  return `${base} v${n + 1}`;
};

/** Starter substrate designs matching the two substrates used so far (created once, owned by the first admin, shared). */
function seedSubstrates() {
  if (db.prepare("SELECT 1 FROM presets WHERE segment='sub' LIMIT 1").get()) return;
  const admin = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get() as
    { id: number } | undefined;
  if (!admin) return;
  const ins = db.prepare("INSERT INTO presets(owner_id,segment,name,visibility,data) VALUES(?,'sub',?,'shared',?)");
  const rect = (id: string, x: number, y: number, w: number, h: number) => ({ id, kind: 'rect', x, y, w, h });
  ins.run(
    admin.id,
    'ITO 12 × 12 mm, two side strips',
    JSON.stringify({
      w: 12,
      h: 12,
      ito: [rect('ito1', 2, 0, 8, 12)],
      rs: 15,
      t: 150,
      supplier: '',
      marker: 'tl',
      notes: 'ITO-free strips of 2 mm on two opposite edges.',
    }),
  );
  ins.run(
    admin.id,
    'ITO 25 × 15 mm, bottom strip',
    JSON.stringify({
      w: 25,
      h: 15,
      ito: [rect('ito1', 0, 0, 25, 12)],
      rs: 15,
      t: 150,
      supplier: '',
      marker: 'tl',
      notes: 'ITO-free strip of 3 mm along one long edge.',
    }),
  );
}

export function registerPresets(
  app: FastifyInstance,
  auth: (admin?: boolean) => any,
  bad: (reply: any, p: any) => any,
) {
  seedSubstrates();
  app.get('/api/presets', { preHandler: auth() }, async (req: any) => {
    const use = usageMap();
    const rows = db
      .prepare(
        SELECT +
          ` WHERE p.deleted_at IS NULL AND (@seg IS NULL OR p.segment=@seg) AND (p.owner_id=@uid OR p.visibility='shared' OR @all=1) ORDER BY p.updated_at DESC`,
      )
      .all({ seg: req.query.segment ?? null, uid: req.user.id, all: req.user.all ? 1 : 0 }) as Row[];
    return rows.map((r) => {
      const u = use(r.id);
      return {
        ...r,
        data: JSON.parse(r.data),
        mine: r.owner_id === req.user.id ? 1 : 0,
        used: u.stacks.length + u.batches.length + u.presets.length,
      };
    });
  });

  app.get('/api/presets/:id', { preHandler: auth() }, async (req: any, reply) => {
    const r = db.prepare(SELECT + ' WHERE p.id=? AND p.deleted_at IS NULL').get(+req.params.id) as Row | undefined;
    if (!r || !visible(req.user, r)) return reply.code(404).send({ error: 'not found' });
    const use = usageMap();
    return {
      ...r,
      data: JSON.parse(r.data),
      mine: r.owner_id === req.user.id ? 1 : 0,
      usage: use(r.id),
      family: family(r.id).map((f) =>
        visible(req.user, f)
          ? {
              id: f.id,
              name: f.name,
              parent_id: f.parent_id,
              owner: f.owner,
              updated_at: f.updated_at,
              data: JSON.parse(f.data),
            }
          : {
              id: f.id,
              name: 'Private preset',
              parent_id: f.parent_id,
              owner: f.owner,
              updated_at: f.updated_at,
              hidden: true,
            },
      ),
    };
  });

  app.post('/api/presets', { preHandler: auth() }, async (req: any, reply) => {
    const p = PresetIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const r = db
      .prepare('INSERT INTO presets(owner_id,segment,name,visibility,data,parent_id) VALUES(?,?,?,?,?,?)')
      .run(
        req.user.id,
        p.data.segment,
        p.data.name,
        p.data.visibility,
        JSON.stringify(p.data.data),
        p.data.parent_id ?? null,
      );
    if (p.data.parent_id) notifyFork(Number(r.lastInsertRowid), p.data.parent_id, req.user);
    return { id: Number(r.lastInsertRowid) };
  });

  // Saving a preset that is used by a stack or batch, or owned by someone else, creates a new version (child) instead of overwriting.
  app.put('/api/presets/:id', { preHandler: auth() }, async (req: any, reply) => {
    const p = PresetIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const id = +req.params.id,
      r = db.prepare(SELECT + ' WHERE p.id=? AND p.deleted_at IS NULL').get(id) as Row | undefined;
    if (!r || !visible(req.user, r)) return reply.code(404).send({ error: 'not found' });
    const u = usageMap()(id),
      reasons: string[] = [];
    if (u.stacks.length) reasons.push(`used in ${u.stacks.length} stack${u.stacks.length > 1 ? 's' : ''}`);
    if (u.batches.length) reasons.push(`used in ${u.batches.length} batch${u.batches.length > 1 ? 'es' : ''}`);
    if (u.presets.length)
      reasons.push(
        `used by ${u.presets.length} other design${u.presets.length > 1 ? 's' : ''} or recipe${u.presets.length > 1 ? 's' : ''}`,
      );
    if (r.owner_id !== req.user.id) reasons.push(`owned by ${r.owner}`);
    if (!reasons.length) {
      db.prepare('UPDATE presets SET name=?,visibility=?,data=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(
        p.data.name,
        p.data.visibility,
        JSON.stringify(p.data.data),
        id,
      );
      return { id, forked: false, name: p.data.name };
    }
    const name = p.data.name === r.name ? nextName(r.name, family(id)) : p.data.name;
    const n = db
      .prepare('INSERT INTO presets(owner_id,segment,name,visibility,data,parent_id) VALUES(?,?,?,?,?,?)')
      .run(req.user.id, r.segment, name, p.data.visibility, JSON.stringify(p.data.data), id);
    notifyFork(Number(n.lastInsertRowid), id, req.user);
    return { id: Number(n.lastInsertRowid), forked: true, name, reasons };
  });

  app.delete('/api/presets/:id', { preHandler: auth() }, async (req: any, reply) => {
    const id = +req.params.id,
      r = db.prepare('SELECT owner_id,parent_id FROM presets WHERE id=? AND deleted_at IS NULL').get(id) as
        { owner_id: number; parent_id: number | null } | undefined;
    if (!r) return reply.code(404).send({ error: 'not found' });
    if (r.owner_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'not your preset' });
    const u = usageMap()(id);
    if (u.stacks.length || u.presets.length)
      return reply
        .code(409)
        .send({ error: `used by ${[...u.stacks, ...u.presets].map((s) => s.name).join(', ')}; remove it there first` });
    db.prepare('UPDATE presets SET deleted_at=? WHERE id=?').run(new Date().toISOString(), id); // to the trash: restorable for 30 days
    return { ok: true, trash: true };
  });

  // ---- run data: structured entries from lab notes, attached to a preset ----
  const presetVisible = (req: any, reply: any) => {
    const r = db.prepare('SELECT owner_id,visibility FROM presets WHERE id=?').get(+req.params.id) as
      { owner_id: number; visibility: string } | undefined;
    if (!r || !visible(req.user, r)) {
      reply.code(404).send({ error: 'not found' });
      return false;
    }
    return true;
  };
  app.get('/api/presets/:id/runs', { preHandler: auth() }, async (req: any, reply) => {
    if (!presetVisible(req, reply)) return;
    return (
      db
        .prepare(
          'SELECT r.id,r.batch,r.data,r.created_at,r.owner_id,u.name AS author FROM run_data r JOIN users u ON u.id=r.owner_id WHERE r.preset_id=? ORDER BY r.id DESC',
        )
        .all(+req.params.id) as any[]
    ).map((r) => ({ ...r, ...JSON.parse(r.data), data: undefined, mine: r.owner_id === req.user.id ? 1 : 0 }));
  });
  app.post('/api/presets/:id/runs', { preHandler: auth() }, async (req: any, reply) => {
    if (!presetVisible(req, reply)) return;
    const p = RunIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const { batch, ...rest } = p.data;
    const lk = lockedByCode(batch);
    if (lk) return reply.code(423).send({ error: lk });
    const r = db
      .prepare('INSERT INTO run_data(preset_id,owner_id,batch,data) VALUES(?,?,?,?)')
      .run(+req.params.id, req.user.id, batch, JSON.stringify(rest));
    return { id: Number(r.lastInsertRowid) };
  });
  app.delete('/api/runs/:id', { preHandler: auth() }, async (req: any, reply) => {
    const r = db.prepare('SELECT owner_id,batch FROM run_data WHERE id=?').get(+req.params.id) as
      { owner_id: number; batch: string } | undefined;
    if (!r) return reply.code(404).send({ error: 'not found' });
    if (r.owner_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'not your entry' });
    const lk = lockedByCode(r.batch);
    if (lk) return reply.code(423).send({ error: lk });
    db.prepare('DELETE FROM run_data WHERE id=?').run(+req.params.id);
    return { ok: true };
  });
}
