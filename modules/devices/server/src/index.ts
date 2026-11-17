import { MIGRATIONS } from './schema.js'; // the module's database changes first: everything below may read its tables
import type { FastifyInstance } from 'fastify';
import { ScheduleIn } from '@psc/devices/schema';
import { STEP_KINDS, roleFromSteps, stepsFromRole } from '@psc/devices';
import { lockedById, markDone } from './batchlock.js';
import { takeForBatch, usesOf } from './takes.js';
import { devicesOverview } from './overview.js';
import { registerBatches } from './batches.js';
import { registerComparisons } from './comparisons.js';
import { registerIv } from './iv.js';
import { registerPresets } from './presets.js';
import {
  addModule,
  canSee,
  after,
  bookingOut,
  bookingsWhere,
  clashes,
  clashText,
  cleanupOf,
  db,
  measuring,
  notify,
  slotProblem,
  tickSubjects,
  tx,
  type BookingSubject,
  type ItemKind,
  type SubjectInfo,
} from '@psc/server/api';

/**
 * The Electronic Devices module (0.43: its own folder): batches as something bookings are for, the photovoltaics steps
 * equipment can do, the batch scheduler, recipes and stacks, batches, J–V measurements, comparisons, its records for comments,
 * trash and search, consumption, its part of the Overview, (0.44: no chemical list of its own any more: substances come from the inventory's containers).
 */

const stepsOf = (eq: number) =>
  JSON.parse(
    (db.prepare('SELECT steps FROM equipment WHERE id=?').get(eq) as { steps: string } | undefined)?.steps ?? '[]',
  ) as string[];

/**
 * Batch status follows its bookings. Running once the first booking has started (startDueBatches). Done once every booking has
 * an outcome and none of them is waiting to be rebooked: a postponed step keeps the batch Running until it is scheduled again.
 * Bookings on measuring equipment (J–V measurement of finished devices) are not steps of the batch.
 */
