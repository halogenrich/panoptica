import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canSee, db } from '@psc/server/api';
import { lineColor, lineTree } from '@psc/devices';

/**
 * Lines of research (0.61): a starting stack and the stacks that came from it (see `lineTree`). Each batch is in the line of the
 * stack it was started from (`snapshot.source`), at its best device. The Lab page shows the lines each person picks; My progress
 * the lines of the person's own batches (`personLines`). The owner of a stack where it branches picks which stack continues; the
 * owner of a line's starting stack names it and picks its colour (Richard, 25 Nov).
 */

type StackRow = {
  id: number;
  name: string;
  owner_id: number;
  owner: string;
  visibility: string;
  parent_id: number | null;
  line_next: number | null;
};
export type LineMeta = {
  id: number;
  name: string;
  color: string;
  /** the starting stack's name, which the line has until its owner names it (empty when the viewer cannot open it) */
  stack: string;
  /** the line's starting stack: its owner names the line and picks its colour */
  ownerId: number;
  owner: string;
  /** the starting stack is one the viewer cannot open: the line shows as "Private stack (owner)" */
  hidden: boolean;
  /** a name or colour the owner chose (else the starting stack's name and a colour by its place) */
  custom: { name: boolean; color: boolean };
};

/** Every stack (in the trash too: they keep the chains whole, and their batches still count) sorted into lines. */
export function stackLines() {
  const rows = db
    .prepare(
      `SELECT p.id,p.name,p.owner_id,u.name AS owner,p.visibility,p.parent_id,p.line_next FROM presets p
       JOIN users u ON u.id=p.owner_id WHERE p.segment='stk' ORDER BY p.id`,
    )
    .all() as StackRow[];
  const byId = new Map(rows.map((r) => [r.id, r])),
    tree = lineTree(rows),
    own = new Map(
      (
        db.prepare('SELECT stack_id,name,color FROM stack_lines').all() as {
          stack_id: number;
          name: string | null;
          color: string | null;
        }[]
      ).map((r) => [r.stack_id, r]),
    ),
    ids = [...tree.lines.keys()];
  const meta = (id: number, viewer: { id: number; all?: boolean }): LineMeta => {
    const s = byId.get(id)!,
      o = own.get(id),
      hidden = !canSee(viewer, s);
    return {
      id,
      name: hidden ? `Private stack (${s.owner})` : o?.name || s.name,
      stack: hidden ? '' : s.name,
      color: o?.color || lineColor(ids, id),
      ownerId: s.owner_id,
      owner: s.owner,
      hidden,
      custom: { name: !!o?.name, color: !!o?.color },
    };
  };
  return { tree, byId, meta };
}

type Curve = {
  set_id: number;
  sample: string;
  substrate: string;
  metrics: string;
  use: number | null;
  kind: string | null;
};
type SetRow = {
  id: number;
  name: string;
  date: string;
  created_at: string;
  links: string;
  owner_id: number;
  visibility?: string;
};
export const dayOf = (s: { date: string; created_at: string }) =>
  s.date && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : s.created_at.slice(0, 10);
export const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y),
    m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The device that counts in each set: its best counted pixel (as the Overview counts: ok, not left out, check sweeps only if ticked in). */
function devicesOf(curves: Curve[]) {
  const by = new Map<string, number>();
  for (const c of curves) {
    const m = JSON.parse(c.metrics);
    if (m.status !== 'ok' || c.use === 0 || (c.kind && c.use !== 1) || !Number.isFinite(m.pce)) continue;
    const k = `${c.set_id}|${c.sample}|${c.substrate}`;
    by.set(k, Math.max(by.get(k) ?? 0, m.pce));
  }
  return by;
}

export type Top = { pce: number; setId: number; set: string; sample: string; substrate: string; day: string };
export type Group = { kind: 'batch' | 'set'; id: number; day: string; pces: number[]; top: Top };

/**
 * Devices grouped by the batch their sample is linked to; devices linked to no batch by their measurement (0.60, My progress), so
 * nothing measured is left off a chart. The day is the first measurement's.
 */
