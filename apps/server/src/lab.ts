import type { FastifyInstance } from 'fastify';
import { AcceptIn, AccessRequestIn, DeclineIn, LabIn, LoginCheck, LoginSet, SetupIn, VisitorIn } from '@psc/schema';
import { DEFAULT_HOURS, passwordProblem, usernameFor, type WorkDay } from '@psc/core';
import { db, tx } from './db.js';
import { hash } from './auth.js';
import { notify } from './social.js';
import { weakPassword, type Limiter } from './security.js';
import { audit, ipOf } from './audit.js';

/**
 * The lab as a whole (0.36): the first setup on the computer that runs PANOPTICA, the lab's settings (name, institution, email
 * domains, departments, working hours, login images), and how people get an account: they ask for access, an admin accepts, and
 * at their first sign-in they choose a password after confirming the email and birth date they gave. No email is sent; the
 * sign-in screen tells each person where they are (password, set a password, waiting, declined).
 */

const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
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
  if (!cols('users').includes(c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} ${def}`);
db.exec(`
CREATE TABLE IF NOT EXISTS access_requests(
  id INTEGER PRIMARY KEY, username TEXT NOT NULL, first_names TEXT NOT NULL, surnames TEXT NOT NULL, email TEXT NOT NULL,
  birth_date TEXT NOT NULL, department TEXT NOT NULL, supervisor TEXT NOT NULL, cosupervisor TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','declined')), reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, decided_at TEXT, decided_by TEXT);
`);

const getMeta = (k: string) =>
  (db.prepare('SELECT value FROM meta WHERE key=?').get(k) as { value: string } | undefined)?.value;
const setMeta = (k: string, v: unknown) =>
  db
    .prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(k, JSON.stringify(v));

export type Lab = {
  name: string;
  institution: string;
  domains: string[];
  departments: string[];
  hours: WorkDay[];
  background: string;
  /** changes when the background or a logo changes, so browsers fetch them again */
  bgV: number;
  /** where the lab logo sits on the picture: t/m/b (top, middle, bottom) + l/c/r; 'mc' is the centre */
  logoPos: string;
  /** a white rounded plate behind the logo */
  logoPlate: boolean;
  /** the institution's logo, for the foot of the sign-in panel */
  instLogo: string;
  /** what the foot of the sign-in panel shows */
  foot: 'name' | 'logo' | 'both';
};
export function lab(): Lab {
  const d = JSON.parse(getMeta('lab') ?? '{}');
  return {
    name: d.name ?? '',
    institution: d.institution ?? '',
    domains: d.domains ?? [],
    departments: d.departments ?? [],
    hours: d.hours?.length === 7 ? d.hours : DEFAULT_HOURS,
    background: d.background ?? '',
    bgV: d.bgV ?? 0,
    logoPos: d.logoPos ?? 'br',
    logoPlate: d.logoPlate ?? true,
    instLogo: d.instLogo ?? '',
    foot: d.foot ?? 'name',
  };
}
const figure = () => JSON.parse(getMeta('figure') ?? '{}') as { watermark?: string; group?: string };

/** Saves lab settings; the logo is the figure logo (one logo for the app), and the lab's name is the name on figures. */
function saveLab(p: ReturnType<typeof LabIn.parse>) {
  const { logo, background, instLogo, ...rest } = p;
  const cur = lab();
  const next = { ...cur, ...rest };
  if (background !== undefined) next.background = background;
  if (instLogo !== undefined) next.instLogo = instLogo;
  if (background !== undefined || instLogo !== undefined || logo !== undefined) next.bgV = Date.now() % 1e9;
  setMeta('lab', next);
  const f = figure();
  // the lab's name is also the name next to the logo on exported figures
  if (logo !== undefined || rest.name)
    setMeta('figure', {
      ...f,
      ...(logo !== undefined ? { watermark: logo } : {}),
      ...(rest.name ? { group: rest.name } : {}),
    });
}

/** The setup is needed while there is no admin (a fresh install that was not given ADMIN_PASSWORD). */
export const setupNeeded = () => !db.prepare("SELECT 1 FROM users WHERE role='admin' AND deleted=0 LIMIT 1").get();
/** The computer that runs the app (not another computer on the network, and not through a proxy). */
const isLocal = (req: any) => /^(127\.|::1$|::ffff:127\.)/.test(req.socket?.remoteAddress ?? '');

/** Usernames in use or waiting (pending requests keep theirs until decided). Declined requests free theirs. */
const takenName = (u: string) =>
  !!db.prepare('SELECT 1 FROM users WHERE username=? COLLATE NOCASE').get(u) ||
  !!db.prepare("SELECT 1 FROM access_requests WHERE username=? COLLATE NOCASE AND status='pending'").get(u);

const fullName = (first: string, sur: string) => `${first.trim()} ${sur.trim()}`.replace(/\s+/g, ' ');
const admins = () =>
  (db.prepare("SELECT id FROM users WHERE role='admin' AND active=1 AND deleted=0").all() as { id: number }[]).map(
    (r) => r.id,
  );
/** Email domains the lab accepts for requests (any, when none are set); subdomains count (dac.unicamp.br for unicamp.br). */
const domainOk = (email: string) => {
  const ds = lab().domains;
  const d = email.split('@')[1] ?? '';
  return !ds.length || ds.some((x) => d === x || d.endsWith('.' + x));
};
const imgOf = (data: string) => data.match(/^data:(image\/[a-z+]+);base64,(.*)$/);

export function registerLab(
  app: FastifyInstance,
  auth: (need?: any) => any,
  bad: (reply: any, p: any) => any,
  startSession: (req: any, reply: any, u: { id: number; username: string }) => void,
  limits: { byName: Limiter; byAddress: Limiter },
) {
  // ---- what the sign-in screen needs, before anyone signs in ----
  app.get('/api/lab/public', async (req) => {
    const l = lab(),
      f = figure();
    return {
      name: l.name,
      institution: l.institution,
      departments: l.departments,
      domains: l.domains,
      hasLogo: !!f.watermark,
      hasBackground: !!l.background,
      bgV: l.bgV,
      logoPos: l.logoPos,
      logoPlate: l.logoPlate,
      hasInstLogo: !!l.instLogo,
      foot: l.foot,
      setup: setupNeeded() ? (isLocal(req) ? 'here' : 'elsewhere') : null,
      // professors, offered as supervisors on the request form
      professors: db
        .prepare(
          `SELECT DISTINCT u.name FROM users u JOIN user_tags ut ON ut.user_id=u.id JOIN tags t ON t.id=ut.tag_id
           WHERE t.kind='professor' AND u.deleted=0 AND u.active=1 ORDER BY u.name`,
        )
        .all()
        .map((r: any) => r.name),
    };
  });
  const sendImg = (reply: any, data: string | undefined) => {
    const m = data && imgOf(data);
    if (!m) return reply.code(404).send({ error: 'no image' });
    return reply.header('cache-control', 'public, max-age=86400').type(m[1]).send(Buffer.from(m[2], 'base64'));
  };
  app.get('/api/lab/logo', async (_req, reply) => sendImg(reply, figure().watermark));
  app.get('/api/lab/background', async (_req, reply) => sendImg(reply, lab().background));
  app.get('/api/lab/institution-logo', async (_req, reply) => sendImg(reply, lab().instLogo));

  /** Birthdays for the calendar: day and month only, of people who did not hide theirs. */
  app.get('/api/lab/birthdays', { preHandler: auth() }, async () =>
    (
      db
        .prepare(
          "SELECT id,name,birth_date AS b FROM users WHERE deleted=0 AND active=1 AND show_birthday=1 AND birth_date<>''",
        )
        .all() as { id: number; name: string; b: string }[]
    ).map((r) => ({ id: r.id, name: r.name, md: r.b.slice(5) })),
  );

  // ---- lab settings (admins) ----
  const labOut = () => {
    const { background, instLogo, ...l } = lab();
    return { ...l, hasBackground: !!background, hasInstLogo: !!instLogo, hasLogo: !!figure().watermark };
  };
  app.get('/api/lab', { preHandler: auth() }, async () => labOut());
  app.put('/api/lab', { preHandler: auth(true), bodyLimit: 12 * 1024 * 1024 }, async (req: any, reply) => {
    const p = LabIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    for (const v of [p.data.logo, p.data.instLogo])
      if (v && !/^data:image\/(png|jpeg|svg\+xml);base64,/.test(v))
        return reply.code(400).send({ error: 'a logo must be a PNG, JPEG or SVG image' });
    saveLab(p.data);
    return labOut();
  });

  // ---- first setup: only while there is no admin, and only on the computer that runs the app ----
  app.post('/api/setup', { bodyLimit: 14 * 1024 * 1024 }, async (req: any, reply) => {
    if (!setupNeeded()) return reply.code(409).send({ error: 'PANOPTICA is already set up' });
    if (!isLocal(req)) return reply.code(403).send({ error: 'finish the setup on the computer that runs PANOPTICA' });
    const p = SetupIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const a = p.data.admin;
    const problem = passwordProblem(a.password) || weakPassword(a.password);
    if (problem) return reply.code(400).send({ error: problem });
    const username = usernameFor(a.firstNames, a.surname, takenName);
    if (!username) return reply.code(400).send({ error: 'choose another surname for the username' });
    let id = 0;
    tx(() => {
      saveLab(p.data.lab);
      id = Number(
        db
          .prepare(
            `INSERT INTO users(username,name,role,hash,must_change,first_names,surnames,email,birth_date,department,photo,photo_v)
             VALUES(?,?,'admin',?,0,?,?,?,?,?,?,?)`,
          )
          .run(
            username,
            fullName(a.firstNames, a.surnames),
            hash(a.password.normalize('NFC')),
            a.firstNames,
            a.surnames,
            a.email,
            a.birthDate,
            a.department ?? '',
            a.photo || null,
            a.photo ? Date.now() % 1e9 : 0,
          ).lastInsertRowid,
      );
    });
    audit({ user_id: id, username, ip: ipOf(req), action: 'Set up PANOPTICA (first admin)' });
    startSession(req, reply, { id, username });
    return { id, username };
  });

  // ---- sign-in, step by step: what the username needs next ----
  const blocked = (req: any, key?: string) =>
    limits.byAddress.blocked(ipOf(req)) || (key ? limits.byName.blocked(key) : false);
  app.post('/api/login/check', async (req: any, reply) => {
    const p = LoginCheck.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'give your username' });
    if (blocked(req)) return reply.code(429).send({ error: 'too many attempts, try again in a few minutes' });
    const name = p.data.username.replace(/^@/, '').toLowerCase();
    const u = db
      .prepare('SELECT hash,active,visitor_until FROM users WHERE username=? COLLATE NOCASE AND deleted=0')
      .get(name) as any;
    if (u) {
      if (!u.active) return { next: 'password' }; // a disabled account is not told apart from a wrong password
      if (u.visitor_until && u.visitor_until < new Date().toISOString().slice(0, 10))
        return { next: 'ended', until: u.visitor_until };
      return { next: u.hash ? 'password' : 'set' };
    }
    const r = db
      .prepare('SELECT status,reason,created_at FROM access_requests WHERE username=? COLLATE NOCASE ORDER BY id DESC')
      .get(name) as any;
    if (r) return { next: r.status === 'pending' ? 'pending' : 'declined', reason: r.reason, since: r.created_at };
    limits.byAddress.hit(ipOf(req)); // guessing names counts towards the address limit
    return reply.code(404).send({ error: 'there is no user with this name' });
  });
  /** Choosing a password: after an admin accepted the request, after a reset, or for a new visitor. */
  app.post('/api/login/set', async (req: any, reply) => {
    const p = LoginSet.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'fill in every field' });
    const name = p.data.username.replace(/^@/, '').toLowerCase(),
      ip = ipOf(req);
    if (blocked(req, name)) return reply.code(429).send({ error: 'too many attempts, try again in a few minutes' });
    const u = db
      .prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE AND deleted=0 AND active=1 AND hash=''")
      .get(name) as any;
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    if (!u || !same(u.email, p.data.email) || (u.birth_date && u.birth_date !== p.data.birthDate)) {
      limits.byName.hit(name);
      limits.byAddress.hit(ip);
      audit({ user_id: u?.id, username: name, ip, action: 'Failed first sign-in (email or birth date)', status: 401 });
      return reply.code(401).send({ error: 'the email or birth date is not the one on this account' });
    }
    const problem = passwordProblem(p.data.password) || weakPassword(p.data.password, u.username);
    if (problem) return reply.code(400).send({ error: problem });
    db.prepare('UPDATE users SET hash=?, must_change=0 WHERE id=?').run(hash(p.data.password.normalize('NFC')), u.id);
    limits.byName.clear(name);
    audit({ user_id: u.id, username: u.username, ip, action: 'Chose a password (first sign-in)' });
    startSession(req, reply, u);
    return { id: u.id, username: u.username, name: u.name, role: u.role, mustChange: 0 };
  });

  // ---- asking for access ----
  app.get('/api/access-requests/username', async (req: any) => {
    const q = req.query as { first?: string; surname?: string };
    return { username: usernameFor(String(q.first ?? ''), String(q.surname ?? ''), takenName) };
  });
  app.post('/api/access-requests', { bodyLimit: 1024 * 1024 }, async (req: any, reply) => {
    if (setupNeeded()) return reply.code(409).send({ error: 'PANOPTICA is not set up yet' });
    if (limits.byAddress.blocked(ipOf(req)))
      return reply.code(429).send({ error: 'too many attempts, try again in a few minutes' });
    const p = AccessRequestIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const d = p.data;
    if (!domainOk(d.email))
      return reply.code(400).send({
        error: `use your institutional email (${lab()
          .domains.map((x) => '@' + x)
          .join(', ')})`,
      });
    if (d.birthDate > new Date().toISOString().slice(0, 10))
      return reply.code(400).send({ error: 'check the birth date' });
    if (db.prepare('SELECT 1 FROM users WHERE email=? AND deleted=0').get(d.email))
      return reply.code(409).send({ error: 'there is already an account with this email: sign in instead' });
    if (db.prepare("SELECT 1 FROM access_requests WHERE email=? AND status='pending'").get(d.email))
      return reply.code(409).send({ error: 'a request with this email is already waiting for an admin' });
    const username = usernameFor(d.firstNames, d.surname, takenName);
    if (!username) return reply.code(400).send({ error: 'choose another surname for the username' });
    limits.byAddress.hit(ipOf(req));
    tx(() => {
      db.prepare("DELETE FROM access_requests WHERE email=? AND status='declined'").run(d.email);
      db.prepare(
        `INSERT INTO access_requests(username,first_names,surnames,email,birth_date,department,supervisor,cosupervisor,photo)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      ).run(
        username,
        d.firstNames,
        d.surnames,
        d.email,
        d.birthDate,
        d.department,
        d.supervisor,
        d.cosupervisor ?? '',
        d.photo,
      );
    });
    notify(
      admins(),
      'access',
      `${fullName(d.firstNames, d.surnames)} asks for access (${d.department}, supervisor ${d.supervisor})`,
      { view: 'requests', id: 0 },
      fullName(d.firstNames, d.surnames),
    );
    audit({ username, ip: ipOf(req), action: 'Asked for access' });
    return { username };
  });
  app.get('/api/access-requests', { preHandler: auth(true) }, async () =>
    db
      .prepare(
        `SELECT id,username,first_names AS firstNames,surnames,email,birth_date AS birthDate,department,supervisor,cosupervisor,
         status,reason,created_at AS createdAt,decided_at AS decidedAt,decided_by AS decidedBy
         FROM access_requests ORDER BY status='pending' DESC, id DESC LIMIT 100`,
      )
      .all(),
  );
  app.get('/api/access-requests/count', { preHandler: auth(true) }, async () => ({
    n: (db.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE status='pending'").get() as { n: number }).n,
  }));
  app.get('/api/access-requests/:id/photo', { preHandler: auth(true) }, async (req: any, reply) => {
    const r = db.prepare('SELECT photo FROM access_requests WHERE id=?').get(+req.params.id) as
      { photo: string } | undefined;
    const m = r && imgOf(r.photo);
    if (!m) return reply.code(404).send({ error: 'no photo' });
    return reply.type(m[1]).send(Buffer.from(m[2], 'base64'));
  });
  app.post('/api/access-requests/:id/accept', { preHandler: auth(true) }, async (req: any, reply) => {
    const p = AcceptIn.safeParse(req.body ?? {});
    if (!p.success) return bad(reply, p);
    const r = db.prepare("SELECT * FROM access_requests WHERE id=? AND status='pending'").get(+req.params.id) as any;
    if (!r) return reply.code(404).send({ error: 'this request was already answered' });
    let id = 0;
    tx(() => {
      id = Number(
        db
          .prepare(
            `INSERT INTO users(username,name,role,hash,must_change,first_names,surnames,email,birth_date,department,supervisor,cosupervisor,photo,photo_v)
             VALUES(?,?,'member','',0,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            r.username,
            fullName(r.first_names, r.surnames),
            r.first_names,
            r.surnames,
            r.email,
            r.birth_date,
            r.department,
            r.supervisor,
            r.cosupervisor,
            r.photo,
            Date.now() % 1e9,
          ).lastInsertRowid,
      );
      const ins = db.prepare('INSERT OR IGNORE INTO user_tags VALUES(?,?)');
      p.data.tags.forEach((t) => ins.run(id, t));
      db.prepare('DELETE FROM access_requests WHERE id=?').run(r.id);
    });
    audit({
      user_id: req.user.id,
      username: req.user.username,
      ip: ipOf(req),
      action: `Accepted the access request of ${r.username}`,
    });
    return { id, username: r.username };
  });
  app.post('/api/access-requests/:id/decline', { preHandler: auth(true) }, async (req: any, reply) => {
    const p = DeclineIn.safeParse(req.body ?? {});
    if (!p.success) return bad(reply, p);
    const r = db.prepare("SELECT * FROM access_requests WHERE id=? AND status='pending'").get(+req.params.id) as any;
    if (!r) return reply.code(404).send({ error: 'this request was already answered' });
    db.prepare(
      "UPDATE access_requests SET status='declined', reason=?, decided_at=?, decided_by=?, photo='' WHERE id=?",
    ).run(p.data.reason, new Date().toISOString(), req.user.name, r.id);
    audit({
      user_id: req.user.id,
      username: req.user.username,
      ip: ipOf(req),
      action: `Declined the access request of ${r.username}`,
    });
    return { ok: true };
  });

  // ---- visitors: the only accounts admins create themselves ----
  app.post('/api/users', { preHandler: auth(true) }, async (req: any, reply) => {
    const p = VisitorIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const d = p.data;
    if (d.until < new Date().toISOString().slice(0, 10))
      return reply.code(400).send({ error: 'the last day of the visit is already past' });
    const username = usernameFor(d.firstNames, d.surname, takenName);
    if (!username) return reply.code(400).send({ error: 'choose another surname for the username' });
    const id = db
      .prepare(
        `INSERT INTO users(username,name,role,hash,must_change,first_names,surnames,email,birth_date,department,visitor_until)
         VALUES(?,?,'member','',0,?,?,?,?,?,?)`,
      )
      .run(
        username,
        fullName(d.firstNames, d.surnames),
        d.firstNames,
        d.surnames,
        d.email,
        d.birthDate,
        d.department ?? '',
        d.until,
      ).lastInsertRowid;
    audit({
      user_id: req.user.id,
      username: req.user.username,
      ip: ipOf(req),
      action: `Added the visitor ${username}`,
    });
    return { id: Number(id), username };
  });
}
