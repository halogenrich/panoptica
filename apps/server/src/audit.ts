import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from './db.js';

/**
 * Activity log: who changed what, when and from where. Every accepted change through the API is recorded (never the content of
 * the change, so no passwords or data end up here), plus sign-ins, failed sign-ins and refused requests.
 * Each row carries a hash of the previous row's hash and its own fields (a hash chain): editing or deleting a row in the database
 * breaks the chain from that row on, and the check in Admin settings › Security shows where.
 * Rows older than two years are removed once a day; the hash the oldest kept row links to is kept, so the check still works.
 */
db.exec(`CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, user_id INTEGER, username TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', status INTEGER NOT NULL DEFAULT 200, prev TEXT NOT NULL, hash TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_at ON audit(at); CREATE INDEX IF NOT EXISTS audit_user ON audit(user_id);`);

export type AuditRow = {
  id: number;
  at: string;
  user_id: number | null;
  username: string;
  ip: string;
  action: string;
  target: string;
  status: number;
  prev: string;
  hash: string;
};
const fields = (r: Omit<AuditRow, 'id' | 'hash'>) =>
  [r.at, r.user_id ?? '', r.username, r.ip, r.action, r.target, r.status, r.prev].join('\u001f');
const digest = (r: Omit<AuditRow, 'id' | 'hash'>) => createHash('sha256').update(fields(r)).digest('hex');
const GENESIS = '0'.repeat(64);

export function audit(e: {
  user_id?: number | null;
  username?: string;
  ip?: string;
  action: string;
  target?: string;
  status?: number;
}) {
  const last = db.prepare('SELECT hash FROM audit ORDER BY id DESC LIMIT 1').get() as { hash: string } | undefined;
  const r = {
    at: new Date().toISOString(),
    user_id: e.user_id ?? null,
    username: e.username ?? '',
    ip: e.ip ?? '',
    action: e.action,
    target: (e.target ?? '').slice(0, 300),
    status: e.status ?? 200,
    prev: last?.hash ?? GENESIS,
  };
  db.prepare('INSERT INTO audit(at,user_id,username,ip,action,target,status,prev,hash) VALUES(?,?,?,?,?,?,?,?,?)').run(
    r.at,
    r.user_id,
    r.username,
    r.ip,
    r.action,
    r.target,
    r.status,
    r.prev,
    digest(r),
  );
}

/** Walks the whole chain; returns the first row that does not match (edited, inserted or deleted rows). */
export function verifyAudit(): { ok: boolean; rows: number; brokenAt?: { id: number; at: string } } {
  let prev: string | null =
      (db.prepare("SELECT value FROM meta WHERE key='audit_anchor'").get() as { value: string } | undefined)?.value ??
      GENESIS,
    n = 0;
  for (const r of db.prepare('SELECT * FROM audit ORDER BY id').iterate() as Iterable<AuditRow>) {
    n++;
    if ((prev !== null && r.prev !== prev) || digest(r) !== r.hash)
      return { ok: false, rows: n, brokenAt: { id: r.id, at: r.at } };
    prev = r.hash;
  }
  return { ok: true, rows: n };
}

/** Readable names for the API routes that change something. Unknown routes are logged with their method and path. */
const LABEL: Record<string, string> = {
  'POST /api/users': 'Created a user',
  'PATCH /api/users/:id': 'Changed a user',
  'DELETE /api/users/:id': 'Deleted a user',
  'PUT /api/users/:id/tags': 'Changed the tags of a user',
  'POST /api/tags': 'Created a tag',
  'PATCH /api/tags/:id': 'Changed a tag',
  'DELETE /api/tags/:id': 'Deleted a tag',
  'PATCH /api/me': 'Changed own profile',
  'POST /api/me/password': 'Changed own password',
  'POST /api/presets': 'Created a recipe or design',
  'PUT /api/presets/:id': 'Edited a recipe or design',
  'DELETE /api/presets/:id': 'Moved a recipe or design to the trash',
  'POST /api/presets/:id/runs': 'Added run data',
  'DELETE /api/runs/:id': 'Deleted run data',
  'POST /api/batches': 'Started a batch',
  'PATCH /api/batches/:id': 'Edited a batch',
  'DELETE /api/batches/:id': 'Moved a batch to the trash',
  'POST /api/iv': 'Imported a measurement',
  'PATCH /api/iv/:id': 'Edited a measurement',
  'PATCH /api/iv/curves/:cid': 'Changed which curves count',
  'DELETE /api/iv/:id': 'Moved a measurement to the trash',
  'POST /api/comparisons': 'Created a comparison',
  'PATCH /api/comparisons/:id': 'Edited a comparison',
  'DELETE /api/comparisons/:id': 'Moved a comparison to the trash',
  'POST /api/chemicals': 'Added a chemical',
  'PUT /api/chemicals/:id': 'Edited a chemical',
  'DELETE /api/chemicals/:id': 'Deleted a chemical',
  'POST /api/backups': 'Made a backup',
  'PUT /api/backups/mirror': 'Changed the backup copy folder',
  'GET /api/backups/:name': 'Downloaded a backup',
  'GET /api/backups/key': 'Viewed the backup key',
  'PUT /api/settings/figure': 'Changed the figure logo',
  'PUT /api/fun': 'Changed the funny settings',
  'POST /api/updates/check': 'Checked for updates',
  'PUT /api/updates/settings': 'Changed the update settings',
  'POST /api/updates/download': 'Downloaded an update',
  'POST /api/updates/install': 'Started installing an update',
  'GET /api/audit/export': 'Exported the activity log',
};
/** Changes not worth a line: presence, personal view settings, marking notifications read. */
const SKIP = [
  /^POST \/api\/presence/,
  /^PUT \/api\/prefs/,
  /^POST \/api\/login$/,
  /^POST \/api\/logout$/,
  /\/read$/,
  /^POST \/api\/notifications/,
];
/** Reads that are themselves sensitive and are logged. */
const LOGGED_READS = new Set(['GET /api/backups/:name', 'GET /api/backups/key', 'GET /api/audit/export']);

