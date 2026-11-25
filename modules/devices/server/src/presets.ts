import type { FastifyInstance } from 'fastify';
import { lockedByCode } from './batchlock.js';
import { retakeForBatch } from './takes.js';
import { PresetIn, RunIn } from '@psc/devices/schema';
import { DESIGN_SEGMENTS } from '@psc/devices';
import { notifyFork } from './notices.js';
import { stackLines } from './lines.js';
import { canSee, db } from '@psc/server/api';

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

const SELECT = `SELECT p.id,p.segment,p.name,p.visibility,p.data,p.owner_id,p.parent_id,u.name AS owner,p.updated_at FROM presets p JOIN users u ON u.id=p.owner_id`;

/** Where each preset is referenced: stacks (live references) and batches (frozen snapshots). */
type Usage = {
  stacks: { id: number; name: string }[];
  batches: { id: number; code: string; name: string }[];
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
  for (const r of db.prepare('SELECT id,code,name,snapshot FROM batches WHERE deleted_at IS NULL').all() as {
    id: number;
    code: string;
    name: string;
    snapshot: string;
  }[])
    for (const k of new Set(
      (JSON.parse(r.snapshot).stack?.sl ?? []).flatMap((x: any) => [x.a, x.b]).filter(Boolean) as string[],
    ))
      at(k).batches.push({ id: r.id, code: r.code, name: r.name });
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

/** Designs belong to the lab (0.58): admins and people with the designs permission make, change and remove them. */
const isDesign = (segment: string) => DESIGN_SEGMENTS.includes(segment);
export const canDesign = (u: { role: string; grants?: string[] }) =>
  u.role === 'admin' || !!u.grants?.includes('designs');
const NEEDS_DESIGNS = { error: 'only admins and people with Edit designs can change designs' };

/**
 * The two usual architectures (0.58), given to every lab once, as its first entries, which it can then change or remove.
 * Generic, not a lab's data. A design needs an owner: the first admin, so a new install gets them once first setup has
 * made one (checked again whenever presets are listed until then).
 */
export const STARTER_ARCHS: { name: string; pol: string; layers: [string, string][] }[] = [
  {
    name: 'p-i-n',
    pol: 'p-i-n',
    layers: [
      ['Substrate', 'Substrate'],
      ['HTL / SAM', 'Spin'],
      ['Perovskite', 'Spin'],
      ['Passivation', 'Spin'],
      ['ETL (C60)', 'Organic evap'],
      ['BCP', 'Organic evap'],
      ['Metal contact', 'Metal evap'],
    ],
  },
  {
    name: 'n-i-p',
    pol: 'n-i-p',
    layers: [
      ['Substrate', 'Substrate'],
      ['ETL', 'Spin'],
      ['Perovskite', 'Spin'],
      ['HTL', 'Spin'],
      ['Metal contact', 'Metal evap'],
    ],
  },
];
let archsGiven = false;
export function giveStarterArchs() {
  if (archsGiven) return;
  if (db.prepare("SELECT value FROM meta WHERE key='archs_given'").get()) {
    archsGiven = true;
    return;
  }
  const admin = db.prepare("SELECT id FROM users WHERE role='admin' AND deleted=0 ORDER BY id LIMIT 1").get() as
    { id: number } | undefined;
  if (!admin) return;
  const add = db.prepare("INSERT INTO presets(owner_id,segment,name,visibility,data) VALUES(?,'arch',?,'shared',?)");
  for (const a of STARTER_ARCHS)
    add.run(admin.id, a.name, JSON.stringify({ pol: a.pol, layers: a.layers.map(([n, m]) => ({ n, m })) }));
  db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('archs_given','1')").run();
  archsGiven = true;
}

const nextName = (name: string, fam: Row[]) => {
  const base = name.replace(/ v\d+$/, '');
  const n = Math.max(1, ...fam.map((r) => (r.name.startsWith(base + ' v') ? +r.name.slice(base.length + 2) || 1 : 1)));
  return `${base} v${n + 1}`;
};

export function registerPresets(
  app: FastifyInstance,
  auth: (admin?: boolean) => any,
  bad: (reply: any, p: any) => any,
) {
  giveStarterArchs();
  app.get('/api/presets', { preHandler: auth() }, async (req: any) => {
    giveStarterArchs();
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
    if (!r || !canSee(req.user, r)) return reply.code(404).send({ error: 'not found' });
    const use = usageMap();
    // stacks (0.61): which stack made from each one continues its line, and whether the viewer may choose it (its owner)
    const lines = r.segment === 'stk' ? stackLines() : null,
      line = (f: Row) =>
        lines
          ? (() => {
              const l = lines.meta(lines.tree.lineOf.get(f.id) ?? f.id, req.user);
              return {
                next: lines.tree.next(f.id),
                mayChoose: f.owner_id === req.user.id,
                line: l,
              };
            })()
          : {};
    return {
      ...r,
      data: JSON.parse(r.data),
      mine: r.owner_id === req.user.id ? 1 : 0,
      usage: use(r.id),
      ...(lines ? { line: lines.meta(lines.tree.lineOf.get(r.id) ?? r.id, req.user) } : {}),
      family: family(r.id).map((f) =>
        canSee(req.user, f)
          ? {
              id: f.id,
              name: f.name,
              parent_id: f.parent_id,
              owner: f.owner,
              updated_at: f.updated_at,
              data: JSON.parse(f.data),
              ...line(f),
            }
          : {
              id: f.id,
              name: 'Private preset',
              parent_id: f.parent_id,
              owner: f.owner,
              updated_at: f.updated_at,
              hidden: true,
              ...line(f),
            },
      ),
    };
  });

  app.post('/api/presets', { preHandler: auth() }, async (req: any, reply) => {
    const p = PresetIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    if (isDesign(p.data.segment)) {
      if (!canDesign(req.user)) return reply.code(403).send(NEEDS_DESIGNS);
      p.data.visibility = 'shared';
    }
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
    if (!r || !canSee(req.user, r)) return reply.code(404).send({ error: 'not found' });
    const design = isDesign(r.segment);
    if (design) {
      if (!canDesign(req.user)) return reply.code(403).send(NEEDS_DESIGNS);
      p.data.visibility = 'shared';
    }
    const u = usageMap()(id),
      reasons: string[] = [];
    if (u.stacks.length) reasons.push(`used in ${u.stacks.length} stack${u.stacks.length > 1 ? 's' : ''}`);
    if (u.batches.length) reasons.push(`used in ${u.batches.length} batch${u.batches.length > 1 ? 'es' : ''}`);
    if (u.presets.length)
      reasons.push(
        `used by ${u.presets.length} other design${u.presets.length > 1 ? 's' : ''} or recipe${u.presets.length > 1 ? 's' : ''}`,
      );
    // a design is the lab's: whoever may change it changes it in place, unless something uses it
    if (r.owner_id !== req.user.id && !design) reasons.push(`owned by ${r.owner}`);
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
      r = db.prepare('SELECT owner_id,parent_id,segment FROM presets WHERE id=? AND deleted_at IS NULL').get(id) as
        { owner_id: number; parent_id: number | null; segment: string } | undefined;
    if (!r) return reply.code(404).send({ error: 'not found' });
    if (isDesign(r.segment) ? !canDesign(req.user) : r.owner_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send(isDesign(r.segment) ? NEEDS_DESIGNS : { error: 'not your preset' });
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
    if (!r || !canSee(req.user, r)) {
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
          'SELECT r.id,r.batch,b.name AS batch_name,r.data,r.created_at,r.owner_id,u.name AS author FROM run_data r JOIN users u ON u.id=r.owner_id LEFT JOIN batches b ON b.code=r.batch AND b.deleted_at IS NULL WHERE r.preset_id=? ORDER BY r.id DESC',
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
    retakeForBatch(batch); // what was weighed or dispensed replaces the planned amounts in the inventory
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
    retakeForBatch(r.batch);
    return { ok: true };
  });
}