export function groupDevices(sets: SetRow[]) {
  const curves = sets.length
    ? (db
        .prepare(
          `SELECT set_id,sample,substrate,metrics,use,kind FROM iv_curves WHERE set_id IN (${sets.map(() => '?').join(',')})`,
        )
        .all(...sets.map((s) => s.id)) as Curve[])
    : [];
  const dev = devicesOf(curves),
    setOf = new Map(sets.map((s) => [s.id, s])),
    groups = new Map<string, Group>();
  for (const [k, pce] of dev) {
    const [sid, sample, substrate] = k.split('|'),
      s = setOf.get(+sid)!,
      link = (JSON.parse(s.links || '{}') as Record<string, { kind: string; id: number } | null>)[sample],
      batch = link?.kind === 'batch',
      key = batch ? 'b' + link!.id : 's' + s.id,
      day = dayOf(s),
      top: Top = { pce, setId: s.id, set: s.name, sample, substrate, day };
    const g = groups.get(key);
    if (!g) groups.set(key, { kind: batch ? 'batch' : 'set', id: batch ? link!.id : s.id, day, pces: [pce], top });
    else {
      g.pces.push(pce);
      if (day < g.day) g.day = day;
      if (pce > g.top.pce) g.top = top;
    }
  }
  return { dev, groups };
}

type BatchRow = {
  id: number;
  name: string;
  owner_id: number;
  owner: string;
  visibility: string;
  source: number | null;
};
const batchRows = () =>
  db
    .prepare(
      `SELECT b.id,b.name,b.owner_id,u.name AS owner,b.visibility,json_extract(b.snapshot,'$.source') AS source
       FROM batches b JOIN users u ON u.id=b.owner_id WHERE b.deleted_at IS NULL`,
    )
    .all() as BatchRow[];

/** A batch on a line's chart. */
export type LinePoint = {
  batch: number;
  name: string;
  owner: string;
  day: string;
  best: number;
  median: number | null;
  devices: number;
  /** the stack it was started from, and the line that stack is in */
  stack: number | null;
  line: number | null;
  top: Top;
};

/**
 * The Lab page's lines: every line with a batch the viewer may see (shared ones and their own; everything for those who see
 * everything, as the rest of the Lab page), each with those batches at their best device.
 */
export function labLines(viewer: { id: number; all?: boolean }, seeAll: boolean) {
  const visible = (r: { owner_id: number; visibility: string }) =>
    seeAll || r.visibility === 'shared' || r.owner_id === viewer.id;
  const sets = (
    db
      .prepare(
        'SELECT id,name,date,created_at,links,owner_id,visibility FROM iv_sets WHERE deleted_at IS NULL AND stability_of IS NULL',
      )
      .all() as SetRow[]
  ).filter((s) => visible({ owner_id: s.owner_id, visibility: s.visibility ?? 'private' }));
  const { groups } = groupDevices(sets),
    { tree, meta } = stackLines(),
    points: LinePoint[] = [];
  for (const b of batchRows()) {
    if (!visible(b)) continue;
    const g = groups.get('b' + b.id),
      line = b.source != null ? (tree.lineOf.get(b.source) ?? null) : null;
    if (!g || line == null) continue;
    points.push(pointOf(b, g, line));
  }
  const ids = [...new Set(points.map((p) => p.line!))];
  return {
    lines: ids.map((id) => ({ ...meta(id, viewer), last: max(points.filter((p) => p.line === id).map((p) => p.day)) })),
    points: points.sort((a, b) => a.day.localeCompare(b.day)),
  };
}
const max = (a: string[]) => a.reduce((m, x) => (x > m ? x : m), '');
const pointOf = (
  b: { id: number; name: string; owner: string; source: number | null },
  g: Group,
  line: number | null,
) => ({
  batch: b.id,
  name: b.name,
  owner: b.owner,
  day: g.day,
  best: Math.max(...g.pces),
  median: median(g.pces),
  devices: g.pces.length,
  stack: b.source,
  line,
  top: g.top,
});

