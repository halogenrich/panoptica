import './quiet.js';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { randomBytes } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  Login,
  NewUser,
  UserPatch,
  ChemicalIn,
  BatchIn,
  BatchPatch,
  VariantsIn,
  PrefsIn,
  PasswordIn,
  FigureSettingsIn,
  BackupMirrorIn,
  FunIn,
  ProfileIn,
  TagIn,
  UserTagsIn,
} from '@psc/schema';
import { ADDED_CHEMS, DEFAULT_CHEMS, CORE_VERSION } from '@psc/core';
import { db, tx, perms, tagsOf } from './db.js';
import { hash, verify } from './auth.js';
import { registerPresets } from './presets.js';
import { registerIv } from './iv.js';
import { registerComparisons } from './comparisons.js';
import { registerSocial } from './social.js';
import { registerInventory } from './inventory.js';
import { registerCalendar } from './calendar.js';
import { lockOf, lockText, markDone, UNLOCK_DAYS } from './batchlock.js';
import { registerDashboard } from './dashboard.js';
import { registerSecurity, tokenHash, Limiter, weakPassword } from './security.js';
import { registerAudit, audit, ipOf, verifyAudit } from './audit.js';
import { registerUpdates } from './updates.js';
import { registerEvents } from './events.js';
import {
  BACKUP_DIR,
  backupKey,
  backupNow,
  backupStream,
  checkFolder,
  getMirror,
  lastCheck,
  listBackups,
  scheduleBackups,
  setMirror,
} from './backup.js';

// HTTPS: either the university's web server in front of the app (TRUST_PROXY=1, it forwards the client address and https),
// or the app itself with a certificate (TLS_CERT and TLS_KEY: paths to PEM files).
const tls =
  process.env.TLS_CERT && process.env.TLS_KEY
    ? { cert: readFileSync(process.env.TLS_CERT), key: readFileSync(process.env.TLS_KEY) }
    : null;
const app = Fastify({
  logger: true,
  trustProxy: process.env.TRUST_PROXY === '1',
  ...(tls ? { https: tls } : {}),
} as Parameters<typeof Fastify>[0]) as unknown as FastifyInstance;
const HTTPS = !!tls || process.env.SECURE_COOKIES === '1';
await app.register(cookie);
registerSecurity(app);
const WEEK = 7 * 864e5,
  byName = new Limiter(5, 10 * 60e3),
  byAddress = new Limiter(30, 10 * 60e3);
const DUMMY = hash(randomBytes(12).toString('hex')); // unknown usernames take as long as wrong passwords
db.prepare('DELETE FROM sessions WHERE expires<?').run(new Date().toISOString());
if (!db.prepare("SELECT 1 FROM meta WHERE key='sessions_hashed'").get()) {
  // 0.26: sessions are stored hashed; older plain ones are dropped (everyone signs in once more)
  db.prepare('DELETE FROM sessions').run();
  db.prepare("INSERT INTO meta(key,value) VALUES('sessions_hashed','1')").run();
}
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires<?').run(new Date().toISOString()), 3600e3).unref();

// First run: create the admin user and print its password once.
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const name = process.env.ADMIN_USER || 'admin',
    pw = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');
  // a generated password must be changed at the first sign-in; one given in ADMIN_PASSWORD was chosen by whoever installs the app
  db.prepare('INSERT INTO users(username,name,role,hash,must_change) VALUES(?,?,?,?,?)').run(
    name,
    'Administrator',
    'admin',
    hash(pw),
    process.env.ADMIN_PASSWORD ? 0 : 1,
  );
  console.log(`\n[first run] admin user created -> username: ${name}  password: ${pw}\n`);
}

const seen = new Map<number, number>(),
  ONLINE_MS = 75_000; // online = a request in the last 75 s (open tabs check in every 15 s)
