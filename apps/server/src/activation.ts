import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { readConfig, writeConfig } from './config.js';
import { installLicence, licence, readLicence } from './licence.js';

/**
 * The lab's product key and PANOPTICA's activation service (0.47). The installer activates this computer with the key and
 * leaves both in config/update.json (with the computer's install id in config/install.json); from then on the app asks the
 * service, with the key, for the latest release its key covers and for its current licence (a renewal, a module added). The
 * key is this computer's secret: it is never in the database, the backups or the repository; a backup restored on another
 * computer asks for it again (Admin settings › Updates), and that computer must be allowed by the key's limit.
 */
export type KeySettings = { service?: string; key?: string };

/** This computer's install id: made once, kept in config/install.json. */
export function installId(): string {
  const c = readConfig<{ id?: string }>('install.json', {});
  if (c.id) return c.id;
  const id = randomUUID();
  writeConfig('install.json', { id });
  return id;
}
export const keySettings = (): KeySettings => {
  const c = readConfig<KeySettings>('update.json', {});
  return { service: (c.service || process.env.ACTIVATION_URL || '').replace(/\/$/, '') || undefined, key: c.key };
};

async function post(service: string, path: string, body: object) {
  const r = await fetch(service + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'panoptica' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const j = (await r.json().catch(() => ({}))) as any;
  if (!r.ok) throw new Error(j.error ?? `the activation service answered ${r.status}`);
  return j;
}

/** What the key covers, as the service says: the lab, modules, last day of updates, computers. */
export type Covers = {
  lab: string;
  modules: string[];
  updatesUntil: string;
  installs: { used: number; limit: number };
};

/** Activates this computer with a product key (within the key's limit) and installs the licence it carries. */
export async function activate(service: string, key: string): Promise<Covers> {
  const j = await post(service, '/v1/activate', { key: key.trim(), install: installId(), name: hostname() });
  const r = installLicence(j.licence);
  if (!r.ok) throw new Error(r.error);
  return j;
}

/** The key's current licence, installed when it is newer than this one. Returns what changed, or ''. */
export async function refreshLicence(): Promise<string> {
  const { service, key } = keySettings();
  if (!service || !key) return '';
  const j = await post(service, '/v1/licence', { key, install: installId() });
  const got = readLicence(j.licence);
  if (!got.ok || got.licence.id === licence()?.id) return '';
  const r = installLicence(j.licence);
  if (!r.ok) throw new Error(r.error);
  return `licence ${r.licence.id} installed: ${r.licence.modules.join(', ') || 'the core alone'}, updates until ${r.licence.updatesUntil}`;
}

/** The latest release the key covers (null: none yet). */
export async function latestForKey(): Promise<{
  version: string;
  published: string;
  notes: string;
  package: { name: string; size: number; sha256: string };
  signed: boolean;
} | null> {
  const { service, key } = keySettings();
  const j = await post(service!, '/v1/latest', { key, install: installId() });
  return j.latest;
}

/** One file of the key's package from the service. */
export async function keyFile(version: string, name: string): Promise<Buffer> {
  const { service, key } = keySettings();
  const r = await fetch(`${service}/v1/files/${version}/${encodeURIComponent(name)}`, {
    headers: { 'x-key': key!, 'x-install': installId(), 'user-agent': 'panoptica' },
    signal: AbortSignal.timeout(600_000),
  });
  if (!r.ok)
    throw new Error(((await r.json().catch(() => ({}))) as any).error ?? `the activation service answered ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
