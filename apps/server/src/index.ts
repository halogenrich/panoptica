import './quiet.js';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { randomBytes } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  Login,
  UserPatch,
  ChemicalIn,
  PrefsIn,
  PasswordIn,
  FigureSettingsIn,
  BackupMirrorIn,
  FunIn,
  ProfileIn,
  TagIn,
  UserTagsIn,
} from '@psc/schema';
import { passwordProblem, ageOn } from '@psc/core';
import { db, tx, perms, tagHas, tagsOf } from './db.js';
import { hash, verify as verifyRaw } from './auth.js';
import { registerSocial, startTrash } from './social.js';
import { registerInventory } from './inventory.js';
import { registerCalendar } from './calendar.js';
import { items, modules } from './modules.js';
import { registerEquipment } from './equipment.js';
import { registerDashboard } from './dashboard.js';
import { registerSecurity, tokenHash, Limiter, weakPassword } from './security.js';
import { registerAudit, audit, ipOf, verifyAudit } from './audit.js';
import { registerUpdates } from './updates.js';
import { registerEvents } from './events.js';
import { registerLab, setupNeeded } from './lab.js';
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

// ---- the modules (0.43): each registers what it adds, runs its database changes and later its routes. A built package has
// them bundled in (the package builder lists them in __PANOPTICA_MODULES__); from source they are loaded from modules/<id>/server,
// all of those present unless PANOPTICA_MODULES lists some ('none' or '': the core alone).
declare const __PANOPTICA_MODULES__: string[] | undefined;
if (typeof __PANOPTICA_MODULES__ === 'undefined') {
  const root = fileURLToPath(new URL('../../../', import.meta.url)),
    present = existsSync(join(root, 'modules'))
      ? readdirSync(join(root, 'modules')).filter((id) => existsSync(join(root, 'modules', id, 'server/src/index.ts')))
      : [];
  const want =
    process.env.PANOPTICA_MODULES === undefined
      ? present
      : process.env.PANOPTICA_MODULES.split(',')
          .map((x) => x.trim())
          .filter((x) => x && x !== 'none');
  for (const id of want) {
    if (!present.includes(id)) throw new Error(`module ${id} is not in modules/`);
    await import(pathToFileURL(join(root, 'modules', id, 'server/src/index.ts')).href); // a file URL: Windows paths are not URLs
  }
}
// a test module (tests only): the core must work with whatever modules register, not just Electronic Devices
if (process.env.PANOPTICA_TEST === '1' && process.env.PANOPTICA_TEST_MODULE)
  await import(pathToFileURL(process.env.PANOPTICA_TEST_MODULE).href);

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
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires<?').run(new Date().toISOString()), 3600e3).unref();

/**
 * A password as typed, in either Unicode form: "ã" typed as one character or as "a" plus a tilde is the same password. Passwords
 * are stored from the composed (NFC) form since 0.36; older ones may have been stored as typed. An empty hash means no password
 * yet (the person chooses one at the first sign-in), "!" a deleted account.
 */
const verify = (pw: string, stored: string) =>
  !!stored && stored.includes(':') && (verifyRaw(pw.normalize('NFC'), stored) || verifyRaw(pw, stored));

