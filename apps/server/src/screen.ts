import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { ScreenIn, ScreenOpenIn } from '@psc/schema';
import { passwordProblem } from '@psc/core';
import { db } from './db.js';
import { hash, verify } from './auth.js';
import { audit, ipOf } from './audit.js';
import { eventStream } from './events.js';
import { hasLogo, lab } from './lab.js';
import { modules } from './modules.js';
import { Limiter, tokenHash, weakPassword } from './security.js';

/**
 * The lab screen (0.59): a TV in the lab shows the equipment, the week's bookings, the best device of the week, the month's
 * birthdays and the gloveboxes' O₂ and H₂O, two pages taking turns. It is opened from the sign-in screen with a password an admin
 * sets in Admin settings › Display mode; names show without anyone signing in (Richard accepted that, 17 Nov). The TV gets a
 * cookie of its own that only reads the screen (no account, no app), kept until an admin changes the password or turns the
 * screen off. Anyone signed in also sees it in the app (0.60.1, Richard: "Display mode" in the side menu, the view as on the TV;
 * admins only in 0.59). Its settings are Admin settings › Display mode.
 */

export type ScreenSettings = {
  on: boolean;
  /** the password's hash ('' until one is set) */
  hash: string;
  /** seconds each page shows */
  interval: number;
  /** System / Light / Dark, as the app's own switch; Light by default (Richard) */
  theme: 'system' | 'light' | 'dark';
  /** O₂ and H₂O limits in ppm by equipment id; null: no limit */
  limits: Record<string, { o2: number | null; h2o: number | null }>;
  /** Display mode (0.60.1): seconds O₂ and H₂O show today before the last 7 days (and back); 10 by default (Richard) */
  atmoSwitch: number;
  /** the screens shown, in order: 1 equipment and the week, 2 best device and today, 3 O₂ and H₂O and birthdays */
  pages: (1 | 2 | 3)[];
  /** the top left: the lab's logo, name or both; its full name or acronym; the institution's logo, name, both or nothing */
  labShow: 'logo' | 'name' | 'both';
  labName: 'name' | 'acronym';
  inst: 'none' | 'logo' | 'name' | 'both';
};

const COOKIE = 'screen',
  // browsers keep a cookie at most about 400 days; it is set again on every visit, so a TV that stays on keeps it
  KEEP = 400 * 864e5;