/** Leaving (sign out, last tab closed): seen as away within a few seconds, unless another tab or device checks in again. */
const leave = (id: number) => {
  seen.delete(id);
  db.prepare('UPDATE users SET last_seen=? WHERE id=?').run(new Date(Date.now() - ONLINE_MS + 5000).toISOString(), id);
};
const userOf = (req: any): User | undefined => {
  const t = req.cookies.sid;
  if (!t) return;
  const u = db
    .prepare(
      `SELECT u.id,u.username,u.name,u.role,u.must_change AS mustChange,u.photo_v AS photoV FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token=? AND s.expires>? AND u.active=1 AND u.deleted=0`,
    )
    .get(tokenHash(t), new Date().toISOString()) as User | undefined;
  if (!u) return;
  const p = perms(u.id);
  // presence: the last request time, written at most every 10 s; online_since restarts after being away
  if (Date.now() - (seen.get(u.id) ?? 0) > 1e4) {
    seen.set(u.id, Date.now());
    const now = new Date().toISOString(),
      away = new Date(Date.now() - ONLINE_MS - 30_000).toISOString(); // a tab closing while another stays open does not count as leaving
    db.prepare(
      'UPDATE users SET online_since=CASE WHEN last_seen IS NULL OR last_seen<? THEN ? ELSE online_since END, last_seen=? WHERE id=?',
    ).run(away, now, now, u.id);
  }
  return { ...u, ...p, all: u.role === 'admin' || p.professor };
};
/** Signed in; with `need`, also an admin ('admin') or an admin or a user with that tag ('inventory', 'manager'). */
const auth =
  (need: boolean | 'admin' | 'inventory' | 'manager' = false) =>
  async (req: any, reply: any) => {
    const u = userOf(req);
    if (!u) return reply.code(401).send({ error: 'login required' });
    const n = need === true ? 'admin' : need;
    if (n === 'admin' && u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    if ((n === 'inventory' || n === 'manager') && u.role !== 'admin' && !u[n])
      return reply.code(403).send({ error: `needs the ${n === 'inventory' ? 'Inventory' : 'Manager'} tag` });
    req.user = u;
  };
export type User = {
  id: number;
  username: string;
  name: string;
  role: 'admin' | 'member';
  photoV?: number;
  professor?: boolean;
  manager?: boolean;
  inventory?: boolean;
  all?: boolean;
};
const bad = (reply: any, p: { error: { issues: { message: string }[] } }) =>
  reply.code(400).send({ error: p.error.issues[0].message });
registerAudit(app, auth);

app.post('/api/login', async (req, reply) => {
  const p = Login.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'invalid request' });
  const key = p.data.username.toLowerCase(),
    ip = ipOf(req);
  if (byName.blocked(key) || byAddress.blocked(ip)) {
    audit({ username: p.data.username, ip, action: 'Sign-in blocked (too many attempts)', status: 429 });
    return reply.code(429).send({ error: 'too many attempts, try again in a few minutes' });
  }
  const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1 AND deleted=0').get(p.data.username) as any;
  if (!verify(p.data.password, u?.hash ?? DUMMY) || !u) {
    byName.hit(key);
    byAddress.hit(ip);
    audit({ user_id: u?.id, username: p.data.username, ip, action: 'Failed sign-in', status: 401 });
    return reply.code(401).send({ error: 'wrong username or password' });
  }
  byName.clear(key);
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
    tokenHash(token),
    u.id,
    new Date(Date.now() + WEEK).toISOString(),
  );
  reply.setCookie('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: HTTPS || req.protocol === 'https',
    maxAge: WEEK / 1000,
  });
  audit({ user_id: u.id, username: u.username, ip, action: 'Signed in' });
  return { id: u.id, username: u.username, name: u.name, role: u.role, mustChange: u.must_change };
});
app.post('/api/logout', async (req, reply) => {
  const u = userOf(req);
  if (u) {
    db.prepare('UPDATE users SET last_seen=NULL WHERE id=?').run(u.id);
    seen.delete(u.id);
    audit({ user_id: u.id, username: u.username, ip: ipOf(req), action: 'Signed out' });
  }
  if (req.cookies.sid) db.prepare('DELETE FROM sessions WHERE token=?').run(tokenHash(req.cookies.sid));
  reply.clearCookie('sid', { path: '/' });
  return { ok: true };
});
app.get('/api/me', { preHandler: auth() }, async (req: any) => ({ ...req.user, tags: tagsOf(req.user.id) }));
/** Own profile: display name and photo. */
app.patch('/api/me', { preHandler: auth() }, async (req: any, reply) => {
  const p = ProfileIn.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  if (p.data.name) db.prepare('UPDATE users SET name=? WHERE id=?').run(p.data.name, req.user.id);
  if (p.data.photo !== undefined)
    db.prepare('UPDATE users SET photo=?, photo_v=? WHERE id=?').run(
      p.data.photo || null,
      Date.now() % 1e9,
      req.user.id,
    );
  return { ok: true };
});
/** Profile photo (any signed-in user); ?v= is the photo version so browsers cache it until it changes. */
app.get('/api/users/:id/photo', { preHandler: auth() }, async (req: any, reply) => {
  const r = db.prepare('SELECT photo FROM users WHERE id=?').get(+req.params.id) as
    { photo: string | null } | undefined;
  const m = r?.photo?.match(/^data:(image\/[a-z+]+);base64,(.*)$/);
  if (!m) return reply.code(404).send({ error: 'no photo' });
  return reply
    .header('cache-control', 'private, max-age=31536000, immutable')
    .type(m[1])
    .send(Buffer.from(m[2], 'base64'));
});
/** Who is online with the Professor tag, for the eye next to search; `since` changes each time she comes back. Also the heartbeat of open tabs. */
app.get('/api/presence', { preHandler: auth() }, async (req: any) => ({
  professors: db
    .prepare(
      `SELECT DISTINCT u.id,u.name,u.photo_v AS photoV,u.online_since AS since FROM users u JOIN user_tags ut ON ut.user_id=u.id JOIN tags t ON t.id=ut.tag_id
    WHERE t.kind='professor' AND u.deleted=0 AND u.active=1 AND u.id<>? AND u.last_seen>?`,
    )
    .all(req.user.id, new Date(Date.now() - ONLINE_MS).toISOString()),
}));
/** Sent by the browser when a tab closes (sendBeacon). */
app.post('/api/presence/leave', async (req: any) => {
  const u = userOf(req);
  if (u) leave(u.id);
  return { ok: true };
});