/** What a row refers to, looked up before the handler runs (so a deleted item still has its name). */
function nameOf(route: string, params: Record<string, string>): string {
  const id = Number(params.id);
  const q = (sql: string) =>
    Number.isFinite(id) ? (db.prepare(sql).get(id) as { n: string } | undefined)?.n : undefined;
  const n = route.startsWith('/api/users/')
    ? q("SELECT username || ' (' || name || ')' AS n FROM users WHERE id=?")
    : route.startsWith('/api/presets/')
      ? q('SELECT name AS n FROM presets WHERE id=?')
      : route.startsWith('/api/batches/')
        ? q('SELECT code AS n FROM batches WHERE id=?')
        : route.startsWith('/api/chemicals/')
          ? q('SELECT name AS n FROM chemicals WHERE id=?')
          : route.startsWith('/api/comparisons/')
            ? q('SELECT name AS n FROM comparisons WHERE id=?')
            : route.startsWith('/api/iv/:id')
              ? q('SELECT name AS n FROM iv_sets WHERE id=?')
              : route.startsWith('/api/tags/')
                ? q('SELECT name AS n FROM tags WHERE id=?')
                : route.startsWith('/api/backups/:name')
                  ? params.name
                  : undefined;
  const rest = Object.entries(params)
    .filter(([k]) => k !== 'id' && k !== 'name')
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  return [n ?? (params.id ? `#${params.id}` : ''), rest].filter(Boolean).join(' · ');
}

export const ipOf = (req: any) => String(req.ip ?? '').replace(/^::ffff:/, '');

export function registerAudit(app: FastifyInstance, auth: (need?: any) => any) {
  app.addHook('preHandler', async (req: any) => {
    const route = req.routeOptions?.url ?? '',
      key = `${req.method} ${route}`;
    if (!route.startsWith('/api/') || SKIP.some((r) => r.test(key))) return;
    if (req.method === 'GET' && !LOGGED_READS.has(key)) return;
    req.auditKey = key;
    req.auditTarget = nameOf(route, req.params ?? {});
  });
  app.addHook('onResponse', async (req: any, reply) => {
    let key = req.auditKey as string | undefined;
    if (!key) {
      // refused before the handler (not signed in, not allowed, cross-site): changes only
      const route = req.routeOptions?.url ?? '';
      if (
        !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ||
        !route.startsWith('/api/') ||
        ![401, 403].includes(reply.statusCode) ||
        SKIP.some((r) => r.test(`${req.method} ${route}`))
      )
        return;
      key = `${req.method} ${route}`;
    }
    const ok = reply.statusCode < 400;
    if (!ok && ![401, 403].includes(reply.statusCode)) return; // validation errors etc. change nothing
    audit({
      user_id: req.user?.id,
      username: req.user?.username,
      ip: ipOf(req),
      action: (ok ? '' : 'Refused: ') + (LABEL[key] ?? key),
      target: req.auditTarget ?? nameOf(req.routeOptions?.url ?? '', req.params ?? {}),
      status: reply.statusCode,
    });
  });

  // ---- reading the log (admins) ----
  const where = (q: any) => {
    const w: string[] = [],
      a: (string | number)[] = [];
    if (q.user) {
      w.push('user_id=?');
      a.push(+q.user);
    }
    if (q.q) {
      w.push('(action LIKE ? OR target LIKE ? OR username LIKE ? OR ip LIKE ?)');
      const s = `%${String(q.q).replace(/[%_]/g, '')}%`;
      a.push(s, s, s, s);
    }
    if (q.refused === '1') w.push('status>=400');
    if (q.before) {
      w.push('id<?');
      a.push(+q.before);
    }
    return { sql: w.length ? 'WHERE ' + w.join(' AND ') : '', a };
  };
  app.get('/api/audit', { preHandler: auth(true) }, async (req: any) => {
    const { sql, a } = where(req.query);
    const rows = db
      .prepare(`SELECT id,at,user_id,username,ip,action,target,status FROM audit ${sql} ORDER BY id DESC LIMIT 101`)
      .all(...a) as any[];
    return { rows: rows.slice(0, 100), more: rows.length > 100 };
  });
  app.get('/api/audit/verify', { preHandler: auth(true) }, async () => verifyAudit());
  app.get('/api/audit/export', { preHandler: auth(true) }, async (req: any, reply) => {
    const { sql, a } = where(req.query);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      'id,time (UTC),username,address,action,item,status,hash',
      ...(db.prepare(`SELECT * FROM audit ${sql} ORDER BY id`).all(...a) as AuditRow[]).map((r) =>
        [r.id, r.at, r.username, r.ip, r.action, r.target, r.status, r.hash].map(esc).join(','),
      ),
    ];
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="activity-log-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send('﻿' + lines.join('\r\n'));
  });

  /** Old rows go; the hash the first kept row links to is remembered, so the check still starts from a known value. */
  const prune = () => {
    const cut = new Date(Date.now() - 730 * 864e5).toISOString();
    const first = db.prepare('SELECT id,prev FROM audit WHERE at>=? ORDER BY id LIMIT 1').get(cut) as
      { id: number; prev: string } | undefined;
    if (!first || !db.prepare('SELECT 1 FROM audit WHERE id<? LIMIT 1').get(first.id)) return;
    db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('audit_anchor',?)").run(first.prev);
    db.prepare('DELETE FROM audit WHERE id<?').run(first.id);
  };
  prune();
  setInterval(prune, 864e5).unref();
}
