import { add, audit, db, has, meta, mark, migrate, type Migration } from '@psc/server/api';
import { solutionDefaults, solutionUses, spinDefaults, spinUses, sweepDir } from '@psc/devices';
import { classifySet, markShortsInSet } from './ivdata.js';

/**
 * Electronic Devices' changes to the database (0.43, from the core's list): recipes, stacks, batches, run data, J–V
 * measurements, comparisons. They keep their numbers in the one sequence the core and the modules share, and run when the module
 * is loaded, after the core's changes. A database from before 0.43 has them all recorded already.
 */
export const MIGRATIONS: Migration[] = [
  {
    id: 2,
    owner: 'devices',
    name: 'presets (recipes, designs, stacks), batches, run data',
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS presets(
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), segment TEXT NOT NULL, name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')), data TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS batches(
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), code TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','running','done')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),
  snapshot TEXT NOT NULL, record TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS run_data(
  id INTEGER PRIMARY KEY, preset_id INTEGER NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES users(id), batch TEXT NOT NULL DEFAULT '', data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`),
  },
  {
    id: 3,
    owner: 'devices',
    name: 'preset versions (parent)',
    up: (db) => add(db, 'presets', 'parent_id', 'INTEGER REFERENCES presets(id) ON DELETE SET NULL'),
  },
  {
    id: 5,
    owner: 'devices',
    name: 'trash for presets and batches (0.18)',
    up: (db) => {
      add(db, 'presets', 'deleted_at', 'TEXT');
      add(db, 'batches', 'deleted_at', 'TEXT');
    },
  },
  {
    id: 8,
    owner: 'devices',
    name: 'J–V measurements; device groups and devices left out of the plots (0.17)',
    up: (db) => {
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
      add(db, 'iv_sets', 'devices', "TEXT NOT NULL DEFAULT '{}'");
      add(db, 'iv_sets', 'deleted_at', 'TEXT');
    },
  },
  {
    id: 12,
    owner: 'devices',
    name: 'stability follow-ups (0.23)',
    up: (db) => {
      if (!has(db, 'iv_sets', 'stability_of')) {
        db.exec('ALTER TABLE iv_sets ADD COLUMN stability_of INTEGER REFERENCES iv_sets(id) ON DELETE SET NULL');
        db.exec('ALTER TABLE iv_sets ADD COLUMN measured_at TEXT');
      }
    },
  },
  {
    id: 15,
    owner: 'devices',
    name: 'comparisons (0.30)',
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS comparisons(
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')), notes TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT);`),
  },
  {
    id: 18,
    owner: 'devices',
    name: 'finished batches lock; variants (0.33)',
    up: (db) => {
      if (!has(db, 'batches', 'done_at')) {
        db.exec('ALTER TABLE batches ADD COLUMN done_at TEXT');
        db.exec('ALTER TABLE batches ADD COLUMN unlocked_until TEXT');
        // batches finished before 0.33: their last change is the best guess of when they finished
        db.exec("UPDATE batches SET done_at=updated_at WHERE status='done'");
      }
      add(db, 'batches', 'variants', `TEXT NOT NULL DEFAULT '{"control":"","list":[]}'`);
    },
  },
  {
    id: 20,
    owner: 'devices',
    name: 'lifetime runs: set kind and run details, each curve’s time (0.35); check sweeps classified (0.30)',
    up: (db) => {
      if (!has(db, 'iv_sets', 'kind')) {
        db.exec("ALTER TABLE iv_sets ADD COLUMN kind TEXT NOT NULL DEFAULT 'jv'");
        db.exec('ALTER TABLE iv_sets ADD COLUMN life TEXT');
        db.exec('ALTER TABLE iv_curves ADD COLUMN t REAL');
      }
      if (!has(db, 'iv_curves', 'kind')) {
        db.exec('ALTER TABLE iv_curves ADD COLUMN kind TEXT');
        for (const r of db.prepare('SELECT id FROM iv_sets').all() as { id: number }[]) classifySet(db, r.id);
      }
    },
  },
  {
    id: 25,
    owner: 'devices',
    name: 'a pixel that shorted in one scan is shorted in all of them (0.37)',
    up: (db) => {
      if (!meta(db, 'short-pixels')) {
        for (const r of db.prepare('SELECT id FROM iv_sets').all() as { id: number }[]) markShortsInSet(db, r.id);
        mark(db, 'short-pixels', '1');
      }
    },
  },
  {
    id: 27,
    owner: 'devices',
    name: 'the scheduler’s blocks of a batch, so a batch is not Done while some are not placed (0.37.1)',
    up: (db) => add(db, 'batches', 'plan_steps', "TEXT NOT NULL DEFAULT '[]'"),
  },
  {
    id: 31,
    owner: 'devices',
    name: 'runs whose annealing is booked elsewhere (0.38)',
    up: (db) => add(db, 'batches', 'plan_split', "TEXT NOT NULL DEFAULT '[]'"),
  },
  {
    id: 32,
    owner: 'devices',
    name: 'J–V systems named by their export format (0.38)',
    up: (db) =>
      db.exec(
        "UPDATE iv_sets SET system='csv' WHERE system='padrao'; UPDATE iv_sets SET system='txt' WHERE system='sun'",
      ),
  },
  {
    id: 36,
    owner: 'devices',
    name: 'no starter chemical list (0.44): the ones no container or recipe uses go',
    up: (d) => {
      // a substance stays when a container is of it or a recipe takes it: named in the recipe (recipes keep names as JSON
      // strings), or worked out from it (a perovskite's salts come from its composition)
      const chems = (
        d.prepare('SELECT id, name, data FROM chemicals').all() as { id: number; name: string; data: string }[]
      ).map((c) => {
        const x = JSON.parse(c.data || '{}');
        return { id: c.id, name: c.name, roles: (x.roles ?? []) as string[], f: x.f ?? '', M: x.M ?? 0 };
      });
      const ctx = {
          chems: chems.map((c) => ({ name: c.name, role: c.roles[0] ?? 'other', roles: c.roles })),
          cl: chems.map((c) => ({ n: c.name, f: c.f, M: c.M })),
        },
        taken = new Set<string>();
      for (const p of d.prepare("SELECT segment, data FROM presets WHERE segment IN ('s1', 's2')").all() as {
        segment: string;
        data: string;
      }[])
        try {
          const uses =
            p.segment === 's1'
              ? solutionUses({ ...solutionDefaults(), ...JSON.parse(p.data) }, ctx)
              : spinUses({ ...spinDefaults(), ...JSON.parse(p.data) });
          for (const u of uses) taken.add(u.name);
        } catch {
          /* a recipe from an older version */
        }
      const unused = chems.filter(
        (c) =>
          !taken.has(c.name) &&
          !d.prepare('SELECT 1 FROM containers WHERE chem_id=?').get(c.id) &&
          !d.prepare('SELECT 1 FROM presets WHERE instr(data, ?) > 0').get(JSON.stringify(c.name)),
      );
      const del = d.prepare('DELETE FROM chemicals WHERE id=?');
      for (const c of unused) del.run(c.id);
    },
  },
  {
    id: 38,
    owner: 'devices',
    name: 'batches are known by name (0.45): every batch has one, and no two share it',
    up: (d) => {
      // older batches were known by their code: one without a name is called by it; a repeated name gets " (2)", " (3)"…
      const rows = d.prepare('SELECT id, code, name FROM batches ORDER BY id').all() as {
        id: number;
        code: string;
        name: string;
      }[];
      const seen = new Set<string>(),
        set = d.prepare('UPDATE batches SET name=? WHERE id=?');
      for (const r of rows) {
        const base = r.name.trim() || r.code;
        let name = base;
        for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${base} (${n})`;
        seen.add(name.toLowerCase());
        if (name !== r.name) set.run(name, r.id);
      }
      d.exec('CREATE UNIQUE INDEX IF NOT EXISTS batches_name ON batches(name COLLATE NOCASE)');
    },
  },
  {
    id: 42,
    owner: 'devices',
    name: 'scan direction from the voltages (0.55.3): curves of a backward-first measurement had their names the wrong way round',
    up: (d) => {
      // the Ossila software names sweeps by order ("Reverse" = the second); the stored voltages are in measured order
      const rows = d.prepare('SELECT id, dir, data FROM iv_curves').all() as {
        id: number;
        dir: string;
        data: string;
      }[];
      const set = d.prepare('UPDATE iv_curves SET dir=? WHERE id=?');
      let n = 0;
      for (const r of rows) {
        let V: number[];
        try {
          V = (JSON.parse(r.data) as { V?: number[] }).V ?? [];
        } catch {
          continue; // a curve whose data cannot be read keeps its direction
        }
        const dir = sweepDir(V);
        if (dir && dir !== r.dir) {
          set.run(dir, r.id);
          n++;
        }
      }
      if (n) mark(d, 'iv_dir_fixed', String(n)); // told in the activity log once the app has started (below)
    },
  },
  {
    id: 45,
    owner: 'devices',
    name: 'designs belong to the lab (0.58): every substrate design and metal mask is shared',
    up: (d) => {
      // everyone uses them in recipes and stacks; only admins and people with the designs permission change them
      d.exec("UPDATE presets SET visibility='shared' WHERE segment IN ('sub','mask') AND visibility<>'shared'");
    },
  },
];
migrate(db, MIGRATIONS);
// 0.55.3: how many stored curves migration 42 corrected, once, in the activity log
{
  const fixed = db.prepare("SELECT value FROM meta WHERE key='iv_dir_fixed'").get() as { value: string } | undefined;
  if (fixed) {
    audit({
      username: 'PANOPTICA',
      action: 'Read the scan directions from the voltages',
      target: `${fixed.value} J–V ${fixed.value === '1' ? 'curve' : 'curves'} corrected (backward sweep measured first)`,
    });
    db.prepare("DELETE FROM meta WHERE key='iv_dir_fixed'").run();
  }
}