// ---- fun: app-wide values for the funny settings (seconds between breaking-news headlines) ----
app.get('/api/fun', { preHandler: auth() }, async () => ({
  newsGap: 30,
  ...JSON.parse(
    (db.prepare("SELECT value FROM meta WHERE key='fun'").get() as { value: string } | undefined)?.value ?? '{}',
  ),
}));
app.put('/api/fun', { preHandler: auth(true) }, async (req: any, reply) => {
  const p = FunIn.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  db.prepare("INSERT INTO meta(key,value) VALUES('fun',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(
    JSON.stringify(p.data),
  );
  return p.data;
});

// ---- tags: everyone reads, admin edits ----
app.get('/api/tags', { preHandler: auth() }, async () =>
  db
    .prepare(
      'SELECT t.*, (SELECT COUNT(*) FROM user_tags ut JOIN users u ON u.id=ut.user_id WHERE ut.tag_id=t.id AND u.deleted=0) AS n FROM tags t ORDER BY t.pos, t.name',
    )
    .all(),
);
app.post('/api/tags', { preHandler: auth(true) }, async (req: any, reply) => {
  const p = TagIn.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  try {
    const pos = ((db.prepare('SELECT MAX(pos) AS m FROM tags').get() as any).m ?? 0) + 1;
    return {
      id: db
        .prepare("INSERT INTO tags(name,color,kind,pos) VALUES(?,?,'label',?)")
        .run(p.data.name, p.data.color ?? '#6b7280', pos).lastInsertRowid,
    };
  } catch {
    return reply.code(409).send({ error: 'a tag with this name already exists' });
  }
});
app.patch('/api/tags/:id', { preHandler: auth(true) }, async (req: any, reply) => {
  const p = TagIn.partial().safeParse(req.body);
  if (!p.success) return bad(reply, p);
  try {
    if (p.data.name) db.prepare('UPDATE tags SET name=? WHERE id=?').run(p.data.name, +req.params.id);
    if (p.data.color) db.prepare('UPDATE tags SET color=? WHERE id=?').run(p.data.color, +req.params.id);
    return { ok: true };
  } catch {
    return reply.code(409).send({ error: 'a tag with this name already exists' });
  }
});
app.delete('/api/tags/:id', { preHandler: auth(true) }, async (req: any, reply) => {
  const t = db.prepare('SELECT kind FROM tags WHERE id=?').get(+req.params.id) as { kind: string } | undefined;
  if (!t) return reply.code(404).send({ error: 'not found' });
  if (t.kind !== 'label')
    return reply.code(400).send({
      error: 'the Professor, Manager and Inventory tags give access and cannot be deleted (rename them if you like)',
    });
  db.prepare('DELETE FROM tags WHERE id=?').run(+req.params.id);
  return { ok: true };
});
app.put('/api/users/:id/tags', { preHandler: auth(true) }, async (req: any, reply) => {
  const p = UserTagsIn.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  const id = +req.params.id;
  tx(() => {
    db.prepare('DELETE FROM user_tags WHERE user_id=?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO user_tags VALUES(?,?)');
    p.data.tags.forEach((t) => ins.run(id, t));
  });
  return { ok: true };
});

// ---- admin: user management ----
app.get('/api/users', { preHandler: auth(true) }, async () =>
  (
    db
      .prepare(
        'SELECT id,username,name,role,active,must_change,created_at,photo_v AS photoV,last_seen FROM users WHERE deleted=0 ORDER BY id',
      )
      .all() as any[]
  ).map((u) => ({ ...u, tags: tagsOf(u.id) })),
);
/**
 * Delete a profile. Everything the user made (presets, batches, run data, measurements) stays, owned by a row that can no longer
 * sign in and is shown as "username (former)". The username becomes free for a new account.
 */
