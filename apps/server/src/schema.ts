import type { DatabaseSync } from 'node:sqlite';
import { chemRef, withRef } from '@psc/core';

/**
 * Every change to the database, in order (0.40). Each runs once, in a transaction, and is recorded in the `migrations` table with
 * its number; a new release adds changes at the end and never edits or reorders the ones before.
 *
 * `owner` says which part of PANOPTICA the change belongs to. This list is the core's (accounts, lab, equipment, calendar,
 * inventory, comments); since 0.43 each module keeps its own list and runs it when it is loaded (Electronic Devices:
 * modules/devices/server/src/schema.ts), after the core's. The numbers are one sequence across all of them.
 *
 * Changes 1–33 existed before this list did: they were run piecemeal by each file at start-up, guarded by "is this column there
 * yet". They keep those guards, so a database from any earlier version (where some or all of them already happened) and a new
 * one both end up the same, and the first start of 0.40 just records them. Changes after 33 need no guard.
 */
type Db = DatabaseSync;
export type Migration = {
  id: number;
  /** 'core', 'devices' (Electronic Devices), or another module's id (a test module's changes are numbered from 10000) */
  owner: string;
  name: string;
  up: (db: Db) => void;
  /** runs outside a transaction (it manages its own: SQLite ignores PRAGMA foreign_keys inside one) */
  noTx?: boolean;
};

/** The steps an equipment set up before 0.38 did, from its one procedure (role): frozen here for change 29. */
function stepsFromRole(role: string, name = ''): string[] {
  switch (role) {
    case 'prep':
      return /plasma/i.test(name) ? ['plasma'] : /uv|ozone|uvo/i.test(name) ? ['uvozone'] : ['sonication', 'n2dry'];
    case 'scale':
      return ['weighing', 'dissolving'];
    case 'spinner':
      return ['spin', 'annealing'];
    case 'organic':
      return ['organic'];
    case 'metal':
      return ['metal'];
    case 'measure':
      return ['jv', 'lifetime'];
    default:
      return [];
  }
}