/**
 * A person's lines (My progress): the lines their own batches are in, with only their batches (Richard: lines shared across people
 * are for groups, 0.63). Names as that person may see them, since the page is theirs.
 */
export function personLines(uid: number, batchIds: number[]) {
  const { tree, meta } = stackLines(),
    src = new Map(batchRows().map((b) => [b.id, b.source])),
    lineOfBatch = new Map<number, number | null>();
  for (const id of batchIds) {
    const s = src.get(id);
    lineOfBatch.set(id, s != null ? (tree.lineOf.get(s) ?? null) : null);
  }
  const ids = [...new Set([...lineOfBatch.values()].filter((x): x is number => x != null))];
  return { lineOfBatch, lines: ids.map((id) => meta(id, { id: uid })) };
}

const Pick = z.object({ ids: z.array(z.number().int().positive()).max(200) });
const Own = z.object({
  name: z.string().trim().max(80).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .optional(),
});
const Next = z.object({ next: z.number().int().positive() });

export function registerLines(app: FastifyInstance, auth: (need?: any) => any, bad: (reply: any, p: any) => any) {
  /** The Lab page's lines, and which the viewer shows (null: not chosen yet, so the page shows the latest ones). */
  app.get('/api/lines', { preHandler: auth() }, async (req: any) => {
    const u = req.user,
      seeAll = u.role === 'admin' || !!u.manager || !!u.professor;
    const pick = db.prepare('SELECT ids FROM line_picks WHERE user_id=?').get(u.id) as { ids: string } | undefined;
    return { ...labLines(u, seeAll), shown: pick ? (JSON.parse(pick.ids) as number[]) : null };
  });
  app.put('/api/lines/shown', { preHandler: auth() }, async (req: any, reply) => {
    const p = Pick.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    db.prepare(
      'INSERT INTO line_picks(user_id,ids) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET ids=excluded.ids',
    ).run(req.user.id, JSON.stringify([...new Set(p.data.ids)]));
    return { ok: true };
  });
  /** A line's name and colour, by the owner of its starting stack; null puts back the starting stack's name or the usual colour. */
  app.put('/api/lines/:id', { preHandler: auth() }, async (req: any, reply) => {
    const p = Own.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const id = +req.params.id,
      { tree, byId } = stackLines();
    if (!tree.lines.has(id)) return reply.code(404).send({ error: 'no such line' });
    if (byId.get(id)!.owner_id !== req.user.id)
      return reply.code(403).send({ error: `only ${byId.get(id)!.owner} names this line and picks its colour` });
    const was = (db.prepare('SELECT name,color FROM stack_lines WHERE stack_id=?').get(id) as
      { name: string | null; color: string | null } | undefined) ?? { name: null, color: null };
    const name = p.data.name === undefined ? was.name : p.data.name || null,
      color = p.data.color === undefined ? was.color : p.data.color?.toLowerCase() || null;
    if (!name && !color) db.prepare('DELETE FROM stack_lines WHERE stack_id=?').run(id);
    else
      db.prepare(
        'INSERT INTO stack_lines(stack_id,name,color) VALUES(?,?,?) ON CONFLICT(stack_id) DO UPDATE SET name=excluded.name, color=excluded.color',
      ).run(id, name, color);
    return stackLines().meta(id, req.user);
  });
  /** Which stack made from this one continues its line: chosen by the owner of this stack (Richard, 25 Nov). */
  app.put('/api/presets/:id/line', { preHandler: auth() }, async (req: any, reply) => {
    const p = Next.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const id = +req.params.id,
      { tree, byId } = stackLines(),
      s = byId.get(id);
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (s.owner_id !== req.user.id)
      return reply.code(403).send({ error: `only ${s.owner}, who owns this stack, chooses which continues its line` });
    if (!(tree.kids.get(id) ?? []).includes(p.data.next))
      return reply.code(400).send({ error: 'that stack was not made from this one' });
    db.prepare('UPDATE presets SET line_next=? WHERE id=?').run(p.data.next, id);
    return { ok: true };
  });
}