app.delete('/api/users/:id', { preHandler: auth(true) }, async (req: any, reply) => {
  const id = +req.params.id,
    u = db.prepare('SELECT * FROM users WHERE id=? AND deleted=0').get(id) as any;
  if (!u) return reply.code(404).send({ error: 'not found' });
  if (id === req.user.id) return reply.code(400).send({ error: 'you cannot delete your own profile' });
  if (
    u.role === 'admin' &&
    !db.prepare("SELECT 1 FROM users WHERE role='admin' AND active=1 AND deleted=0 AND id<>?").get(id)
  )
    return reply.code(400).send({ error: 'the last admin cannot be deleted' });
  tx(() => {
    db.prepare("UPDATE users SET deleted=1, active=0, role='member', hash='!', name=?, username=? WHERE id=?").run(
      `${u.username} (former)`,
      `former-${id}-${u.username}`,
      id,
    );
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    db.prepare('DELETE FROM user_prefs WHERE user_id=?').run(id);
  });
  return { ok: true };
});
app.post('/api/users', { preHandler: auth(true) }, async (req: any, reply) => {
  const p = NewUser.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  const weak = weakPassword(p.data.password, p.data.username);
  if (weak) return reply.code(400).send({ error: weak });
  try {
    // the temporary password the admin chose must be replaced at the first sign-in
    const r = db
      .prepare('INSERT INTO users(username,name,role,hash,must_change) VALUES(?,?,?,?,1)')
      .run(p.data.username, p.data.name, p.data.role, hash(p.data.password));
    return { id: r.lastInsertRowid };
  } catch {
    return reply.code(409).send({ error: 'username already exists' });
  }
});
app.patch('/api/users/:id', { preHandler: auth(true) }, async (req: any, reply) => {
  const id = +req.params.id,
    p = UserPatch.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  const d = p.data;
  if (d.password) {
    const un = (db.prepare('SELECT username FROM users WHERE id=?').get(id) as any)?.username;
    const weak = weakPassword(d.password, un);
    if (weak) return reply.code(400).send({ error: weak });
  }
  if (id === req.user.id && (d.active === false || d.role === 'member'))
    return reply.code(400).send({ error: 'you cannot disable or demote yourself' });
  if (d.name) db.prepare('UPDATE users SET name=? WHERE id=?').run(d.name, id);
  if (d.role) db.prepare('UPDATE users SET role=? WHERE id=?').run(d.role, id);
  if (d.active !== undefined) db.prepare('UPDATE users SET active=? WHERE id=?').run(d.active ? 1 : 0, id);
  if (d.password)
    db.prepare('UPDATE users SET hash=?,must_change=? WHERE id=?').run(
      hash(d.password),
      id === req.user.id ? 0 : 1,
      id,
    );
  if (d.password || d.active === false) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  return { ok: true };
});

registerPresets(app, auth, bad);
registerIv(app, auth, bad);
registerComparisons(app, auth, bad);
registerEvents(app, auth);
registerSocial(app, auth, bad);
registerInventory(app, auth, bad);
registerCalendar(app, auth, bad);
registerDashboard(app, auth);

// ---- chemicals: everyone reads, admin edits ----
db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
{
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
app.get('/api/chemicals', { preHandler: auth() }, async () =>
  (db.prepare('SELECT * FROM chemicals ORDER BY name').all() as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    ...JSON.parse(r.data),
  })),
);
app.post('/api/chemicals', { preHandler: auth('inventory') }, async (req: any, reply) => {
  const p = ChemicalIn.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  const { name, ...rest } = p.data;
  try {
    return {
      id: db.prepare('INSERT INTO chemicals(name,data) VALUES(?,?)').run(name, JSON.stringify(rest)).lastInsertRowid,
    };
  } catch {
    return reply.code(409).send({ error: 'name already exists' });
  }
});
app.put('/api/chemicals/:id', { preHandler: auth('inventory') }, async (req: any, reply) => {
  const p = ChemicalIn.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  const { name, ...rest } = p.data;
  try {
    db.prepare('UPDATE chemicals SET name=?,data=? WHERE id=?').run(name, JSON.stringify(rest), +req.params.id);
    return { ok: true };
  } catch {
    return reply.code(409).send({ error: 'name already exists' });
  }
});
app.delete('/api/chemicals/:id', { preHandler: auth('inventory') }, async (req: any) => {
  db.prepare('DELETE FROM chemicals WHERE id=?').run(+req.params.id);
  return { ok: true };
});

// ---- batches: a stack frozen at run start + the values recorded during the run ----
// 0.33: variants (other stacks or changes from the default device, with their recipes frozen when saved)
if (!(db.prepare('PRAGMA table_info(batches)').all() as { name: string }[]).some((c) => c.name === 'variants'))
  db.exec(`ALTER TABLE batches ADD COLUMN variants TEXT NOT NULL DEFAULT '{"control":"","list":[]}'`);
