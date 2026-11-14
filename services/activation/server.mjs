// PANOPTICA's activation service (0.47): run by PANOPTICA, never by a lab. Plain Node 22 (node:http, node:sqlite), no other
// dependency, so it runs on any small server; the host is still to be chosen.
//
//   ADMIN_TOKEN=<long random> ACTIVATION_DATA=/var/lib/panoptica-activation PORT=8080 node services/activation/server.mjs
//
// What it knows: product keys, by their SHA-256 only (a copy of its database gives away no key), each with the lab, the
// licence PANOPTICA's staff signed for it (the service never holds the signing key), and how many computers may use it; the
// computers that activated it; and the releases: one signed package per combination of modules.
//
// For labs (the installer, and the app's updates), authenticated by the product key and the computer's install id:
//   POST /v1/check     {key, install}         what the key covers, and whether this computer may use it (nothing kept)
//   POST /v1/activate  {key, install, name}   registers this computer (within the key's limit); the licence and what it covers
//   POST /v1/licence   {key, install}         the key's current licence (a renewal, a module added)
//   POST /v1/latest    {key, install}         the latest release for the key's modules: version, date, notes, package
//   GET  /v1/files/<version>/<file>           with headers X-Key and X-Install: only the files of the key's package
// For PANOPTICA's staff (tools/builder/keys.mjs), with Authorization: Bearer <ADMIN_TOKEN>:
//   PUT    /v1/admin/keys/<key hash>          {lab, labId, licence, installs}: a key, or its new licence or limit
//   GET    /v1/admin/keys                     every key, its lab, modules, last day of updates, computers
//   DELETE /v1/admin/keys/<key hash>/installs/<install>   frees a place (a replaced computer)
//   PUT    /v1/admin/releases/<version>/<file>  (the file's bytes)   and   POST /v1/admin/releases/<version> {published, notes}
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const DATA = resolve(process.env.ACTIVATION_DATA || 'activation-data'),
  TOKEN = process.env.ADMIN_TOKEN ?? '';