export function settleBatch(id: number) {
  const b = db.prepare('SELECT status, name, owner_id, plan_steps FROM batches WHERE id=?').get(id) as any;
  const ks = (
    db.prepare("SELECT outcome, step, equipment_id FROM bookings WHERE subject='batch' AND subject_id=?").all(id) as {
      outcome: string | null;
      step: string;
      equipment_id: number;
    }[]
  ).filter((k) => !measuring(stepsOf(k.equipment_id)));
  if (!b || b.status === 'done' || !ks.length || ks.some((k) => !k.outcome || k.outcome === 'postponed')) return;
  // every block of the scheduler's plan must have been booked and answered (one placed in the past used to close the batch)
  const plan: string[] = JSON.parse(b.plan_steps || '[]');
  if (plan.some((st) => !ks.some((k) => k.step === st && (k.outcome === 'done' || k.outcome === 'canceled')))) return;
  db.prepare("UPDATE batches SET status='done', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  markDone(id);
  takeForBatch(id);
  notify(
    [b.owner_id],
    'batch',
    ks.some((k) => k.outcome === 'done')
      ? `Batch ${b.name} is Done: every scheduled step is concluded`
      : `Batch ${b.name} was closed: its steps were canceled`,
    { view: 'batches', id },
  );
}

/** Batches whose first booked step has started switch from Planned to Running; their owners are told. */
export function startDueBatches() {
  const now = new Date().toISOString();
  const due = db
    .prepare(
      `SELECT b.id, b.name, b.owner_id, MIN(k.start) AS first,
         (SELECT e.name FROM bookings k2 JOIN equipment e ON e.id=k2.equipment_id
           WHERE k2.subject='batch' AND k2.subject_id=b.id ORDER BY k2.start LIMIT 1) AS eq
       FROM batches b JOIN bookings k ON k.subject='batch' AND k.subject_id=b.id
       WHERE b.status='planned' AND b.deleted_at IS NULL GROUP BY b.id HAVING MIN(k.start) <= ?`,
    )
    .all(now) as any[];
  for (const b of due) {
    db.prepare("UPDATE batches SET status='running', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(b.id);
    takeForBatch(b.id);
    notify([b.owner_id], 'batch', `Batch ${b.name} is now Running: its first booking (${b.eq}) has started`, {
      view: 'batches',
      id: b.id,
    });
  }
  return due.length;
}

/** Batches as something equipment is booked for. */
const batchSubject: BookingSubject = {
  kind: 'batch',
  module: 'devices',
  noun: 'batch',
  plural: 'batches',
  info(ids) {
    const m = new Map<number, SubjectInfo>();
    if (!ids.length) return m;
    for (const r of db
      .prepare(
        `SELECT id, code, name, status, owner_id, deleted_at FROM batches WHERE id IN (${ids.map(() => '?').join(',')})`,
      )
      .all(...ids) as any[])
      m.set(r.id, { code: r.code, name: r.name, status: r.status, owner_id: r.owner_id, gone: !!r.deleted_at });
    return m;
  },
  refuse(u, id, eq, isNew) {
    const b = db.prepare('SELECT owner_id, status FROM batches WHERE id=? AND deleted_at IS NULL').get(id) as any;
    if (!b) return { status: 400, error: 'choose one of your batches' };
    if (b.owner_id !== u.id && u.role !== 'admin')
      return { status: 403, error: 'you can only book for your own batches' };
    if (eq.measuring && b.status !== 'done')
      return {
        status: 400,
        error: `${eq.name} measures finished batches: choose a Done batch, or no batch and say why it is booked`,
      };
    if (!eq.measuring && isNew && b.status === 'done')
      return { status: 400, error: 'this batch is done; book for a Planned or Running batch' };
    return null;
  },
  // a locked batch's record stays fixed, but measuring it again on the J–V equipment is still allowed
  locked: (id, eq) => (eq.measuring ? null : lockedById(id)),
  asksOutcome: (eq) => !eq.measuring,
  outcomeGiven: settleBatch,
  view: 'batches',
  hint: 'Bookings for a batch need a Planned batch: start one from a stack. Equipment can also be booked outside a batch, saying what for.',
  // the batch's layers, by name (the booking form offers them as the step)
  steps: (u, id) => {
    const b = db
      .prepare('SELECT owner_id, visibility, snapshot FROM batches WHERE id=? AND deleted_at IS NULL')
      .get(id) as any;
    if (!b || !canSee(u, b)) return [];
    return ((JSON.parse(b.snapshot).stack?.sl ?? []) as { n?: string }[]).map((x) => x.n ?? '').filter(Boolean);
  },
  tick: () => void startDueBatches(),
  choices: (u) => ({
    open: db
      .prepare(
        "SELECT id, code, name, status FROM batches WHERE owner_id=? AND status IN ('planned','running') AND deleted_at IS NULL ORDER BY status DESC, id DESC",
      )
      .all(u.id) as any[],
    // finished batches, for measuring equipment (the latest first)
    finished: db
      .prepare(
        "SELECT id, code, name, status FROM batches WHERE owner_id=? AND status='done' AND deleted_at IS NULL ORDER BY COALESCE(done_at, updated_at) DESC, id DESC LIMIT 40",
      )
      .all(u.id) as any[],
  }),
};

function registerDevicesCalendar(app: FastifyInstance, auth: (need?: any) => any, bad: (reply: any, p: any) => any) {
  /** A concluded step whose run data the person chose to add later: remind them (the batch page lists it until it is added). */
  app.post('/api/bookings/:id/runs-later', { preHandler: auth() }, async (req: any, reply) => {
    const k = db
      .prepare(
        "SELECT k.*, b.owner_id, b.name AS batch FROM bookings k JOIN batches b ON k.subject='batch' AND b.id=k.subject_id WHERE k.id=? AND b.deleted_at IS NULL",
      )
      .get(+req.params.id) as any;
    if (!k) return reply.code(404).send({ error: 'not found' });
    if (k.user_id !== req.user.id && k.owner_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'not your booking' });
    notify(
      [k.user_id],
      'runs',
      `Run data for ${k.step || 'a concluded step'} of batch ${k.batch} is still missing. Add it from the batch page.`,
      { view: 'batches', id: k.subject_id },
    );
    return { ok: true };
  });

  /** The scheduler's blocks for a batch (sent when its tray opens), so the batch is Done only when each of them is answered. */
  app.put('/api/batches/:id/plan', { preHandler: auth() }, async (req: any, reply) => {
    const id = +req.params.id,
      b = db.prepare('SELECT owner_id, status FROM batches WHERE id=? AND deleted_at IS NULL').get(id) as any;
    if (!b) return reply.code(404).send({ error: 'not found' });
    if (b.owner_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'not your batch' });
    const steps = Array.isArray(req.body?.steps)
      ? (req.body.steps as unknown[])
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.slice(0, 120))
          .slice(0, 60)
      : null;
    if (!steps) return reply.code(400).send({ error: 'steps: a list of step names' });
    const split = Array.isArray(req.body?.split)
      ? (req.body.split as unknown[])
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.slice(0, 60))
          .slice(0, 60)
      : null;
    if (b.status !== 'done') {
      db.prepare('UPDATE batches SET plan_steps=? WHERE id=?').run(JSON.stringify(steps), id);
      if (split) db.prepare('UPDATE batches SET plan_split=? WHERE id=?').run(JSON.stringify(split), id);
    }
    return { ok: true };
  });

  /**
   * Schedule a whole batch: the given steps replace the batch's scheduler bookings (equipment with a role) that have not started.
   * All or nothing: if one step overlaps another booking, nothing changes and the step is named.
   */
  app.put('/api/batches/:id/schedule', { preHandler: auth() }, async (req: any, reply) => {
    const id = +req.params.id,
      b = db.prepare('SELECT owner_id, status FROM batches WHERE id=? AND deleted_at IS NULL').get(id) as any;
    if (!b) return reply.code(404).send({ error: 'not found' });
    if (b.owner_id !== req.user.id && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'you can only schedule your own batches' });
    if (b.status === 'done') return reply.code(400).send({ error: 'this batch is done' });
    const lk = lockedById(id);
    if (lk) return reply.code(423).send({ error: lk });
    const p = ScheduleIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const now = new Date().toISOString(),
      items = p.data.items;
    for (const [i, it] of items.entries()) {
      const no = slotProblem(req.user, it.equipment_id, it.start, it.end);
      if (no) return reply.code(no.status).send({ error: `${it.step}: ${no.error}`, index: i });
    }
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++)
        if (
          items[i].equipment_id === items[j].equipment_id &&
          after(items[i].end, cleanupOf(items[i].equipment_id)) > items[j].start &&
          after(items[j].end, cleanupOf(items[j].equipment_id)) > items[i].start
        )
          return reply
            .code(409)
            .send({ error: `${items[i].step} and ${items[j].step} use the same equipment at the same time`, index: j });
    try {
      tx(() => {
        // only the scheduler's own steps are replaced: single bookings on other equipment (made in the Calendar) stay
        db.prepare(
          "DELETE FROM bookings WHERE subject='batch' AND subject_id=? AND outcome IS NULL AND start > ? AND equipment_id IN (SELECT id FROM equipment WHERE role NOT IN ('','measure'))",
        ).run(id, now);
        items.forEach((it, i) => {
          const c = clashes(it.equipment_id, it.start, it.end);
          if (c.length && !(it.force && req.user.role === 'admin')) {
            const e: any = new Error(`${it.step}: ${clashText(c[0], it.start, it.end)}`);
            e.index = i;
            throw e;
          }
          db.prepare(
            "INSERT INTO bookings(equipment_id,subject,subject_id,user_id,step,start,end,forced) VALUES(?,'batch',?,?,?,?,?,?)",
          ).run(it.equipment_id, id, req.user.id, it.step, it.start, it.end, it.force ? 1 : 0);
        });
      });
    } catch (e: any) {
      return reply.code(409).send({ error: e.message, index: e.index });
    }
    tickSubjects();
    return { ok: true };
  });

  app.get('/api/batches/:id/bookings', { preHandler: auth() }, async (req: any) =>
    bookingsWhere("k.subject='batch' AND k.subject_id=? ORDER BY k.start", +req.params.id).map((r) =>
      bookingOut(r, req.user),
    ),
  );
}