const preset = (u: User, id: string) => {
  if (!id) return null;
  const r = db.prepare('SELECT name,data,owner_id,visibility FROM presets WHERE id=?').get(+id) as any;
  if (!r || !(r.owner_id === u.id || r.visibility === 'shared' || !!u.all))
    throw new Error('a preset used in this stack is not available');
  return { name: r.name, data: JSON.parse(r.data) };
};
const batchOf = (req: any, reply: any, edit = false) => {
  const b = db
    .prepare(
      'SELECT b.*,u.name AS owner FROM batches b JOIN users u ON u.id=b.owner_id WHERE b.id=? AND b.deleted_at IS NULL',
    )
    .get(+req.params.id) as any;
  const u = req.user as User,
    editable = b && (b.owner_id === u.id || u.role === 'admin');
  if (!b || !(editable || b.visibility === 'shared')) {
    reply.code(404).send({ error: 'not found' });
    return null;
  }
  if (edit && !editable) {
    reply.code(403).send({ error: 'not your batch' });
    return null;
  }
  const lock = lockOf(b);
  if (edit && lock.locked) {
    reply.code(423).send({ error: lockText(b.code) });
    return null;
  }
  return {
    ...b,
    editable: !!editable && !lock.locked,
    snapshot: JSON.parse(b.snapshot),
    record: JSON.parse(b.record),
    variants: JSON.parse(b.variants),
    mine: b.owner_id === u.id,
    lock,
  };
};
/** Every layer's presets resolved (frozen copy of name and data); a recipe the user cannot see resolves to null. */
const resolveStack = (u: User, stack: { sl?: { a: string; b: string }[] }, strict = false) => {
  const resolved: Record<number, { a: unknown; b: unknown }> = {};
  const one = (id: string) => {
    try {
      return preset(u, id);
    } catch (e) {
      if (strict) throw e;
      return null;
    }
  };
  (stack.sl ?? []).forEach((x, i) => (resolved[i] = { a: one(x.a), b: one(x.b) }));
  return resolved;
};
app.get('/api/batches', { preHandler: auth() }, async (req: any) => {
  const rows = db
    .prepare(
      `SELECT b.id,b.code,b.name,b.status,b.visibility,(b.owner_id=@uid) AS mine,u.name AS owner,b.created_at,b.updated_at,b.record,
    json_extract(b.snapshot,'$.stack.arch') AS arch, b.variants, b.done_at, b.unlocked_until, json_array_length(b.snapshot,'$.stack.sl') AS total, json_extract(b.snapshot,'$.stack.thumb') AS thumb,
    (SELECT COUNT(*) FROM run_data r WHERE r.batch=b.code) AS runs,
    (SELECT COUNT(*) FROM bookings k WHERE k.batch_id=b.id AND COALESCE(k.outcome,'')<>'canceled') AS steps,
    (SELECT COUNT(*) FROM bookings k WHERE k.batch_id=b.id AND k.outcome='done') AS concluded
    FROM batches b JOIN users u ON u.id=b.owner_id
    WHERE b.deleted_at IS NULL AND (b.owner_id=@uid OR b.visibility='shared' OR @all=1) ORDER BY b.id DESC`,
    )
    .all({ uid: req.user.id, all: req.user.all ? 1 : 0 }) as any[];
  // progress follows the calendar: booked steps concluded out of booked steps (canceled ones left out)
  return rows.map(({ record: _r, done_at, unlocked_until, variants, ...r }) => ({
    ...r,
    // the variants by id and name (for linking measured samples)
    variants: ((JSON.parse(variants).list ?? []) as { id: string; name: string }[]).map((v) => ({
      id: v.id,
      name: v.name,
    })),
    locked: lockOf({ code: r.code, status: r.status, done_at, unlocked_until }).locked,
  }));
});
/** Run-data entries recorded under this batch's code, on any preset the user can see. */
app.get('/api/batches/:id/runs', { preHandler: auth() }, async (req: any, reply) => {
  const b = batchOf(req, reply);
  if (!b) return;
  return (
    db
      .prepare(
        `SELECT r.id,r.preset_id,r.data,r.created_at,r.owner_id,u.name AS author,p.name AS preset,p.segment FROM run_data r
    JOIN users u ON u.id=r.owner_id JOIN presets p ON p.id=r.preset_id
    WHERE r.batch=@code AND (p.owner_id=@uid OR p.visibility='shared' OR @all=1) ORDER BY r.id`,
      )
      .all({ code: b.code, uid: req.user.id, all: req.user.all ? 1 : 0 }) as any[]
  ).map((r) => ({ ...r, ...JSON.parse(r.data), data: undefined, mine: r.owner_id === req.user.id ? 1 : 0 }));
});
app.get('/api/batches/:id', { preHandler: auth() }, async (req: any, reply) => batchOf(req, reply));
/**
 * A stack with its recipes resolved as a batch would freeze them, without making a batch: comparisons read the recipes of devices
 * linked to a stack this way ("what changed" between groups).
 */
