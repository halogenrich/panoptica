import { ADDED_CHEMS, DEFAULT_CHEMS } from '@psc/devices';
import { db, tx } from '@psc/server/api';

/**
 * The chemical list a new lab starts with: the common perovskite precursors, solvents and transport-layer materials, with their
 * formula and molar mass (0.43: Electronic Devices' list; the core's chemical list starts empty). Chemicals added in later
 * releases come once per release, so one an admin deleted is not added back.
 */
export function seedChemicals() {
  const ins = db.prepare('INSERT OR IGNORE INTO chemicals(name,data) VALUES(?,?)'),
    seen = db.prepare('SELECT 1 FROM meta WHERE key = ?'),
    mark = db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)');
  const add = (names?: string[]) =>
    DEFAULT_CHEMS.filter(([n]) => !names || names.includes(n)).forEach(([n, role, f, M, d]) =>
      ins.run(n, JSON.stringify({ role, f, M, d: d ?? null, pur: 100, brand: '' })),
    );
  const fresh = !db.prepare('SELECT 1 FROM chemicals LIMIT 1').get();
  tx(() => {
    if (fresh) add();
    // chemicals added in later releases: once per release, so a chemical an admin deleted is not added back
    for (const [rel, names] of Object.entries(ADDED_CHEMS))
      if (!seen.get('chems:' + rel)) {
        if (!fresh) add(names);
        mark.run('chems:' + rel, new Date().toISOString());
      }
  });
}