export const has = (db: Db, table: string, col: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
export const meta = (db: Db, key: string) => !!db.prepare('SELECT 1 FROM meta WHERE key=?').get(key);
export const mark = (db: Db, key: string, value = new Date().toISOString()) =>
  db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run(key, value);
export const add = (db: Db, table: string, col: string, def: string) => {
  if (!has(db, table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    owner: 'core',
    name: 'accounts, sessions, chemicals, preferences',
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','member')), hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chemicals(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user_prefs(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL DEFAULT '{}');`),
  },
  {
    id: 4,
    owner: 'core',
    name: 'deleted users stay as rows, shown as "username (former)"; forced password change',
    up: (db) => {
      add(db, 'users', 'deleted', 'INTEGER NOT NULL DEFAULT 0');
      add(db, 'users', 'must_change', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    id: 6,
    owner: 'core',
    name: 'app settings, comments with reactions, notifications (0.18)',
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comments(
  id INTEGER PRIMARY KEY, target TEXT NOT NULL, target_id INTEGER NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
  parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE, text TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, edited_at TEXT);
CREATE INDEX IF NOT EXISTS comments_target ON comments(target, target_id);
CREATE TABLE IF NOT EXISTS reactions(comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), emoji TEXT NOT NULL,
  PRIMARY KEY(comment_id, user_id, emoji));
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, text TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '{}', actor TEXT NOT NULL DEFAULT '', read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, read);`),
  },
  {
    id: 7,
    owner: 'core',
    name: 'profile photo, presence, private comments, tags (0.20)',
    up: (db) => {
      add(db, 'users', 'photo', 'TEXT');
      add(db, 'users', 'photo_v', 'INTEGER NOT NULL DEFAULT 0');
      add(db, 'users', 'last_seen', 'TEXT');
      add(db, 'users', 'online_since', 'TEXT');
      add(db, 'comments', 'private', 'INTEGER NOT NULL DEFAULT 0');
      db.exec(`
CREATE TABLE IF NOT EXISTS tags(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, color TEXT NOT NULL DEFAULT '#6b7280',
  kind TEXT NOT NULL DEFAULT 'label' CHECK(kind IN ('label','professor','manager','inventory')), pos INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS user_tags(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, tag_id));`);
    },
  },
  {
    id: 9,
    owner: 'core',
    name: 'inventory: storage, shelves, containers, storage types (0.21)',
    up: (db) => {
      db.exec(`
CREATE TABLE IF NOT EXISTS storage_areas(id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'cabinet', place TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', pos INTEGER NOT NULL DEFAULT 0, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS shelves(id INTEGER PRIMARY KEY, area_id INTEGER NOT NULL REFERENCES storage_areas(id) ON DELETE CASCADE, name TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS containers(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, chem_id INTEGER REFERENCES chemicals(id) ON DELETE SET NULL, cas TEXT NOT NULL DEFAULT '',
  amount REAL, size REAL, unit TEXT NOT NULL DEFAULT 'g', status TEXT NOT NULL DEFAULT 'in use',
  area_id INTEGER REFERENCES storage_areas(id) ON DELETE SET NULL, shelf_id INTEGER REFERENCES shelves(id) ON DELETE SET NULL,
  supplier TEXT NOT NULL DEFAULT '', lot TEXT NOT NULL DEFAULT '', purity REAL, expires TEXT, opened TEXT, notes TEXT NOT NULL DEFAULT '',
  added_by INTEGER REFERENCES users(id), added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by INTEGER REFERENCES users(id), updated_at TEXT);
CREATE INDEX IF NOT EXISTS containers_area ON containers(area_id);
CREATE TABLE IF NOT EXISTS storage_types(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, icon TEXT NOT NULL DEFAULT 'cabinet', pos INTEGER NOT NULL DEFAULT 0);`);
      // storage types are a list the Inventory people edit; the first run makes the usual ones and links existing areas by kind
      if (!db.prepare('SELECT 1 FROM storage_types LIMIT 1').get()) {
        const ins = db.prepare('INSERT INTO storage_types(name,icon,pos) VALUES(?,?,?)');
        [
          ['Cabinet', 'cabinet'],
          ['Desiccator', 'desiccator'],
          ['Glovebox', 'glovebox'],
          ['Fridge', 'fridge'],
          ['Freezer', 'freezer'],
          ['Open shelf', 'shelf'],
        ].forEach(([n, i], k) => ins.run(n, i, k));
      }
      if (!has(db, 'storage_areas', 'type_id')) {
        db.exec('ALTER TABLE storage_areas ADD COLUMN type_id INTEGER REFERENCES storage_types(id) ON DELETE SET NULL');
        db.exec('UPDATE storage_areas SET type_id=(SELECT id FROM storage_types t WHERE t.icon=storage_areas.kind)');
      }
    },
  },
  {
    id: 10,
    owner: 'core',
    name: 'equipment and bookings (0.22)',
    up: (db) =>
      db.exec(`
CREATE TABLE IF NOT EXISTS equipment(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, color TEXT NOT NULL DEFAULT '#2563eb',
  place TEXT NOT NULL DEFAULT '', pos INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS bookings(
  id INTEGER PRIMARY KEY, equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE, batch_id INTEGER REFERENCES batches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id), step TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  start TEXT NOT NULL, end TEXT NOT NULL, forced INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS bookings_time ON bookings(start, end);`),
  },
  {
    id: 11,
    owner: 'core',
    name: 'what each equipment is used for; the outcome of each booking once it has ended (0.22.1)',
    up: (db) => {
      add(db, 'equipment', 'role', "TEXT NOT NULL DEFAULT ''");
      if (!has(db, 'bookings', 'outcome')) {
        db.exec('ALTER TABLE bookings ADD COLUMN outcome TEXT');
        db.exec("ALTER TABLE bookings ADD COLUMN reason TEXT NOT NULL DEFAULT ''");
        db.exec('ALTER TABLE bookings ADD COLUMN outcome_at TEXT');
        db.exec('ALTER TABLE bookings ADD COLUMN outcome_by INTEGER REFERENCES users(id)');
      }
    },
  },
  {
    id: 13,
    owner: 'core',
    name: 'activity log with a hash chain (0.26)',
    up: (db) =>
      db.exec(`CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, user_id INTEGER, username TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', status INTEGER NOT NULL DEFAULT 200, prev TEXT NOT NULL, hash TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_at ON audit(at); CREATE INDEX IF NOT EXISTS audit_user ON audit(user_id);`),
  },
  {
    id: 14,
    owner: 'core',
    name: 'sessions stored hashed: older plain ones are dropped, everyone signs in once more (0.26)',
    up: (db) => {
      if (!meta(db, 'sessions_hashed')) {
        db.prepare('DELETE FROM sessions').run();
        mark(db, 'sessions_hashed', '1');
      }
    },
  },
  {
    id: 16,
    owner: 'core',
    name: 'cleanup minutes after each booking (0.31)',
    up: (db) => {
      if (!has(db, 'equipment', 'cleanup')) {
        db.exec('ALTER TABLE equipment ADD COLUMN cleanup INTEGER NOT NULL DEFAULT 0');
        db.exec("UPDATE equipment SET cleanup=20 WHERE name LIKE 'GB:%'"); // equipment named before 0.38's clean install
      }
    },
  },
  {
    id: 17,
    owner: 'core',
    name: 'the UV-ozone cleaner prepares substrates in the scheduler, found by its name once (0.32)',
    up: (db) => {
      if (!meta(db, 'prep-equipment')) {
        db.exec(
          "UPDATE equipment SET role='prep' WHERE role='' AND (name LIKE '%UV-ozone%' OR name LIKE '%UV ozone%' OR name LIKE '%UVO%')",
        );
        mark(db, 'prep-equipment');
      }
    },
  },
  {
    id: 19,
    owner: 'core',
    name: 'equipment drawings (0.34)',
    up: (db) => add(db, 'equipment', 'art', "TEXT NOT NULL DEFAULT ''"),
  },
  {
    id: 21,
    owner: 'core',
    name: 'people’s details and access requests (0.36)',
    up: (db) => {
      for (const [c, def] of [
        ['first_names', "TEXT NOT NULL DEFAULT ''"],
        ['surnames', "TEXT NOT NULL DEFAULT ''"],
        ['email', "TEXT NOT NULL DEFAULT ''"],
        ['birth_date', "TEXT NOT NULL DEFAULT ''"],
        ['department', "TEXT NOT NULL DEFAULT ''"],
        ['supervisor', "TEXT NOT NULL DEFAULT ''"],
        ['cosupervisor', "TEXT NOT NULL DEFAULT ''"],
        ['visitor_until', 'TEXT'],
        ['show_birthday', 'INTEGER NOT NULL DEFAULT 1'],
      ] as const)
        add(db, 'users', c, def);
      db.exec(`
CREATE TABLE IF NOT EXISTS access_requests(
  id INTEGER PRIMARY KEY, username TEXT NOT NULL, first_names TEXT NOT NULL, surnames TEXT NOT NULL, email TEXT NOT NULL,
  birth_date TEXT NOT NULL, department TEXT NOT NULL, supervisor TEXT NOT NULL, cosupervisor TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','declined')), reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, decided_at TEXT, decided_by TEXT);`);
    },
  },
  {
    id: 22,
    owner: 'core',
    name: 'bookings outside batches say what they are for (0.37)',
    up: (db) => add(db, 'bookings', 'purpose', "TEXT NOT NULL DEFAULT ''"),
  },
  {
    id: 23,
    owner: 'core',
    name: 'bookings without a batch: batch_id may be empty (0.37)',
    noTx: true,
    up: (db) => {
      const col = (db.prepare('PRAGMA table_info(bookings)').all() as { name: string; notnull: number }[]).find(
        (c) => c.name === 'batch_id',
      );
      if (!col?.notnull) return;
      // SQLite cannot drop NOT NULL from a column: copy the table into one without it
      const cols = (db.prepare('PRAGMA table_info(bookings)').all() as { name: string }[]).map((c) => c.name).join(',');
      const sql = (
        db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='bookings'").get() as { sql: string }
      ).sql;
      db.exec('PRAGMA foreign_keys = OFF');
      try {
        db.exec('BEGIN');
        try {
          db.exec(
            sql
              .replace(/CREATE TABLE (IF NOT EXISTS )?"?bookings"?/i, 'CREATE TABLE bookings_new')
              .replace(/batch_id INTEGER NOT NULL/i, 'batch_id INTEGER'),
          );
          db.exec(`INSERT INTO bookings_new(${cols}) SELECT ${cols} FROM bookings`);
          db.exec('DROP TABLE bookings');
          db.exec('ALTER TABLE bookings_new RENAME TO bookings');
          db.exec('CREATE INDEX IF NOT EXISTS bookings_time ON bookings(start, end)');
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      } finally {
        db.exec('PRAGMA foreign_keys = ON');
      }
    },
  },
  {
    id: 24,
    owner: 'core',
    name: 'the solar simulator measures finished devices, found by its name once (0.37)',
    up: (db) => {
      if (!meta(db, 'measure-equipment')) {
        db.exec(
          "UPDATE equipment SET role='measure' WHERE role='' AND (name LIKE '%solar sim%' OR name LIKE '%simulator%' OR name LIKE '%J-V%' OR name LIKE '%J–V%')",
        );
        mark(db, 'measure-equipment');
      }
    },
  },
  {
    id: 26,
    owner: 'core',
    name: 'a removed photo kept its version number, so the app asked for an image that was gone (0.37.1)',
    up: (db) => db.exec('UPDATE users SET photo_v=0 WHERE photo IS NULL AND photo_v<>0'),
  },
  {
    id: 28,
    owner: 'core',
    name: 'tags give permissions instead of three built-in kinds (0.38)',
    up: (db) => {
      if (!has(db, 'tags', 'perms')) {
        db.exec("ALTER TABLE tags ADD COLUMN perms TEXT NOT NULL DEFAULT '[]'");
        db.exec(`UPDATE tags SET perms='["comments","overview"]' WHERE kind='professor'`); // the Professor saw the overview too
        db.exec(`UPDATE tags SET perms='["overview"]' WHERE kind='manager'`);
        db.exec(`UPDATE tags SET perms='["inventory"]' WHERE kind='inventory'`);
      }
    },
  },
  {
    id: 29,
    owner: 'core',
    name: 'equipment: places, equipment inside equipment, steps, responsible people, training, moves, out of service (0.38)',
    up: (db) => {
      db.exec(`
CREATE TABLE IF NOT EXISTS places(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE, pos INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS equipment_people(equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(equipment_id, user_id));
CREATE TABLE IF NOT EXISTS equipment_training(equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, by_id INTEGER REFERENCES users(id), at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '', PRIMARY KEY(equipment_id, user_id));
CREATE TABLE IF NOT EXISTS equipment_moves(id INTEGER PRIMARY KEY, equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  place_id INTEGER, parent_id INTEGER, at TEXT NOT NULL, by_id INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS equipment_off(id INTEGER PRIMARY KEY, equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  start TEXT NOT NULL, end TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', by_id INTEGER REFERENCES users(id));`);
      if (has(db, 'equipment', 'steps')) return;
      db.exec("ALTER TABLE equipment ADD COLUMN steps TEXT NOT NULL DEFAULT '[]'");
      db.exec('ALTER TABLE equipment ADD COLUMN parent_id INTEGER REFERENCES equipment(id) ON DELETE SET NULL');
      db.exec('ALTER TABLE equipment ADD COLUMN place_id INTEGER REFERENCES places(id) ON DELETE SET NULL');
      db.exec('ALTER TABLE equipment ADD COLUMN booked INTEGER NOT NULL DEFAULT 1');
      db.exec('ALTER TABLE equipment ADD COLUMN min_booking INTEGER NOT NULL DEFAULT 60');
      db.exec('ALTER TABLE equipment ADD COLUMN atmosphere INTEGER NOT NULL DEFAULT 0');
      // what each equipment did (its one procedure) becomes the steps it can do; gloveboxes record their atmosphere
      for (const e of db.prepare('SELECT id,name,role,place FROM equipment').all() as any[]) {
        db.prepare('UPDATE equipment SET steps=?, atmosphere=? WHERE id=?').run(
          JSON.stringify(stepsFromRole(e.role, e.name)),
          /^GB:/i.test(e.name) ? 1 : 0,
          e.id,
        );
        if (e.place?.trim()) {
          db.prepare('INSERT OR IGNORE INTO places(name) VALUES(?)').run(e.place.trim());
          const pl = db.prepare('SELECT id FROM places WHERE name=?').get(e.place.trim()) as { id: number };
          db.prepare('UPDATE equipment SET place_id=? WHERE id=?').run(pl.id, e.id);
        }
      }
      // whoever booked an equipment before training existed counts as trained on it
      db.prepare(
        `INSERT OR IGNORE INTO equipment_training(equipment_id,user_id,by_id,at,note)
         SELECT DISTINCT equipment_id, user_id, NULL, ?, 'booked it before training was recorded' FROM bookings`,
      ).run(new Date().toISOString());
    },
  },
  {
    id: 30,
    owner: 'core',
    name: 'the glovebox atmosphere at the end of a booking (0.38)',
    up: (db) => add(db, 'bookings', 'atmo', "TEXT NOT NULL DEFAULT ''"),
  },
  {
    id: 33,
    owner: 'core',
    name: 'booking times stored as UTC ISO text (…Z), so they compare as text',
    up: (db) => {
      for (const r of db
        .prepare("SELECT id,start,end FROM bookings WHERE start NOT LIKE '%Z' OR end NOT LIKE '%Z'")
        .all() as any[])
        db.prepare('UPDATE bookings SET start=?, end=? WHERE id=?').run(
          new Date(r.start).toISOString(),
          new Date(r.end).toISOString(),
          r.id,
        );
    },
  },
  {
    id: 34,
    owner: 'core',
    name: 'a booking is for a subject a module defines (a batch, …), not a batch: bookings.subject and subject_id (0.41)',
    noTx: true,
    up: (db) => {
      // SQLite cannot drop a column that has a foreign key: the table is copied into one without batch_id. Deleting a batch
      // for good now removes its bookings in the module's code, where the cascade used to do it.
      const keep =
        'id,equipment_id,user_id,step,note,start,end,forced,created_at,outcome,reason,outcome_at,outcome_by,purpose,atmo';
      db.exec('PRAGMA foreign_keys = OFF');
      try {
        db.exec('BEGIN');
        try {
          db.exec(`CREATE TABLE bookings_new(
  id INTEGER PRIMARY KEY, equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '', subject_id INTEGER,
  user_id INTEGER NOT NULL REFERENCES users(id), step TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  start TEXT NOT NULL, end TEXT NOT NULL, forced INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  outcome TEXT, reason TEXT NOT NULL DEFAULT '', outcome_at TEXT, outcome_by INTEGER REFERENCES users(id),
  purpose TEXT NOT NULL DEFAULT '', atmo TEXT NOT NULL DEFAULT '')`);
          db.exec(`INSERT INTO bookings_new(${keep},subject,subject_id)
  SELECT ${keep}, CASE WHEN batch_id IS NULL THEN '' ELSE 'batch' END, batch_id FROM bookings`);
          db.exec('DROP TABLE bookings');
          db.exec('ALTER TABLE bookings_new RENAME TO bookings');
          db.exec('CREATE INDEX bookings_time ON bookings(start, end)');
          db.exec('CREATE INDEX bookings_subject ON bookings(subject, subject_id)');
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      } finally {
        db.exec('PRAGMA foreign_keys = ON');
      }
    },
  },
  {
    id: 35,
    owner: 'core',
    name: 'substances made from containers: CAS, several roles, flags; purity and brand on the containers; the bottle recipes use (0.44)',
    up: (db) => {
      add(db, 'chemicals', 'cas', "TEXT NOT NULL DEFAULT ''");
      add(db, 'containers', 'use', 'INTEGER NOT NULL DEFAULT 0');
      add(db, 'containers', 'barcode', "TEXT NOT NULL DEFAULT ''");
      db.exec('CREATE INDEX IF NOT EXISTS chemicals_cas ON chemicals(cas)');
      // containers named like a substance but not linked to it
      db.exec(
        'UPDATE containers SET chem_id=(SELECT id FROM chemicals c WHERE lower(c.name)=lower(containers.name)) WHERE chem_id IS NULL',
      );
      const chems = db.prepare('SELECT id, data FROM chemicals').all() as { id: number; data: string }[];
      for (const c of chems) {
        const d = JSON.parse(c.data || '{}');
        // the purity and brand the chemical had go to its containers that did not say theirs
        if (typeof d.pur === 'number' && d.pur !== 100)
          db.prepare('UPDATE containers SET purity=? WHERE chem_id=? AND purity IS NULL').run(d.pur, c.id);
        if (d.brand) db.prepare("UPDATE containers SET supplier=? WHERE chem_id=? AND supplier=''").run(d.brand, c.id);
        const cas = (
          db.prepare("SELECT cas FROM containers WHERE chem_id=? AND cas<>'' LIMIT 1").get(c.id) as
            { cas: string } | undefined
        )?.cas;
        const next = {
          f: d.f ?? '',
          M: d.M ?? 0,
          d: d.d ?? null,
          mp: null,
          bp: null,
          nD: null,
          roles: d.role && d.role !== 'other' ? [d.role] : [],
          ghs: [],
          pf: false,
          army: false,
          notes: '',
        };
        db.prepare('UPDATE chemicals SET data=?, cas=? WHERE id=?').run(JSON.stringify(next), cas ?? '', c.id);
      }
    },
  },
  {
    id: 37,
    owner: 'core',
    name: 'what records took from containers (0.45)',
    up: (db) =>
      db.exec(`CREATE TABLE IF NOT EXISTS container_draws(
        id INTEGER PRIMARY KEY,
        subject TEXT NOT NULL, subject_id INTEGER NOT NULL,
        substance TEXT NOT NULL, container_id INTEGER,
        mg REAL, ul REAL, amount REAL, unit TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
        at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, returned_at TEXT);
      CREATE INDEX IF NOT EXISTS container_draws_subject ON container_draws(subject, subject_id);
      CREATE INDEX IF NOT EXISTS container_draws_container ON container_draws(container_id);`),
  },
  {
    id: 39,
    owner: 'core',
    name: 'what was taken says whether it came from run data (0.45.1)',
    up: (db) => add(db, 'container_draws', 'basis', "TEXT NOT NULL DEFAULT 'planned'"),
  },
  {
    id: 40,
    owner: 'core',
    name: 'substances: trash, short and other names, pairs marked not the same, the reference list (0.54)',
    up: (db) => {
      // a substance goes to the trash with its containers (marked with the same time, so they come back together)
      add(db, 'chemicals', 'deleted_at', 'TEXT');
      add(db, 'chemicals', 'owner_id', 'INTEGER');
      add(db, 'chemicals', 'visibility', "TEXT NOT NULL DEFAULT 'shared'");
      add(db, 'containers', 'deleted_at', 'TEXT');
      // possible duplicates: people were told about the pair ('told'), or said they are not the same ('not')
      db.exec(`CREATE TABLE IF NOT EXISTS chem_pairs(
        a INTEGER NOT NULL, b INTEGER NOT NULL, state TEXT NOT NULL, PRIMARY KEY(a, b))`);
      // common compounds get their short name, other names and usual roles (solvent above all) from the reference list;
      // only added, never removed or overwritten
      for (const c of db.prepare("SELECT id, cas, data FROM chemicals WHERE cas<>''").all() as {
        id: number;
        cas: string;
        data: string;
      }[]) {
        const r = chemRef(c.cas);
        if (!r) continue;
        const d = JSON.parse(c.data || '{}');
        const next = withRef(d, r);
        db.prepare('UPDATE chemicals SET data=? WHERE id=?').run(JSON.stringify(next), c.id);
      }
    },
  },
  {
    id: 41,
    owner: 'core',
    name: 'imports recorded, when a substance was first made: purging the inventory and undoing an import (0.54.2)',
    up: (db) => {
      // each import, so it can be undone; what it made carries its id
      db.exec(`CREATE TABLE IF NOT EXISTS inventory_imports(
        id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, user_id INTEGER, username TEXT NOT NULL DEFAULT '',
        file TEXT NOT NULL DEFAULT '', containers INTEGER NOT NULL DEFAULT 0, substances INTEGER NOT NULL DEFAULT 0,
        undone_at TEXT, undone_by TEXT, undone_how TEXT)`);
      add(db, 'containers', 'import_id', 'INTEGER');
      add(db, 'chemicals', 'import_id', 'INTEGER');
      add(db, 'storage_areas', 'import_id', 'INTEGER');
      add(db, 'shelves', 'import_id', 'INTEGER');
      // substances had no date: the one of their oldest container is the closest guess (none: left empty, never "recent")
      add(db, 'chemicals', 'created_at', 'TEXT');
      db.exec(
        'UPDATE chemicals SET created_at=(SELECT MIN(added_at) FROM containers c WHERE c.chem_id=chemicals.id) WHERE created_at IS NULL',
      );
    },
  },
  {
    id: 43,
    owner: 'core',
    name: 'structures: common compounds get their SMILES from the reference list (0.57)',
    up: (db) => {
      // only added: a SMILES someone typed stays
      for (const c of db.prepare("SELECT id, cas, data FROM chemicals WHERE cas<>''").all() as {
        id: number;
        cas: string;
        data: string;
      }[]) {
        const r = chemRef(c.cas);
        if (!r?.smiles) continue;
        const d = JSON.parse(c.data || '{}');
        if (d.smiles) continue;
        db.prepare('UPDATE chemicals SET data=? WHERE id=?').run(JSON.stringify({ ...d, smiles: r.smiles }), c.id);
      }
    },
  },
];

/**
 * Brings the database up to date: runs the changes it has not had yet, in order, each in its own transaction (a change that
 * fails leaves the database as it was before that change, and the app does not start).
 */
export function migrate(db: Db, list: Migration[] = MIGRATIONS) {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations(
  id INTEGER PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, at TEXT NOT NULL)`);
  const done = new Set((db.prepare('SELECT id FROM migrations').all() as { id: number }[]).map((r) => r.id));
  const rec = db.prepare('INSERT INTO migrations(id,owner,name,at) VALUES(?,?,?,?)');
  for (const m of list) {
    if (done.has(m.id)) continue;
    if (m.noTx) {
      m.up(db);
      rec.run(m.id, m.owner, m.name, new Date().toISOString());
      continue;
    }
    db.exec('BEGIN');
    try {
      m.up(db);
      rec.run(m.id, m.owner, m.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`database change ${m.id} (${m.name}) failed: ${(e as Error).message}`, { cause: e });
    }
  }
}