if (TOKEN.length < 24) {
  console.error('Set ADMIN_TOKEN (24 characters or more): staff use it to add keys and releases.');
  process.exit(1);
}
mkdirSync(join(DATA, 'files'), { recursive: true });
const db = new DatabaseSync(join(DATA, 'activation.db'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS keys(hash TEXT PRIMARY KEY, lab TEXT NOT NULL, lab_id TEXT NOT NULL, licence TEXT NOT NULL,
  modules TEXT NOT NULL, updates_until TEXT NOT NULL, installs INTEGER NOT NULL DEFAULT 1, revoked INTEGER NOT NULL DEFAULT 0,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS installs(hash TEXT NOT NULL, install TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
  first_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(hash, install));
CREATE TABLE IF NOT EXISTS releases(version TEXT PRIMARY KEY, published TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS files(version TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
  PRIMARY KEY(version, name));`);

/** A product key as typed: without spaces or dashes, in capitals; its SHA-256 is how the service knows it. */
const keyHash = (key) =>
  createHash('sha256')
    .update(
      String(key ?? '')
        .replace(/[\s-]/g, '')
        .toUpperCase(),
    )
    .digest('hex');
const packageName = (mods) => `panoptica-${[...mods].sort().join('+') || 'core'}.zip`;
const cmpVersion = (a, b) => {
  const x = a.split('.').map(Number),
    y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

// wrong keys from one address are slowed down: 10 tries, then one a minute
const tries = new Map();
const blocked = (ip) => (tries.get(ip)?.n ?? 0) >= 10 && Date.now() - tries.get(ip).at < 60_000;
const missed = (ip) => tries.set(ip, { n: (tries.get(ip)?.n ?? 0) + 1, at: Date.now() });

function send(res, code, body, headers = {}) {
  const b = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(b);
}
const fail = (res, code, error) => send(res, code, { error });
function readBody(req, limit) {
  return new Promise((ok, no) => {
    const parts = [];
    let n = 0;
    req.on('data', (d) => {
      n += d.length;
      if (n > limit) {
        no(new Error('too large'));
        req.destroy();
      } else parts.push(d);
    });
    req.on('end', () => ok(Buffer.concat(parts)));
    req.on('error', no);
  });
}
const json = async (req) => JSON.parse((await readBody(req, 256 * 1024)).toString('utf8') || '{}');

/** The key's row when the key is known, not revoked, and (for an existing install) this computer activated it. */
function lab(ip, key, install, mustBeKnown = true) {
  if (blocked(ip)) return { error: [429, 'too many wrong keys from this address: wait a minute'] };
  const row = db.prepare('SELECT * FROM keys WHERE hash=?').get(keyHash(key));
  if (!row || row.revoked) {
    missed(ip);
    return { error: [403, 'this product key is not valid'] };
  }
  if (!install || typeof install !== 'string' || install.length > 80) return { error: [400, 'no install id'] };
  const known = db.prepare('SELECT 1 FROM installs WHERE hash=? AND install=?').get(row.hash, install);
  if (mustBeKnown && !known)
    return { error: [403, 'this computer has not activated the key: run the installer, or contact PANOPTICA'] };
  if (known)
    db.prepare('UPDATE installs SET seen_at=CURRENT_TIMESTAMP WHERE hash=? AND install=?').run(row.hash, install);
  return { row, known };
}
const covers = (row) => ({
  lab: row.lab,
  modules: JSON.parse(row.modules),
  updatesUntil: row.updates_until,
  installs: {
    used: db.prepare('SELECT COUNT(*) n FROM installs WHERE hash=?').get(row.hash).n,
    limit: row.installs,
  },
});
/** The newest release the key may install (published until its last day of updates) that has its package. */
function latestFor(row) {
  const name = packageName(JSON.parse(row.modules));
  const rows = db
    .prepare(
      `SELECT r.version, r.published, r.notes, f.size, f.sha256 FROM releases r JOIN files f ON f.version=r.version AND f.name=?
       WHERE substr(r.published,1,10) <= ?`,
    )
    .all(name, row.updates_until);
  rows.sort((a, b) => cmpVersion(b.version, a.version));
  const r = rows[0];
  if (!r) return null;
  const sig = db.prepare('SELECT 1 FROM files WHERE version=? AND name=?').get(r.version, name + '.sig');
  return {
    version: r.version,
    published: r.published,
    notes: r.notes,
    package: { name, size: r.size, sha256: r.sha256 },
    signed: !!sig,
  };
}
const admin = (req) => {
  const got = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer /, '')),
    want = Buffer.from(TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
};

const server = createServer(async (req, res) => {
  const ip = req.socket.remoteAddress ?? '',
    url = new URL(req.url, 'http://x'),
    p = url.pathname;
  try {
    if (req.method === 'GET' && p === '/v1/health') return send(res, 200, { ok: true });
    // ---- labs
    if (req.method === 'POST' && p === '/v1/activate') {
      const b = await json(req),
        r = lab(ip, b.key, b.install, false);
      if (r.error) return fail(res, ...r.error);
      if (!r.known) {
        const used = db.prepare('SELECT COUNT(*) n FROM installs WHERE hash=?').get(r.row.hash).n;
        if (used >= r.row.installs)
          return fail(
            res,
            409,
            `this product key is in use on ${used} computer${used === 1 ? '' : 's'}, its limit: contact PANOPTICA to move it to this one`,
          );
        db.prepare('INSERT INTO installs(hash, install, name) VALUES(?,?,?)').run(
          r.row.hash,
          b.install,
          String(b.name ?? '').slice(0, 80),
        );
      }
      return send(res, 200, { ...covers(r.row), licence: r.row.licence, latest: latestFor(r.row) });
    }
    // the installer, before anything is installed: what the key covers and whether this computer may use it; nothing is kept
    if (req.method === 'POST' && p === '/v1/check') {
      const b = await json(req),
        r = lab(ip, b.key, b.install, false);
      if (r.error) return fail(res, ...r.error);
      const c = covers(r.row);
      return send(res, 200, { ...c, room: !!r.known || c.installs.used < c.installs.limit, latest: latestFor(r.row) });
    }
    if (req.method === 'POST' && (p === '/v1/licence' || p === '/v1/latest')) {
      const b = await json(req),
        r = lab(ip, b.key, b.install);
      if (r.error) return fail(res, ...r.error);
      return p === '/v1/licence'
        ? send(res, 200, { ...covers(r.row), licence: r.row.licence })
        : send(res, 200, { ...covers(r.row), latest: latestFor(r.row) });
    }
    const fm = p.match(/^\/v1\/files\/(\d+\.\d+\.\d+)\/([\w.+-]+)$/);
    if (req.method === 'GET' && fm) {
      const r = lab(ip, req.headers['x-key'], req.headers['x-install']);
      if (r.error) return fail(res, ...r.error);
      const name = packageName(JSON.parse(r.row.modules));
      // only its own package, its signature and its checksum
      if (![name, name + '.sig', name + '.sha256'].includes(fm[2]))
        return fail(res, 403, 'this key does not cover this file');
      const f = join(DATA, 'files', fm[1], fm[2]);
      if (!existsSync(f)) return fail(res, 404, 'no such file');
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': statSync(f).size });
      return createReadStream(f).pipe(res);
    }
    // ---- staff
    if (p.startsWith('/v1/admin/')) {
      if (!admin(req)) return fail(res, 401, 'staff only');
      const km = p.match(/^\/v1\/admin\/keys\/([0-9a-f]{64})$/);
      if (req.method === 'PUT' && km) {
        const b = await json(req),
          l = JSON.parse(JSON.parse(b.licence).body);
        if (l.setup !== km[1]) return fail(res, 400, 'the licence’s setup hash is not this key’s');
        db.prepare(
          `INSERT INTO keys(hash, lab, lab_id, licence, modules, updates_until, installs) VALUES(?,?,?,?,?,?,?)
           ON CONFLICT(hash) DO UPDATE SET lab=excluded.lab, lab_id=excluded.lab_id, licence=excluded.licence,
             modules=excluded.modules, updates_until=excluded.updates_until, installs=excluded.installs,
             revoked=0, changed_at=CURRENT_TIMESTAMP`,
        ).run(
          km[1],
          l.lab,
          l.labId,
          b.licence,
          JSON.stringify(l.modules),
          l.updatesUntil,
          Math.max(1, +b.installs || 1),
        );
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && p === '/v1/admin/keys')
        return send(
          res,
          200,
          db
            .prepare(
              'SELECT hash, lab, lab_id, modules, updates_until, installs, revoked, changed_at FROM keys ORDER BY lab',
            )
            .all()
            .map((k) => ({
              ...k,
              modules: JSON.parse(k.modules),
              computers: db.prepare('SELECT install, name, first_at, seen_at FROM installs WHERE hash=?').all(k.hash),
            })),
        );
      const im = p.match(/^\/v1\/admin\/keys\/([0-9a-f]{64})\/installs\/([\w-]+)$/);
      if (req.method === 'DELETE' && im) {
        db.prepare('DELETE FROM installs WHERE hash=? AND install=?').run(im[1], im[2]);
        return send(res, 200, { ok: true });
      }
      const rm = p.match(/^\/v1\/admin\/releases\/(\d+\.\d+\.\d+)$/);
      if (req.method === 'POST' && rm) {
        const b = await json(req);
        db.prepare(
          'INSERT INTO releases(version, published, notes) VALUES(?,?,?) ON CONFLICT(version) DO UPDATE SET published=excluded.published, notes=excluded.notes',
        ).run(rm[1], String(b.published), String(b.notes ?? ''));
        return send(res, 200, { ok: true });
      }
      const ff = p.match(/^\/v1\/admin\/releases\/(\d+\.\d+\.\d+)\/([\w.+-]+)$/);
      if (req.method === 'PUT' && ff) {
        const data = await readBody(req, 1024 * 1024 * 1024),
          dir = join(DATA, 'files', ff[1]);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, ff[2] + '.part'), data);
        renameSync(join(dir, ff[2] + '.part'), join(dir, ff[2]));
        db.prepare(
          'INSERT INTO files(version, name, size, sha256) VALUES(?,?,?,?) ON CONFLICT(version, name) DO UPDATE SET size=excluded.size, sha256=excluded.sha256',
        ).run(ff[1], ff[2], data.length, createHash('sha256').update(data).digest('hex'));
        return send(res, 200, { ok: true, size: data.length });
      }
    }
    return fail(res, 404, 'not found');
  } catch (e) {
    return fail(res, 400, e.message === 'too large' ? 'too large' : 'bad request');
  }
});
const port = +(process.env.PORT || 8080);
server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`PANOPTICA activation service on port ${port}`));