app.get('/api/stacks/:id/snapshot', { preHandler: auth() }, async (req: any, reply) => {
  const r = db
    .prepare("SELECT * FROM presets WHERE id=? AND segment='stk' AND deleted_at IS NULL")
    .get(+req.params.id) as any;
  if (!r || !(r.owner_id === req.user.id || r.visibility === 'shared' || req.user.all))
    return reply.code(404).send({ error: 'not found' });
  const stack = JSON.parse(r.data),
    resolved = resolveStack(req.user, stack);
  const chems = (db.prepare('SELECT name,data FROM chemicals').all() as any[]).map((c) => ({
    name: c.name,
    ...JSON.parse(c.data),
  }));
  return { id: r.id, code: r.name, snapshot: { stack, resolved, chems } };
});
app.post('/api/batches', { preHandler: auth() }, async (req: any, reply) => {
  const p = BatchIn.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  const resolved: Record<number, unknown> = {};
  try {
    p.data.stack.sl.forEach((x, i) => {
      resolved[i] = { a: preset(req.user, x.a), b: preset(req.user, x.b) };
    });
  } catch (e) {
    return reply.code(400).send({ error: (e as Error).message });
  }
  const chems = (db.prepare('SELECT name,data FROM chemicals').all() as any[]).map((r) => ({
    name: r.name,
    ...JSON.parse(r.data),
  }));
  try {
    const r = db
      .prepare('INSERT INTO batches(owner_id,code,name,visibility,snapshot) VALUES(?,?,?,?,?)')
      .run(
        req.user.id,
        p.data.code,
        p.data.name,
        p.data.visibility,
        JSON.stringify({ stack: p.data.stack, resolved, chems, coreVersion: CORE_VERSION, source: p.data.source }),
      );
    return { id: r.lastInsertRowid };
  } catch {
    return reply.code(409).send({
      error: (db.prepare('SELECT deleted_at FROM batches WHERE code=?').get(p.data.code) as any)?.deleted_at
        ? 'a batch with this code is in the trash: restore it or empty it from the trash first'
        : 'batch code already exists',
    });
  }
});
app.patch('/api/batches/:id', { preHandler: auth() }, async (req: any, reply) => {
  const p = BatchPatch.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  const d = p.data,
    id = +req.params.id;
  // sharing stays open on a locked batch; everything else needs it unlocked
  const onlyShare = d.visibility && d.name === undefined && !d.status && !d.record;
  if (onlyShare) {
    const b = batchOf(req, reply);
    if (!b) return;
    if (!(b.owner_id === req.user.id || req.user.role === 'admin'))
      return reply.code(403).send({ error: 'not your batch' });
  } else if (!batchOf(req, reply, true)) return;
  if (d.name !== undefined) db.prepare('UPDATE batches SET name=? WHERE id=?').run(d.name, id);
  if (d.status) {
    db.prepare('UPDATE batches SET status=? WHERE id=?').run(d.status, id);
    markDone(id);
  }
  if (d.visibility) db.prepare('UPDATE batches SET visibility=? WHERE id=?').run(d.visibility, id);
  if (d.record) db.prepare('UPDATE batches SET record=? WHERE id=?').run(JSON.stringify(d.record), id);
  db.prepare('UPDATE batches SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
  return { ok: true };
});
app.delete('/api/batches/:id', { preHandler: auth() }, async (req: any, reply) => {
  if (!batchOf(req, reply, true)) return;
  db.prepare('UPDATE batches SET deleted_at=? WHERE id=?').run(new Date().toISOString(), +req.params.id); // to the trash
  return { ok: true, trash: true };
});
/**
 * The batch's variants. Recipes and stacks are frozen when first linked (like the batch itself); a link kept from before keeps its
 * frozen copy, so editing a variant's name does not pick up later edits of its recipes.
 */
app.put('/api/batches/:id/variants', { preHandler: auth() }, async (req: any, reply) => {
  const b = batchOf(req, reply, true);
  if (!b) return;
  const p = VariantsIn.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  const sl = b.snapshot.stack.sl as { n: string; m: string }[],
    old = (b.variants?.list ?? []) as any[];
  const ids = p.data.list.map((v) => v.id);
  if (new Set(ids).size !== ids.length) return reply.code(400).send({ error: 'two variants have the same id' });
  const kept = new Map<string, unknown>();
  for (const v of old)
    for (const c of v.changes ?? []) {
      if (c.t === 'recipe' && c.name !== undefined) kept.set('p' + c.id, { name: c.name, data: c.data });
      if (c.t === 'layer') {
        if (c.a && c.ra) kept.set('p' + c.a, c.ra);
        if (c.b && c.rb) kept.set('p' + c.b, c.rb);
      }
    }
  const frozen = (id: string | number) => {
    if (!id) return null;
    if (!kept.has('p' + id)) kept.set('p' + id, preset(req.user, String(id)));
    return kept.get('p' + id) as { name: string; data: unknown };
  };
  try {
    const list = p.data.list.map((v) => {
      if (v.stack) {
        const was = old.find((o) => o.stack?.id === v.stack);
        if (was) return { ...v, changes: [], stack: was.stack };
        const r = db
          .prepare("SELECT * FROM presets WHERE id=? AND segment='stk' AND deleted_at IS NULL")
          .get(v.stack) as any;
        if (!r || !(r.owner_id === req.user.id || r.visibility === 'shared' || req.user.all))
          throw new Error('the linked stack is not available');
        const stack = JSON.parse(r.data);
        return {
          ...v,
          changes: [],
          stack: { id: r.id, name: r.name, stack, resolved: resolveStack(req.user, stack, true) },
        };
      }
      const changes = v.changes.map((c) => {
        const at = c.t === 'layer' ? c.after : c.t === 'other' ? c.slot : c.slot;
        if (at !== null && at >= sl.length)
          throw new Error(`${v.name}: a change refers to a layer the batch does not have`);
        if (c.t === 'recipe') {
          if (c.which === 'b' && sl[c.slot].m !== 'Spin') throw new Error(`${v.name}: only spin coating has a program`);
          return { ...c, ...frozen(c.id) };
        }
        if (c.t === 'layer') return { ...c, ra: frozen(c.a), rb: frozen(c.b) };
        return c;
      });
      return { ...v, stack: null, changes };
    });
    db.prepare('UPDATE batches SET variants=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(
      JSON.stringify({ control: p.data.control, list }),
      b.id,
    );
    return { control: p.data.control, list };
  } catch (e) {
    return reply.code(400).send({ error: (e as Error).message });
  }
});
/** Admin: open a locked batch for changes for a few days (it locks again by itself), or lock it again now. */
app.post('/api/batches/:id/unlock', { preHandler: auth(true) }, async (req: any, reply) => {
  const b = batchOf(req, reply);
  if (!b) return;
  const until = new Date(Date.now() + UNLOCK_DAYS * 864e5).toISOString();
  db.prepare('UPDATE batches SET unlocked_until=? WHERE id=?').run(until, b.id);
  return { unlockedUntil: until };
});
app.post('/api/batches/:id/lock', { preHandler: auth(true) }, async (req: any, reply) => {
  const b = batchOf(req, reply);
  if (!b) return;
  db.prepare('UPDATE batches SET unlocked_until=NULL WHERE id=?').run(b.id);
  return { ok: true };
});

// ---- profile: own password, preferences; global search ----
app.post('/api/me/password', { preHandler: auth() }, async (req: any, reply) => {
  const p = PasswordIn.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  const u = db.prepare('SELECT hash FROM users WHERE id=?').get(req.user.id) as any;
  if (!verify(p.data.current, u.hash)) return reply.code(400).send({ error: 'current password is wrong' });
  if (p.data.next === p.data.current)
    return reply.code(400).send({ error: 'choose a new password, different from the current one' });
  const weak = weakPassword(p.data.next, req.user.username);
  if (weak) return reply.code(400).send({ error: weak });
  db.prepare('UPDATE users SET hash=?,must_change=0 WHERE id=?').run(hash(p.data.next), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(req.user.id, tokenHash(req.cookies.sid));
  return { ok: true };
});
app.get('/api/prefs', { preHandler: auth() }, async (req: any) => {
  const r = db.prepare('SELECT data FROM user_prefs WHERE user_id=?').get(req.user.id) as any;
  return r ? JSON.parse(r.data) : {};
});
app.put('/api/prefs', { preHandler: auth(), bodyLimit: 3 * 1024 * 1024 }, async (req: any, reply) => {
  const p = PrefsIn.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  const r = db.prepare('SELECT data FROM user_prefs WHERE user_id=?').get(req.user.id) as any;
  const d = { ...(r ? JSON.parse(r.data) : {}), ...p.data };
  db.prepare(
    'INSERT INTO user_prefs(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data',
  ).run(req.user.id, JSON.stringify(d));
  return d;
});
// ---- figure logo and group name: one for the app, set by admins; each user chooses per export whether to include it ----
const getMeta = (k: string) =>
  (db.prepare('SELECT value FROM meta WHERE key=?').get(k) as { value: string } | undefined)?.value;
if (!getMeta('figure')) {
  // earlier versions kept the logo in each user's settings: take an admin's (else anyone's) as the app's
  const rows = db
    .prepare(
      "SELECT p.data, u.role FROM user_prefs p JOIN users u ON u.id=p.user_id ORDER BY (u.role='admin') DESC, u.id",
    )
    .all() as any[];
  const src = rows.map((r) => JSON.parse(r.data)).find((d) => d.watermark || d.group);
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(
    'figure',
    JSON.stringify(src ? { watermark: src.watermark ?? '', group: src.group ?? '' } : { watermark: '', group: '' }),
  );
}
app.get('/api/settings/figure', { preHandler: auth() }, async () => JSON.parse(getMeta('figure') ?? '{}'));
app.put('/api/settings/figure', { preHandler: auth(true), bodyLimit: 3 * 1024 * 1024 }, async (req: any, reply) => {
  const p = FigureSettingsIn.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  const d = { ...JSON.parse(getMeta('figure') ?? '{}'), ...p.data };
  db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run('figure', JSON.stringify(d));
  return d;
});
app.get('/api/search', { preHandler: auth() }, async (req: any) => {
  const q = '%' + String(req.query.q || '').replace(/[%_]/g, '') + '%',
    p = { q, uid: req.user.id, all: req.user.all ? 1 : 0 };
  return {
    presets: db
      .prepare(
        `SELECT id,segment,name FROM presets WHERE deleted_at IS NULL AND name LIKE @q AND (owner_id=@uid OR visibility='shared' OR @all=1) ORDER BY name LIMIT 8`,
      )
      .all(p),
    batches: db
      .prepare(
        `SELECT id,code,name FROM batches WHERE deleted_at IS NULL AND (code LIKE @q OR name LIKE @q) AND (owner_id=@uid OR visibility='shared' OR @all=1) ORDER BY id DESC LIMIT 8`,
      )
      .all(p),
    chemicals: db.prepare('SELECT id,name FROM chemicals WHERE name LIKE @q ORDER BY name LIMIT 8').all({ q }),
    // containers by name, CAS or lot, with where they are
    containers: db
      .prepare(
        `SELECT c.id,c.name,c.lot,c.status,a.name AS place FROM containers c LEFT JOIN storage_areas a ON a.id=c.area_id
         WHERE (c.name LIKE @q OR c.cas LIKE @q OR c.lot LIKE @q) ORDER BY c.status='empty', c.name LIMIT 8`,
      )
      .all({ q }),
    measurements: db
      .prepare(
        `SELECT id,name,date FROM iv_sets WHERE deleted_at IS NULL AND name LIKE @q AND (owner_id=@uid OR visibility='shared' OR @all=1) ORDER BY date DESC LIMIT 6`,
      )
      .all(p),
    comparisons: db
      .prepare(
        `SELECT id,name FROM comparisons WHERE deleted_at IS NULL AND name LIKE @q AND (owner_id=@uid OR visibility='shared' OR @all=1) ORDER BY updated_at DESC LIMIT 6`,
      )
      .all(p),
  };
});

const VERSION = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
).version;
app.get('/api/version', async () => ({ version: VERSION }));
/** Where other devices can reach the app: only when it was started for the network (start-network / start lan). */
app.get('/api/network', { preHandler: auth() }, async () => {
  const host = process.env.HOST || '127.0.0.1',
    lan = host === '0.0.0.0' || host === '::',
    port = +(process.env.PORT || 3000);
  const addresses = Object.entries(networkInterfaces()).flatMap(([name, list]) =>
    (list ?? [])
      .filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
      .map((a) => ({ name, address: a.address })),
  );
  return { lan, port, host: hostname(), addresses };
});

// ---- admin: database backups ----
app.get('/api/backups', { preHandler: auth(true) }, async () => ({
  dir: BACKUP_DIR,
  files: listBackups(),
  mirror: getMirror(),
  check: lastCheck(),
}));
/** The key of the encrypted second copies: admins save it somewhere safe (a password manager, a printed sheet in the lab safe). */
app.get('/api/backups/key', { preHandler: auth(true) }, async () => ({ key: backupKey(), file: 'config/backup.key' }));
app.put('/api/backups/mirror', { preHandler: auth(true) }, async (req: any, reply) => {
  const p = BackupMirrorIn.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  const err = checkFolder(p.data.dir.trim());
  if (err) return reply.code(400).send({ error: `${p.data.dir}: ${err}` });
  return setMirror(p.data.dir, p.data.encrypt ?? true);
});
app.post('/api/backups', { preHandler: auth(true) }, async () => backupNow('manual'));
app.get('/api/backups/:name', { preHandler: auth(true) }, async (req: any, reply) => {
  const s = backupStream(req.params.name);
  if (!s) return reply.code(404).send({ error: 'backup not found' });
  return reply
    .header('content-type', 'application/octet-stream')
    .header('content-disposition', `attachment; filename="${req.params.name}"`)
    .send(s);
});

// ---- serve the built web app (npm run build) ----
const dist = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html'),
  );
}
registerUpdates(app, auth, VERSION);

/** Admin settings › Security: the state of the things that keep the data safe, in one request. */
app.get('/api/security', { preHandler: auth(true) }, async (req: any) => {
  const users = db
    .prepare('SELECT id,username,name,role,must_change,last_seen,created_at FROM users WHERE deleted=0 AND active=1')
    .all() as any[];
  const old = Date.now() - 90 * 864e5;
  return {
    https: req.protocol === 'https',
    tls: !!tls,
    trustProxy: process.env.TRUST_PROXY === '1',
    lan: ['0.0.0.0', '::'].includes(process.env.HOST || ''),
    admins: users.filter((u) => u.role === 'admin').map((u) => u.name),
    temporary: users.filter((u) => u.must_change).map((u) => u.name),
    idle: users
      .filter((u) => new Date(u.last_seen ?? u.created_at.replace(' ', 'T') + 'Z').getTime() < old)
      .map((u) => u.name),
    backups: { last: listBackups().find((f) => !f.enc) ?? null, check: lastCheck(), mirror: getMirror() },
    audit: verifyAudit(),
  };
});
scheduleBackups((m) => app.log.info(m));
await app.listen({ port: +(process.env.PORT || 3000), host: process.env.HOST || '127.0.0.1' });
