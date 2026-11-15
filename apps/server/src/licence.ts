import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { db } from './db.js';
import { CONFIG_DIR, ROOT, hasConfig } from './config.js';
import { signedByPanoptica } from './signature.js';
import { isLocal } from './security.js';

/**
 * The licence (0.46): a file PANOPTICA signs for one lab (tools/builder/builder.mjs), with the lab's names and id, the modules it
 * bought and, since 0.49, its tier: how many active people it covers. It is tied to the lab, not to the computer: it is kept in
 * the database, so a backup restored on another computer keeps it.
 *
 * What it changes, and what it never does:
 * - Only the modules it lists start (a package may hold more); a change of modules applies at the next start.
 * - At its number of people, accepting an access request, adding a visitor and enabling an account are refused (0.49). Everyone
 *   who has an account keeps working, with all their data: a lab is never locked out of its data.
 * - It may carry the hash of a one-time setup code, so the first setup can be done from another computer (lab.ts).
 * - Updates are free (0.49): a licence no longer has a last day of updates; older licences that carry one are read and it is
 *   ignored.
 * An install made by PANOPTICA Setup (config/install.json, 0.49) needs its licence: missing or not valid, it is a critical file
 * missing, and no one new can be let in until it is installed again. A manual install (developers) works without one, as before.
 * The lab names in the licence are PANOPTICA's record of who bought it; the names the lab shows are its own (lab.ts) and are not
 * compared with them.
 *
 * File: {"body": "<the licence as JSON text>", "sig": "<PANOPTICA's Ed25519 signature of body, base64>"}. The body is signed
 * as text, so its bytes are checked exactly as PANOPTICA wrote them.
 */
export type Licence = {
  v: 1;
  /** this licence (L-yymmdd-xxxx), to tell versions apart */
  id: string;
  /** the lab's full name */
  lab: string;
  /** the lab's acronym (0.49) */
  acronym?: string;
  /** the lab, across its licences: a new licence must be for the same lab */
  labId: string;
  modules: string[];
  /** yyyy-mm-dd */
  issued: string;
  /** when the builder made it (ISO time): orders two licences issued the same day */
  made?: string;
  /** 0.49: 1 (up to 10 people), 2 (up to 50), 3 (more, a number agreed with the lab) */
  tier?: 1 | 2 | 3;
  /** 0.49: how many active people the licence covers; none, no limit (licences made before 0.49) */
  users?: number;
  /** SHA-256 (hex) of the one-time setup code, when the builder made one */
  setup?: string;
};
export type LicenceFile = { body: string; sig: string };

/** The licence in a file's text, when PANOPTICA signed it; else why not. */
export function readLicence(
  text: string,
): { ok: true; licence: Licence; file: LicenceFile } | { ok: false; error: string } {
  let f: LicenceFile;
  try {
    f = JSON.parse(text);
  } catch {
    return { ok: false, error: 'this is not a licence file' };
  }
  if (typeof f?.body !== 'string' || typeof f?.sig !== 'string')
    return { ok: false, error: 'this is not a licence file' };
  if (!signedByPanoptica(Buffer.from(f.body, 'utf8'), f.sig))
    return { ok: false, error: 'this licence is not signed by PANOPTICA' };
  let l: Licence;
  try {
    l = JSON.parse(f.body);
  } catch {
    return { ok: false, error: 'this licence cannot be read' };
  }
  if (
    l?.v !== 1 ||
    !l.id ||
    !l.lab ||
    !l.labId ||
    !Array.isArray(l.modules) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(l.issued) ||
    (l.tier !== undefined && ![1, 2, 3].includes(l.tier)) ||
    (l.users !== undefined && !(Number.isInteger(l.users) && l.users > 0))
  )
    return { ok: false, error: 'this licence is from a newer version of PANOPTICA, or incomplete' };
  return { ok: true, licence: l, file: { body: f.body, sig: f.sig } };
}

const meta = (k: string) =>
  (db.prepare('SELECT value FROM meta WHERE key=?').get(k) as { value: string } | undefined)?.value;
const setMeta = (k: string, v: string) => db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run(k, v);

/** The installed licence, or null (none installed, or the one kept no longer verifies). */
export function licence(): Licence | null {
  const t = meta('licence');
  if (!t) return null;
  const r = readLicence(t);
  return r.ok ? r.licence : null;
}

/**
 * Installed by PANOPTICA Setup: the installer leaves config/install.json (the update scripts look for the same file). Such an
 * install needs its licence (0.49).
 */
export const setupInstall = () => hasConfig('install.json');

/**
 * Whether the licence is there: 'ok', 'none' (never installed) or 'invalid' (one is kept but no longer verifies: changed, or
 * signed with another key). `critical` when this install needs one and does not have it (0.49).
 */
export function licenceState() {
  const t = meta('licence');
  const state: 'ok' | 'none' | 'invalid' = !t ? 'none' : readLicence(t).ok ? 'ok' : 'invalid';
  return { state, critical: setupInstall() && state !== 'ok' };
}