// ------------------------------------------------------------------ its records (0.42)
/** Recipes, stacks and designs are one table, by segment: the page each opens on, and what one is called. */
const PAGE: Record<string, string> = {
  stk: 'Stacks',
  sub: 'Substrates',
  mask: 'Metal masks',
  s0: 'Substrate preparation',
  s1: 'Solutions',
  s2: 'Spin coating',
  s3: 'Organic evaporation',
  s4: 'Metal evaporation',
};
const ONE: Record<string, string> = {
  stk: 'Stack',
  sub: 'Substrate',
  mask: 'Metal mask',
  s0: 'Substrate preparation',
  s1: 'Solution',
  s2: 'Spin program',
  s3: 'Organic evaporation',
  s4: 'Metal evaporation',
};
const ITEMS: ItemKind[] = [
  {
    kind: 'preset',
    module: 'devices',
    table: 'presets',
    cols: 'name,segment',
    describe: (r) => ({ name: r.name, type: ONE[r.segment] ?? r.segment, link: { view: r.segment, id: r.id } }),
    comments: true,
    // keep the family tree connected
    purge(id) {
      const r = db.prepare('SELECT parent_id FROM presets WHERE id=?').get(id) as { parent_id: number | null };
      db.prepare('UPDATE presets SET parent_id=? WHERE parent_id=?').run(r.parent_id, id);
    },
    search: (_q, p) =>
      (
        db
          .prepare(
            `SELECT id,segment,name FROM presets WHERE deleted_at IS NULL AND name LIKE @q AND (owner_id=@uid OR visibility='shared' OR @all=1) ORDER BY name LIMIT 8`,
          )
          .all(p) as any[]
      ).map((r) => ({
        key: 'preset:' + r.id,
        label: r.name,
        hint: PAGE[r.segment] ?? 'Preset',
        link: { view: r.segment, id: r.id },
      })),
  },
  {
    kind: 'batch',
    module: 'devices',
    table: 'batches',
    cols: 'name',
    describe: (r) => ({
      name: r.name,
      type: 'Batch',
      title: 'batch ' + r.name,
      link: { view: 'batches', id: r.id },
    }),
    comments: true,
    // back from the trash, a batch that had started takes its amounts again
    restored: takeForBatch,
    search: (_q, p) =>
      (
        db
          .prepare(
            `SELECT id,name FROM batches WHERE deleted_at IS NULL AND name LIKE @q AND (owner_id=@uid OR visibility='shared' OR @all=1) ORDER BY id DESC LIMIT 8`,
          )
          .all(p) as any[]
      ).map((r) => ({ key: 'batch:' + r.id, label: r.name, hint: 'Batch', link: { view: 'batches', id: r.id } })),
  },
  {
    kind: 'iv',
    module: 'devices',
    table: 'iv_sets',
    cols: 'name',
    describe: (r) => ({ name: r.name, type: 'Measurement', link: { view: 'iv', id: r.id } }),
    search: (_q, p) =>
      (
        db
          .prepare(
            `SELECT id,name,date FROM iv_sets WHERE deleted_at IS NULL AND name LIKE @q AND (owner_id=@uid OR visibility='shared' OR @all=1) ORDER BY date DESC LIMIT 6`,
          )
          .all(p) as any[]
      ).map((r) => ({ key: 'iv:' + r.id, label: r.name, hint: 'Measurement', link: { view: 'iv', id: r.id } })),
  },
  {
    kind: 'cmp',
    module: 'devices',
    table: 'comparisons',
    cols: 'name',
    describe: (r) => ({ name: r.name, type: 'Comparison', link: { view: 'cmp', id: r.id } }),
    search: (_q, p) =>
      (
        db
          .prepare(
            `SELECT id,name FROM comparisons WHERE deleted_at IS NULL AND name LIKE @q AND (owner_id=@uid OR visibility='shared' OR @all=1) ORDER BY updated_at DESC LIMIT 6`,
          )
          .all(p) as any[]
      ).map((r) => ({ key: 'cmp:' + r.id, label: r.name, hint: 'Comparison', link: { view: 'cmp', id: r.id } })),
  },
];

