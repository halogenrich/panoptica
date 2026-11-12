/**
 * A module that exists only in the tests (0.41). It defines its own thing to book equipment for (a "sample"), its own steps and
 * its own database change, and the server checks (tools/smoke.mjs) use it next to Electronic Devices. 0.42: samples are also a
 * record type (comments, trash, search), report what they use from the inventory, and have a part in the Overview. If the core
 * assumed batches or the photovoltaics steps anywhere, these checks would fail. Loaded only when PANOPTICA_TEST=1 and
 * PANOPTICA_TEST_MODULE points here; never part of a release.
 */
import { db } from '../apps/server/src/db.ts';
import { migrate } from '../apps/server/src/schema.ts';
import { addModule, type BookingSubject, type ItemKind, type SubjectInfo } from '../apps/server/src/modules.ts';

migrate(db, [
  {
    id: 10001,
    owner: 'fake',
    name: 'samples (test module)',
    up: (d) =>
      d.exec(`CREATE TABLE IF NOT EXISTS fake_samples(id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL, code TEXT NOT NULL,
  name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT)`),
  },
]);

const sample: BookingSubject = {
  kind: 'sample',
  module: 'fake',
  noun: 'sample',
  plural: 'samples',
  info(ids) {
    const m = new Map<number, SubjectInfo>();
    if (!ids.length) return m;
    for (const r of db
      .prepare(`SELECT * FROM fake_samples WHERE id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids) as any[])
      m.set(r.id, { code: r.code, name: r.name, status: r.status, owner_id: r.owner_id, gone: !!r.deleted_at });
    return m;
  },
  refuse(u, id, eq) {
    const r = db.prepare('SELECT * FROM fake_samples WHERE id=? AND deleted_at IS NULL').get(id) as any;
    if (!r) return { status: 400, error: 'choose one of your samples' };
    if (r.owner_id !== u.id && u.role !== 'admin') return { status: 403, error: 'not your sample' };
    if (eq.measuring !== (r.status === 'finished'))
      return { status: 400, error: eq.measuring ? 'read finished samples only' : 'this sample is finished' };
    return null;
  },
  locked: () => null,
  asksOutcome: (eq) => !eq.measuring,
  outcomeGiven(id) {
    // a sample is finished when one of its steps is concluded
    const done = db
      .prepare("SELECT 1 FROM bookings WHERE subject='sample' AND subject_id=? AND outcome='done'")
      .get(id);
    if (done) db.prepare("UPDATE fake_samples SET status='finished' WHERE id=?").run(id);
  },
  tick: () => {},
  choices: (u) => ({
    open: db
      .prepare(
        "SELECT id, code, name, status FROM fake_samples WHERE owner_id=? AND status='open' AND deleted_at IS NULL",
      )
      .all(u.id) as any[],
    finished: db
      .prepare(
        "SELECT id, code, name, status FROM fake_samples WHERE owner_id=? AND status='finished' AND deleted_at IS NULL",
      )
      .all(u.id) as any[],
  }),
};

const record: ItemKind = {
  kind: 'sample',
  module: 'fake',
  table: 'fake_samples',
  cols: 'code,name',
  describe: (r) => ({
    name: `${r.code} ${r.name}`,
    type: 'Sample',
    title: 'sample ' + r.code,
    link: { view: 'fake', id: r.id },
  }),
  comments: true,
  search: (_q, p) =>
    (
      db
        .prepare(
          `SELECT id,code,name FROM fake_samples WHERE deleted_at IS NULL AND (code LIKE @q OR name LIKE @q) AND (owner_id=@uid OR visibility='shared' OR @all=1)`,
        )
        .all(p) as any[]
    ).map((r) => ({ key: 'sample:' + r.id, label: r.code, hint: 'Sample', link: { view: 'fake', id: r.id } })),
};
const count = (where: string, ...a: unknown[]) =>
  (
    db.prepare(`SELECT COUNT(*) AS n FROM fake_samples WHERE deleted_at IS NULL AND ${where}`).get(...(a as [])) as {
      n: number;
    }
  ).n;

addModule({
  id: 'fake',
  subjects: [sample],
  items: [record],
  // each finished sample took 10 mg of a test salt
  uses: {
    basis: (n) => `And ${n} finished test sample${n === 1 ? '' : 's'}.`,
    events: () =>
      (
        db
          .prepare(
            "SELECT code,owner_id,visibility,created_at FROM fake_samples WHERE status='finished' AND deleted_at IS NULL",
          )
          .all() as any[]
      ).map((r) => ({
        label: r.code,
        date: r.created_at,
        owner_id: r.owner_id,
        shared: r.visibility === 'shared',
        uses: [{ name: 'Test salt', mg: 10 }],
      })),
  },
  overview: {
    period: (p) => ({
      people: Object.fromEntries(p.users.map((u) => [u.id, { samples: count('owner_id=?', u.id) }])),
      samples: p.users.reduce((a, u) => a + count('owner_id=?', u.id), 0),
    }),
    person: (id) => ({ samples: count('owner_id=?', id) }),
  },
  steps: [
    { key: 'fake-mix', label: 'Mixing (test module)', group: 'Test module', module: 'fake' },
    { key: 'fake-read', label: 'Reading (test module)', group: 'Test module', module: 'fake', measures: true },
  ],
  register(app, auth) {
    app.post('/api/m/fake/samples', { preHandler: auth() }, async (req: any) => {
      const n = (db.prepare('SELECT COUNT(*) AS n FROM fake_samples').get() as { n: number }).n + 1;
      const id = db
        .prepare('INSERT INTO fake_samples(owner_id, code, name) VALUES(?,?,?)')
        .run(req.user.id, `S-${n}`, String(req.body?.name ?? '')).lastInsertRowid;
      return { id: Number(id), code: `S-${n}` };
    });
    app.delete('/api/m/fake/samples/:id', { preHandler: auth() }, async (req: any) => {
      db.prepare("UPDATE fake_samples SET deleted_at=datetime('now') WHERE id=?").run(+req.params.id);
      return { ok: true };
    });
  },
});