export function screenSettings(): ScreenSettings {
  const r = db.prepare("SELECT value FROM meta WHERE key='screen'").get() as { value: string } | undefined;
  const d = r ? JSON.parse(r.value) : {};
  return {
    on: !!d.on && !!d.hash,
    hash: d.hash ?? '',
    interval: Number.isInteger(d.interval) ? d.interval : 20,
    theme: ['system', 'light', 'dark'].includes(d.theme) ? d.theme : 'light',
    limits: d.limits ?? {},
    atmoSwitch: Number.isInteger(d.atmoSwitch) ? d.atmoSwitch : 10,
    pages: Array.isArray(d.pages) && d.pages.length ? d.pages : [1, 2, 3],
    labShow: ['logo', 'name', 'both'].includes(d.labShow) ? d.labShow : 'both',
    // the lab's own choice (Lab setup) until Display mode says otherwise
    labName: d.labName === 'acronym' || d.labName === 'name' ? d.labName : lab().show,
    inst: ['none', 'logo', 'name', 'both'].includes(d.inst) ? d.inst : 'none',
  };
}
const save = (s: ScreenSettings) =>
  db
    .prepare("INSERT INTO meta(key,value) VALUES('screen',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify(s));
/** Every TV the screen is open on has to type the password again. */
const closeAll = () => db.exec('DELETE FROM screen_sessions');

/** Monday 00:00 of this week, in the server's time (the lab's). */
export function mondayOf(d = new Date()) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

/** What the screen shows, in one answer. */
export function screenData(version: string) {
  const s = screenSettings(),
    l = lab(),
    now = new Date(),
    iso = now.toISOString(),
    mon = mondayOf(now),
    next = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 7);

  // ---- page 1: each piece of equipment people book, and the week's bookings
  const eqs = db
    .prepare('SELECT id,name,color,atmosphere FROM equipment WHERE active=1 AND booked=1 ORDER BY pos, id')
    .all() as { id: number; name: string; color: string; atmosphere: number }[];
  const live = `outcome IS NULL OR outcome<>'canceled'`;
  // everyone using it now (0.60.1: equipment several people use at once), the one ending last first
  const nowOf = db.prepare(
    `SELECT k.end, u.name AS by FROM bookings k JOIN users u ON u.id=k.user_id
     WHERE k.equipment_id=? AND k.start<=? AND k.end>? AND (${live}) ORDER BY k.end DESC`,
  );
  const nextOf = db.prepare(
    `SELECT k.start, k.end, u.name AS by FROM bookings k JOIN users u ON u.id=k.user_id
     WHERE k.equipment_id=? AND k.start>? AND (${live}) ORDER BY k.start LIMIT 1`,
  );
  const offOf = db.prepare('SELECT end, reason FROM equipment_off WHERE equipment_id=? AND start<=? AND end>? LIMIT 1');
  const equipment = eqs.map((e) => {
    const off = offOf.get(e.id, iso, iso) as { end: string; reason: string } | undefined,
      users = nowOf.all(e.id, iso, iso) as { end: string; by: string }[],
      use = users[0],
      nx = nextOf.get(e.id, iso) as { start: string; end: string; by: string } | undefined;
    return {
      id: e.id,
      name: e.name,
      color: e.color,
      state: off ? 'off' : use ? 'use' : 'free',
      ...(off ? { until: off.end, reason: off.reason } : use ? { until: use.end, by: use.by, users } : {}),
      next: nx ?? null,
    };
  });
  const week = db
    .prepare(
      `SELECT k.id, k.equipment_id, e.name AS equipment, e.color, k.start, k.end, u.name AS user_name
       FROM bookings k JOIN equipment e ON e.id=k.equipment_id JOIN users u ON u.id=k.user_id
       WHERE k.end>? AND k.start<? AND (k.outcome IS NULL OR k.outcome<>'canceled') AND e.active=1 ORDER BY k.start`,
    )
    .all(mon.toISOString(), next.toISOString());

  // ---- page 2: the month's birthdays (people who show theirs; no ages), the gloveboxes' last 7 days, the modules' parts
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const birthdays = (
    db
      .prepare(
        'SELECT name, birth_date AS b FROM users WHERE deleted=0 AND active=1 AND show_birthday=1 AND substr(birth_date,6,2)=?',
      )
      .all(mm) as { name: string; b: string }[]
  )
    .map((r) => ({ name: r.name, day: +r.b.slice(8, 10) }))
    .filter((r) => r.day > 0)
    .sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
  const since = new Date(now.getTime() - 7 * 864e5).toISOString();
  const atmosphere = (
    db.prepare('SELECT id,name,color FROM equipment WHERE active=1 AND atmosphere=1 ORDER BY pos, id').all() as {
      id: number;
      name: string;
      color: string;
    }[]
  ).map((e) => ({
    ...e,
    limits: { o2: s.limits[e.id]?.o2 ?? null, h2o: s.limits[e.id]?.h2o ?? null },
    // the readings people type when they answer a booking on it (0.38), at the booking's end
    // the last reading before the 7 days too (0.60.2, Richard): one continuous line, the window only cuts it
    readings: [
      ...(db
        .prepare("SELECT end, atmo FROM bookings WHERE equipment_id=? AND atmo<>'' AND end<? ORDER BY end DESC LIMIT 1")
        .all(e.id, since) as { end: string; atmo: string }[]),
      ...(db
        .prepare("SELECT end, atmo FROM bookings WHERE equipment_id=? AND atmo<>'' AND end>=? AND end<=? ORDER BY end")
        .all(e.id, since, iso) as { end: string; atmo: string }[]),
    ]
      .map((r) => {
        try {
          const a = JSON.parse(r.atmo);
          return Number.isFinite(a.o2) && Number.isFinite(a.h2o) ? { at: r.end, o2: a.o2, h2o: a.h2o } : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean),
  }));
  const parts: Record<string, unknown> = {};
  for (const m of modules()) {
    const p = m.screen?.();
    if (p) parts[m.id] = p;
  }
  return {
    version,
    now: iso,
    name: s.labName === 'acronym' && l.acronym ? l.acronym : l.name,
    hasLogo: hasLogo(),
    bgV: l.bgV,
    interval: s.interval,
    theme: s.theme,
    atmoSwitch: s.atmoSwitch,
    pages: s.pages,
    labShow: s.labShow,
    inst: { show: s.inst, name: l.institution, hasLogo: !!l.instLogo },
    hours: l.hours,
    weekFrom: mon.toISOString(),
    equipment,
    week,
    birthdays,
    atmosphere,
    modules: parts,
  };
}

export function registerScreen(
  app: FastifyInstance,
  auth: (need?: any) => any,
  bad: (reply: any, p: any) => any,
  signedIn: (req: any) => boolean,
  version: string,
) {
  const tries = new Limiter(10, 10 * 60e3);
  /** The TV's cookie, when it is one of the screens open and the screen is on. */
  const screenOf = (req: any) => {
    const t = req.cookies?.[COOKIE];
    if (!t || !screenSettings().on) return null;
    return (db.prepare('SELECT token, seen FROM screen_sessions WHERE token=?').get(tokenHash(t)) as any) ?? null;
  };
  const keep = (req: any, reply: any, token: string) =>
    reply.setCookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/screen',
      secure: req.protocol === 'https',
      maxAge: KEEP / 1000,
    });
  /** The screen itself, or someone signed in looking at it (0.60.1: Display mode in the side menu; admins only before). */
  const viewer = async (req: any, reply: any) => {
    const sc = screenOf(req);
    if (sc) {
      // seen at most every 10 minutes (Admin settings says when a screen last asked)
      if (!sc.seen || Date.now() - new Date(sc.seen).getTime() > 6e5)
        db.prepare('UPDATE screen_sessions SET seen=? WHERE token=?').run(new Date().toISOString(), sc.token);
      keep(req, reply, req.cookies[COOKIE]);
      return;
    }
    if (signedIn(req)) return;
    return reply.code(401).send({
      error: screenSettings().on ? 'type the lab screen password' : 'the lab screen is off',
      on: screenSettings().on,
    });
  };

  app.get('/api/screen', { preHandler: viewer }, async () => screenData(version));
  app.get('/api/screen/events', { preHandler: viewer }, eventStream);

  app.post('/api/screen/open', async (req: any, reply) => {
    const p = ScreenOpenIn.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'type the password' });
    const ip = ipOf(req),
      s = screenSettings();
    if (!s.on) return reply.code(403).send({ error: 'the lab screen is off: an admin turns it on in Admin settings' });
    if (tries.blocked(ip)) return reply.code(429).send({ error: 'too many attempts, try again in a few minutes' });
    if (!verify(p.data.password.normalize('NFC'), s.hash)) {
      tries.hit(ip);
      audit({ ip, action: 'Wrong lab screen password', status: 401 });
      return reply.code(401).send({ error: 'wrong password' });
    }
    tries.clear(ip);
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO screen_sessions(token, made, seen) VALUES(?,?,?)').run(
      tokenHash(token),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    keep(req, reply, token);
    audit({ ip, action: 'Opened the lab screen' });
    return { ok: true };
  });

  // ---- Admin settings › Display mode ----
  const out = () => {
    const s = screenSettings();
    const open = db.prepare('SELECT COUNT(*) AS n, MAX(seen) AS seen FROM screen_sessions').get() as {
      n: number;
      seen: string | null;
    };
    return {
      on: s.on,
      hasPassword: !!s.hash,
      interval: s.interval,
      theme: s.theme,
      limits: s.limits,
      atmoSwitch: s.atmoSwitch,
      pages: s.pages,
      labShow: s.labShow,
      labName: s.labName,
      inst: s.inst,
      // what the choices can show: an acronym, an institution's name and logo (Lab setup)
      has: { acronym: !!lab().acronym, institution: !!lab().institution, instLogo: !!lab().instLogo, logo: hasLogo() },
      screens: s.on ? open.n : 0,
      seen: s.on ? open.seen : null,
      gloveboxes: db
        .prepare('SELECT id,name,color FROM equipment WHERE active=1 AND atmosphere=1 ORDER BY pos, id')
        .all(),
    };
  };
  app.get('/api/screen/settings', { preHandler: auth(true) }, async () => out());
  app.put('/api/screen/settings', { preHandler: auth(true) }, async (req: any, reply) => {
    const p = ScreenIn.safeParse(req.body);
    if (!p.success) return bad(reply, p);
    const s = screenSettings(),
      d = p.data;
    if (d.password !== undefined) {
      const pw = d.password.normalize('NFC'),
        problem = passwordProblem(pw) || weakPassword(pw);
      if (problem) return reply.code(400).send({ error: problem });
      s.hash = hash(pw);
      closeAll(); // the TVs type the new one
    }
    if (d.on !== undefined) {
      if (d.on && !s.hash) return reply.code(400).send({ error: 'set a password first' });
      if (!d.on) closeAll();
      s.on = d.on;
    }
    if (d.interval !== undefined) s.interval = d.interval;
    if (d.theme !== undefined) s.theme = d.theme;
    if (d.atmoSwitch !== undefined) s.atmoSwitch = d.atmoSwitch;
    if (d.pages !== undefined) s.pages = [...new Set(d.pages)].sort() as (1 | 2 | 3)[];
    if (d.labShow !== undefined) s.labShow = d.labShow;
    if (d.labName !== undefined) s.labName = d.labName;
    if (d.inst !== undefined) s.inst = d.inst;
    if (d.limits) {
      const lim = { ...s.limits };
      for (const [id, v] of Object.entries(d.limits))
        if (v.o2 === null && v.h2o === null) delete lim[id];
        else lim[id] = v;
      s.limits = lim;
    }
    save(s);
    return out();
  });
  /** Signs every TV out (a screen moved, or one left somewhere it should not be). */
  app.post('/api/screen/close', { preHandler: auth(true) }, async () => {
    closeAll();
    return out();
  });
}