/** The photovoltaics steps; J–V measurement and lifetime equipment measures finished devices. */
const MEASURES = new Set(['jv', 'lifetime']);
addModule({
  id: 'devices',
  name: 'Electronic Devices',
  migrations: MIGRATIONS,
  subjects: [batchSubject],
  steps: STEP_KINDS.map((s) => ({ ...s, module: 'devices', ...(MEASURES.has(s.key) ? { measures: true } : {}) })),
  items: ITEMS,
  // planned amounts from the recipes frozen in each running or done batch
  uses: {
    basis: (n) =>
      `From the recipes of ${n} running and done batch${n === 1 ? '' : 'es'} (what their run data say was weighed and dispensed, else the planned amounts: solutions as prepared, solvents dispensed in spin programs).`,
    events: () =>
      (
        db
          .prepare(
            `SELECT code,name,owner_id,visibility,snapshot,created_at FROM batches WHERE deleted_at IS NULL AND status IN ('running','done') ORDER BY created_at`,
          )
          .all() as any[]
      ).map((b) => ({
        label: b.name,
        date: b.created_at,
        owner_id: b.owner_id,
        shared: b.visibility === 'shared',
        uses: usesOf(b),
      })),
  },
  overview: devicesOverview,
  equipment: { role: roleFromSteps, stepsFor: stepsFromRole },
  /**
   * A substance renamed or merged (0.54): recipes keep substances as names (the solvent of a spin dispense as "Solvent: name"),
   * so each value that names it follows. Batches keep the names they were made with.
   */
  substanceRenamed(from, to) {
    const walk = (v: unknown): unknown =>
      typeof v === 'string'
        ? v === from
          ? to
          : v === `Solvent: ${from}`
            ? `Solvent: ${to}`
            : v
        : Array.isArray(v)
          ? v.map(walk)
          : v && typeof v === 'object'
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
            : v;
    const up = db.prepare('UPDATE presets SET data=? WHERE id=?');
    for (const p of db
      .prepare('SELECT id, data FROM presets WHERE instr(data, ?) > 0')
      .all(JSON.stringify(from).slice(1, -1)) as {
      id: number;
      data: string;
    }[]) {
      const next = JSON.stringify(walk(JSON.parse(p.data)));
      if (next !== p.data) up.run(next, p.id);
    }
  },
  audit: {
    labels: {
      'POST /api/presets': 'Created a recipe or design',
      'PUT /api/presets/:id': 'Edited a recipe or design',
      'DELETE /api/presets/:id': 'Moved a recipe or design to the trash',
      'POST /api/presets/:id/runs': 'Added run data',
      'DELETE /api/runs/:id': 'Deleted run data',
      'POST /api/batches': 'Started a batch',
      'PATCH /api/batches/:id': 'Edited a batch',
      'DELETE /api/batches/:id': 'Moved a batch to the trash',
      'PUT /api/batches/:id/variants': 'Edited the variants of a batch',
      'POST /api/batches/:id/unlock': 'Unlocked a finished batch',
      'POST /api/batches/:id/lock': 'Locked a batch again',
      'POST /api/iv': 'Imported a measurement',
      'PATCH /api/iv/:id': 'Edited a measurement',
      'PATCH /api/iv/curves/:cid': 'Changed which curves count',
      'DELETE /api/iv/:id': 'Moved a measurement to the trash',
      'POST /api/comparisons': 'Created a comparison',
      'PATCH /api/comparisons/:id': 'Edited a comparison',
      'DELETE /api/comparisons/:id': 'Moved a comparison to the trash',
    },
    names: [
      ['/api/presets/', 'SELECT name AS n FROM presets WHERE id=?'],
      ['/api/batches/', 'SELECT name AS n FROM batches WHERE id=?'],
      ['/api/comparisons/', 'SELECT name AS n FROM comparisons WHERE id=?'],
      ['/api/iv/:id', 'SELECT name AS n FROM iv_sets WHERE id=?'],
    ],
  },
  topics: [
    [/^\/api\/batches/, ['batches', 'calendar']],
    [/^\/api\/(presets|runs)/, ['presets', 'batches', 'inventory']],
    [/^\/api\/iv/, ['iv', 'comparisons']],
    [/^\/api\/comparisons/, ['comparisons']],
  ],
  backupCheck: (c) =>
    `${(c.prepare('SELECT COUNT(*) AS n FROM presets').get() as { n: number }).n} recipes and designs`,
  register(app, auth, bad) {
    registerPresets(app, auth, bad);
    registerIv(app, auth, bad);
    registerComparisons(app, auth, bad);
    registerBatches(app, auth, bad);
    registerDevicesCalendar(app, auth, bad);
  },
});
