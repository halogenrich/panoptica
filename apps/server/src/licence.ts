import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { db } from './db.js';
import { CONFIG_DIR, ROOT } from './config.js';
import { signedByPanoptica } from './signature.js';

/**
 * The licence (0.46): a file PANOPTICA signs for one lab (tools/builder.mjs), with the lab's name and id, the modules it bought,
 * the date it was issued and the date updates end. It is tied to the lab, not to the computer: it is kept in the database, so a
 * backup restored on another computer keeps it.
 *
 * What it changes, and what it never does:
 * - Only the modules it lists start (a package may hold more); a change of modules applies at the next start.
 * - Releases published after `updatesUntil` are not offered or installed. The app itself keeps working, with all its data and
 *   exports: a lab is never locked out of its data.
 * - It may carry the hash of a one-time setup code, so the first setup can be done from another computer (lab.ts).
 * Without a licence the app works as before (every module in the package; updates as configured).
 *
 * File: {"body": "<the licence as JSON text>", "sig": "<PANOPTICA's Ed25519 signature of body, base64>"}. The body is signed
 * as text, so its bytes are checked exactly as PANOPTICA wrote them.
 */
export type Licence = {
  v: 1;
  /** this licence (L-yymmdd-xxxx), to tell versions apart */
  id: string;
  lab: string;
  /** the lab, across its licences: a new licence must be for the same lab */
  labId: string;
  modules: string[];
  /** yyyy-mm-dd */
  issued: string;
  /** when the builder made it (ISO time): orders two licences issued the same day */
  made?: string;
  /** yyyy-mm-dd: the last day a release may be published to be installed */
  updatesUntil: string;
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
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (
    l?.v !== 1 ||
    !l.id ||
    !l.lab ||
    !l.labId ||
    !Array.isArray(l.modules) ||
    !day.test(l.issued) ||
    !day.test(l.updatesUntil)
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

/** A release published on this date may be installed under the licence (always, without one). */
export const updatesCover = (published: string) => {
  const l = licence();
  return !l || published.slice(0, 10) <= l.updatesUntil;
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
  const view = () => {
    const l = licence();
    return {
      licence: l && { ...l, setup: undefined },
      labId: meta('lab_id') ?? null,
      /** the modules running, and those in the package the licence does not list (they did not start) */
      running: running(),
      skipped: skipped(),
      names: names(),
      today: new Date().toISOString().slice(0, 10),
    };
  };
  app.get('/api/licence', { preHandler: auth(true) }, async () => view());
  app.post('/api/licence', { preHandler: auth(true), bodyLimit: 64 * 1024 }, async (req: any, reply) => {
    // the file's text as it is ({text}), or its contents already read as JSON
    const r = installLicence(typeof req.body?.text === 'string' ? req.body.text : JSON.stringify(req.body));
    if (!r.ok) return reply.code(r.code).send({ error: r.error });
    return view();
  });
}