/** People with an account that works today: not disabled, not gone, not a visitor whose visit ended. Requests do not count. */
export const activeUsers = () =>
  (
    db
      .prepare(
        'SELECT COUNT(*) AS n FROM users WHERE active=1 AND deleted=0 AND (visitor_until IS NULL OR visitor_until>=?)',
      )
      .get(new Date().toISOString().slice(0, 10)) as { n: number }
  ).n;

/**
 * Why one more person cannot be let in (accepting a request, adding a visitor, enabling an account), or '' when they can. This is
 * the only limit the licence enforces; it never stops anyone who already has an account.
 */
export function noRoom(): string {
  const st = licenceState();
  if (st.critical)
    return st.state === 'none'
      ? 'PANOPTICA’s licence file is missing. Install it in Admin settings › Licence, or contact PANOPTICA for a copy'
      : 'PANOPTICA’s licence file is not valid. Install it again in Admin settings › Licence, or contact PANOPTICA for a copy';
  const n = licence()?.users;
  if (n && activeUsers() >= n)
    return `Your licence covers ${n} ${n === 1 ? 'person' : 'people'}. Contact PANOPTICA to upgrade`;
  return '';
}

/**
 * Installs a licence: it must be PANOPTICA's, for this lab (the lab id the first licence gave), and not older than the one
 * installed. Returns the licence, or why it was refused.
 */
export function installLicence(
  text: string,
): { ok: true; licence: Licence } | { ok: false; error: string; code: number } {
  const r = readLicence(text);
  if (!r.ok) return { ...r, code: 400 };
  const l = r.licence,
    lab = meta('lab_id'),
    cur = licence();
  if (lab && lab !== l.labId)
    return {
      ok: false,
      code: 409,
      error: `this licence is for another lab (${l.lab}); this one is ${cur?.lab ?? 'licensed to another lab id'}`,
    };
  const older = cur && cur.id !== l.id && (cur.made && l.made ? l.made < cur.made : l.issued < cur.issued);
  if (older) return { ok: false, code: 409, error: `a newer licence is installed (issued ${cur!.issued})` };
  setMeta('licence', JSON.stringify(r.file));
  if (!lab) setMeta('lab_id', l.labId);
  return { ok: true, licence: l };
}

/**
 * At start: a licence.json the installer left in the config folder or next to the app (where the package was unzipped) is
 * installed when it is new. Returns a line for the log, or ''.
 */
export function licenceAtStart(): string {
  for (const f of [join(CONFIG_DIR, 'licence.json'), join(ROOT, 'licence.json')]) {
    if (!existsSync(f)) continue;
    const text = readFileSync(f, 'utf8'),
      found = readLicence(text);
    if (found.ok && found.licence.id === licence()?.id) continue; // installed already
    const r = installLicence(text);
    return r.ok
      ? `Licence ${r.licence.id} installed for ${r.licence.lab}`
      : `Licence in ${f} not installed: ${r.error}`;
  }
  return '';
}

/** The modules that may start: those in the package, and of those only the licensed ones when there is a licence. */
export const licensed = (id: string) => {
  const l = licence();
  return !l || l.modules.includes(id);
};

/** The one-time setup code given matches the licence's. Codes are read without spaces, dashes or case. */
export const setupCodeOk = (code: string) => {
  const h = licence()?.setup;
  if (!h || !code) return false;
  const norm = code.replace(/[\s-]/g, '').toUpperCase();
  return createHash('sha256').update(norm).digest('hex') === h;
};
export const hasSetupCode = () => !!licence()?.setup;

export function registerLicence(
  app: FastifyInstance,
  auth: (need?: any) => any,
  running: () => string[],
  skipped: () => string[],
  names: () => Record<string, string>,
) {
  const view = (req: any) => {
    const l = licence(),
      st = licenceState();
    return {
      licence: l && { ...l, setup: undefined, updatesUntil: undefined },
      labId: meta('lab_id') ?? null,
      /** 'ok' | 'none' | 'invalid', and whether that is a critical file missing on this install (0.49) */
      state: st.state,
      critical: st.critical,
      /** people with a working account, against the licence's number (0.49) */
      active: activeUsers(),
      full: !!l?.users && activeUsers() >= l.users,
      /** the licence file can only be chosen on the computer that runs PANOPTICA (0.49) */
      here: isLocal(req),
      /** the modules running, and those in the package the licence does not list (they did not start) */
      running: running(),
      skipped: skipped(),
      names: names(),
    };
  };
  app.get('/api/licence', { preHandler: auth(true) }, async (req) => view(req));
  app.post('/api/licence', { preHandler: auth(true), bodyLimit: 64 * 1024 }, async (req: any, reply) => {
    if (!isLocal(req))
      return reply.code(403).send({ error: 'choose the licence file on the computer that runs PANOPTICA' });
    // the file's text as it is ({text}), or its contents already read as JSON
    const r = installLicence(typeof req.body?.text === 'string' ? req.body.text : JSON.stringify(req.body));
    if (!r.ok) return reply.code(r.code).send({ error: r.error });
    return view(req);
  });
}