// First run: the first admin is made in the setup screens, on the computer that runs the app (0.36). Automated installs (tests)
// can still give ADMIN_PASSWORD to start with an admin.
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get() && process.env.ADMIN_PASSWORD) {
  db.prepare('INSERT INTO users(username,name,role,hash,must_change) VALUES(?,?,?,?,0)').run(
    process.env.ADMIN_USER || 'admin',
    'Administrator',
    'admin',
    hash(process.env.ADMIN_PASSWORD.normalize('NFC')),
  );
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
    WHERE s.token=? AND s.expires>? AND u.active=1 AND u.deleted=0 AND (u.visitor_until IS NULL OR u.visitor_until>=?)`,
    )
    .get(tokenHash(t), new Date().toISOString(), new Date().toISOString().slice(0, 10)) as User | undefined;
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
  /** manages all equipment (tag permission) */
  equipment?: boolean;
  /** trains people on any equipment (tag permission) */
  training?: boolean;
  all?: boolean;
};
const bad = (reply: any, p: { error: { issues: { message: string }[] } }) =>
  reply.code(400).send({ error: p.error.issues[0].message });
registerAudit(app, auth);

/** A new session cookie for a user who just proved who they are (password, first password, setup). */
function startSession(req: any, reply: any, u: { id: number; username: string }) {
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
  audit({ user_id: u.id, username: u.username, ip: ipOf(req), action: 'Signed in' });
}
registerLab(app, auth, bad, startSession, { byName, byAddress });

app.post('/api/login', async (req, reply) => {
  const p = Login.safeParse(req.body);
  if (!p.success) return reply.code(400).send({ error: 'invalid request' });
  const key = p.data.username.toLowerCase(),
    ip = ipOf(req);
  if (byName.blocked(key) || byAddress.blocked(ip)) {
    audit({ username: p.data.username, ip, action: 'Sign-in blocked (too many attempts)', status: 429 });
    return reply.code(429).send({ error: 'too many attempts, try again in a few minutes' });
  }
  const u = db
    .prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1 AND deleted=0')
    .get(p.data.username.replace(/^@/, '')) as any;
  if (!verify(p.data.password, u?.hash || DUMMY) || !u) {
    byName.hit(key);
    byAddress.hit(ip);
    audit({ user_id: u?.id, username: p.data.username, ip, action: 'Failed sign-in', status: 401 });
    return reply.code(401).send({ error: 'wrong username or password' });
  }
  if (u.visitor_until && u.visitor_until < new Date().toISOString().slice(0, 10))
    return reply.code(403).send({ error: 'your visitor access has ended' });
  byName.clear(key);
  startSession(req, reply, u);
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
app.get('/api/me', { preHandler: auth() }, async (req: any) => {
  const x = db
    .prepare(
      `SELECT email,birth_date AS birthDate,department,supervisor,cosupervisor,show_birthday AS showBirthday,
       visitor_until AS visitorUntil,first_names AS firstNames,surnames FROM users WHERE id=?`,
    )
    .get(req.user.id) as any;
  return { ...req.user, ...x, showBirthday: !!x.showBirthday, tags: tagsOf(req.user.id) };
});
/** Own profile: display name and photo. */
app.patch('/api/me', { preHandler: auth() }, async (req: any, reply) => {
  const p = ProfileIn.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  if (p.data.name) db.prepare('UPDATE users SET name=? WHERE id=?').run(p.data.name, req.user.id);
  const cols: [keyof typeof p.data, string][] = [
    ['email', 'email'],
    ['birthDate', 'birth_date'],
    ['department', 'department'],
    ['supervisor', 'supervisor'],
    ['cosupervisor', 'cosupervisor'],
  ];
  for (const [k, c] of cols)
    if (p.data[k] !== undefined) db.prepare(`UPDATE users SET ${c}=? WHERE id=?`).run(p.data[k] as string, req.user.id);
  if (p.data.showBirthday !== undefined)
    db.prepare('UPDATE users SET show_birthday=? WHERE id=?').run(p.data.showBirthday ? 1 : 0, req.user.id);
  if (p.data.photo !== undefined)
    db.prepare('UPDATE users SET photo=?, photo_v=? WHERE id=?').run(
      p.data.photo || null,
      p.data.photo ? Date.now() % 1e9 : 0, // no photo: version 0, so everyone falls back to the initials
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
/** Who is online with the Professor tag, for the eye next to search; `since` changes each time they come back. Also the heartbeat of open tabs. */
app.get('/api/presence', { preHandler: auth() }, async (req: any) => ({
  professors: db
    .prepare(
      `SELECT DISTINCT u.id,u.name,u.photo_v AS photoV,u.online_since AS since FROM users u JOIN user_tags ut ON ut.user_id=u.id JOIN tags t ON t.id=ut.tag_id
    WHERE ${tagHas('comments')} AND u.deleted=0 AND u.active=1 AND u.id<>? AND u.last_seen>?`,
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
  (
    db
      .prepare(
        'SELECT t.*, (SELECT COUNT(*) FROM user_tags ut JOIN users u ON u.id=ut.user_id WHERE ut.tag_id=t.id AND u.deleted=0) AS n FROM tags t ORDER BY t.pos, t.name',
      )
      .all() as any[]
  ).map((t) => ({
    ...t,
    perms: JSON.parse(t.perms || '[]'),
    // who has it (for the tag's window)
    people: db
      .prepare(
        'SELECT u.id,u.name,u.photo_v AS photoV FROM user_tags ut JOIN users u ON u.id=ut.user_id WHERE ut.tag_id=? AND u.deleted=0 ORDER BY u.name',
      )
      .all(t.id),
  })),
);
app.post('/api/tags', { preHandler: auth(true) }, async (req: any, reply) => {
  const p = TagIn.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  try {
    const pos = ((db.prepare('SELECT MAX(pos) AS m FROM tags').get() as any).m ?? 0) + 1;
    return {
      id: db
        .prepare("INSERT INTO tags(name,color,kind,pos,perms) VALUES(?,?,'label',?,?)")
        .run(p.data.name, p.data.color ?? '#6b7280', pos, JSON.stringify(p.data.perms ?? [])).lastInsertRowid,
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
    if (p.data.perms) {
      // at least one admin keeps the app manageable: perms never lock admins out, they only add access
      db.prepare('UPDATE tags SET perms=? WHERE id=?').run(JSON.stringify([...new Set(p.data.perms)]), +req.params.id);
    }
    return { ok: true };
  } catch {
    return reply.code(409).send({ error: 'a tag with this name already exists' });
  }
});
app.delete('/api/tags/:id', { preHandler: auth(true) }, async (req: any, reply) => {
  const t = db.prepare('SELECT kind FROM tags WHERE id=?').get(+req.params.id) as { kind: string } | undefined;
  if (!t) return reply.code(404).send({ error: 'not found' });
  // any tag can be deleted (0.38): what it gave goes with it
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
        `SELECT id,username,name,role,active,must_change,created_at,photo_v AS photoV,last_seen,email,birth_date AS birthDate,
         department,supervisor,cosupervisor,visitor_until AS visitorUntil,(hash='') AS noPassword FROM users WHERE deleted=0 ORDER BY id`,
      )
      .all() as any[]
  ).map((u) => ({ ...u, age: u.birthDate ? ageOn(u.birthDate) : null, tags: tagsOf(u.id) })),
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
app.patch('/api/users/:id', { preHandler: auth(true) }, async (req: any, reply) => {
  const id = +req.params.id,
    p = UserPatch.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  const d = p.data;
  if (id === req.user.id && (d.active === false || d.role === 'member'))
    return reply.code(400).send({ error: 'you cannot disable or demote yourself' });
  if (d.name) db.prepare('UPDATE users SET name=? WHERE id=?').run(d.name, id);
  if (d.role) db.prepare('UPDATE users SET role=? WHERE id=?').run(d.role, id);
  if (d.active !== undefined) db.prepare('UPDATE users SET active=? WHERE id=?').run(d.active ? 1 : 0, id);
  const cols: [keyof typeof d, string][] = [
    ['department', 'department'],
    ['supervisor', 'supervisor'],
    ['cosupervisor', 'cosupervisor'],
    ['email', 'email'],
    ['birthDate', 'birth_date'],
  ];
  for (const [k, c] of cols)
    if (d[k] !== undefined) db.prepare(`UPDATE users SET ${c}=? WHERE id=?`).run(d[k] as string, id);
  if (d.until !== undefined) db.prepare('UPDATE users SET visitor_until=? WHERE id=?').run(d.until || null, id);
  if (d.resetPassword) {
    if (id === req.user.id) return reply.code(400).send({ error: 'change your own password in your profile' });
    const x = db.prepare('SELECT email FROM users WHERE id=?').get(id) as { email: string } | undefined;
    if (!x?.email)
      return reply.code(400).send({
        error: 'add their institutional email first: they confirm it (and their birth date) to choose the new password',
      });
    db.prepare("UPDATE users SET hash='', must_change=0 WHERE id=?").run(id);
  }
  if (d.resetPassword || d.active === false) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  return { ok: true };
});

registerEvents(app, auth);
registerSocial(app, auth, bad);
registerInventory(app, auth, bad);
registerEquipment(app, auth, bad);
registerCalendar(app, auth, bad);
for (const m of modules()) m.register?.(app, auth, bad);
startTrash();
registerDashboard(app, auth);

// ---- chemicals: everyone reads, admin edits ----
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

// ---- profile: own password, preferences; global search ----
app.post('/api/me/password', { preHandler: auth() }, async (req: any, reply) => {
  const p = PasswordIn.safeParse(req.body);
  if (!p.success) return bad(reply, p);
  const u = db.prepare('SELECT hash FROM users WHERE id=?').get(req.user.id) as any;
  if (!verify(p.data.current, u.hash)) return reply.code(400).send({ error: 'current password is wrong' });
  if (p.data.next === p.data.current)
    return reply.code(400).send({ error: 'choose a new password, different from the current one' });
  const weak = passwordProblem(p.data.next) || weakPassword(p.data.next, req.user.username);
  if (weak) return reply.code(400).send({ error: weak });
  db.prepare('UPDATE users SET hash=?,must_change=0 WHERE id=?').run(hash(p.data.next.normalize('NFC')), req.user.id);
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
/** One search over every record type the modules register (those the person may open), then containers and chemicals. */
app.get('/api/search', { preHandler: auth() }, async (req: any) => {
  const q = '%' + String(req.query.q || '').replace(/[%_]/g, '') + '%',
    p = { q, uid: req.user.id, all: (req.user.all ? 1 : 0) as 0 | 1 };
  const containers = (
    db
      .prepare(
        `SELECT c.id,c.name,c.lot,c.status,a.name AS place FROM containers c LEFT JOIN storage_areas a ON a.id=c.area_id
         WHERE (c.name LIKE @q OR c.cas LIKE @q OR c.lot LIKE @q) ORDER BY c.status='empty', c.name LIMIT 8`,
      )
      .all({ q }) as any[]
  ).map((c) => ({
    key: 'container:' + c.id,
    label: c.name + (c.lot ? `, lot ${c.lot}` : ''),
    hint: `Container${c.place ? ', ' + c.place : ''}${c.status === 'empty' ? ' (empty)' : ''}`,
    link: { view: 'chem', id: c.id },
  }));
  const chemicals = (
    db.prepare('SELECT id,name FROM chemicals WHERE name LIKE @q ORDER BY name LIMIT 8').all({ q }) as any[]
  ).map((c) => ({ key: 'chemical:' + c.id, label: c.name, hint: 'Chemical list', link: { view: 'chem', id: null } }));
  return { hits: [...items().flatMap((k) => k.search?.(q, p) ?? []), ...containers, ...chemicals] };
});

const VERSION = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
).version;
/** The version, and the modules installed (the app shows only their pages). */
app.get('/api/version', async () => ({ version: VERSION, modules: modules().map((m) => m.id) }));
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
if (setupNeeded())
  console.log(
    `\n  PANOPTICA is not set up yet. Open http://localhost:${process.env.PORT || 3000} on this computer to create the first admin and set up the lab.\n`,
  );
