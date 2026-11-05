import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, openSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { UpdateSettingsIn } from '@psc/schema';
import { db } from './db.js';
import { ROOT, readConfig, writeConfig } from './config.js';
import { backupNow } from './backup.js';

/**
 * Updates from the GitHub repository. A release is made on GitHub by the release workflow; it carries perovskite-lab.zip and its
 * SHA-256. Once a day the app asks GitHub for the latest release; when it is newer, admins get a notification. In Admin settings ›
 * Updates an admin downloads it (checked against its SHA-256) and installs it: the app backs up the database, stops, and the
 * update script replaces the program files (never the data) and starts it again.
 * The repository is private, so the app needs a read-only GitHub token (fine-grained, this repository, Contents: read). It is kept
 * in config/update.json on this computer, never in the database, backups or the repository.
 */
type Settings = { repo: string; token?: string };
type Release = { version: string; tag: string; name: string; notes: string; published: string; url: string; zip?: { id: number; size: number }; sha?: { id: number } };
type State = { checkedAt?: string; latest?: Release; error?: string; downloaded?: { version: string; file: string }; notified?: string };

const API = process.env.UPDATE_API || 'https://api.github.com';
const DIR = process.env.UPDATES_DIR || join(ROOT, 'updates');
const settings = (): Settings => ({ repo: process.env.UPDATE_REPO || 'halogenrich/panoptica', ...readConfig<Partial<Settings>>('update.json', {}) } as Settings);
const getState = (): State => JSON.parse((db.prepare("SELECT value FROM meta WHERE key='update_state'").get() as { value: string } | undefined)?.value ?? '{}');
const putState = (s: State) => db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('update_state',?)").run(JSON.stringify(s));

/** 0.26.1 > 0.26.0 > 0.25.3; a "v" in front is ignored. */
export const newer = (a: string, b: string) => {
  const p = (v: string) => v.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

async function gh(path: string, accept = 'application/vnd.github+json') {
  const s = settings();
  const r = await fetch(`${API}${path}`, { headers: { accept, 'user-agent': 'perovskite-lab-updater', 'x-github-api-version': '2022-11-28', ...(s.token ? { authorization: `Bearer ${s.token}` } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!s.token && [401, 403, 404].includes(r.status)) throw new Error('the repository is private: add a GitHub token below');
  if (r.status === 404) throw new Error('no release found, or the token cannot read this repository');
  if (r.status === 401 || r.status === 403) throw new Error('GitHub refused the token (expired, or without access to this repository)');
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  return r;
}

export async function checkNow(current: string, notify = true): Promise<State> {
  const s = settings(), st = getState();
  try {
    const j = await (await gh(`/repos/${s.repo}/releases/latest`)).json() as any;
    const asset = (n: string) => (j.assets ?? []).find((a: any) => a.name === n);
    const latest: Release = { version: String(j.tag_name).replace(/^v/, ''), tag: j.tag_name, name: j.name || j.tag_name, notes: j.body ?? '', published: j.published_at, url: j.html_url,
      zip: asset('perovskite-lab.zip') && { id: asset('perovskite-lab.zip').id, size: asset('perovskite-lab.zip').size }, sha: asset('perovskite-lab.zip.sha256') && { id: asset('perovskite-lab.zip.sha256').id } };
    const fresh = notify && newer(latest.version, current) && st.notified !== latest.version;
    putState({ ...st, checkedAt: new Date().toISOString(), latest, error: undefined, ...(fresh ? { notified: latest.version } : {}) });
    if (fresh) { // tell the admins once per version
      const ins = db.prepare("INSERT INTO notifications(user_id,kind,text,link,actor) VALUES(?,'update',?,?,'')");
      for (const a of db.prepare("SELECT id FROM users WHERE role='admin' AND active=1 AND deleted=0").all() as { id: number }[])
        ins.run(a.id, `Version ${latest.version} of the app is available. Install it from Admin settings › Updates.`, JSON.stringify({ view: 'users', id: 0 }));
    }
  } catch (e) { putState({ ...st, checkedAt: new Date().toISOString(), error: (e as Error).message }); }
  return getState();
}

async function download(): Promise<State> {
  const s = settings(), st = getState(), rel = st.latest;
  if (!rel?.zip || !rel.sha) throw new Error('this release has no perovskite-lab.zip with its checksum');
  const sum = (await (await gh(`/repos/${s.repo}/releases/assets/${rel.sha.id}`, 'application/octet-stream')).text()).trim().split(/\s+/)[0].toLowerCase();
  const zip = Buffer.from(await (await gh(`/repos/${s.repo}/releases/assets/${rel.zip.id}`, 'application/octet-stream')).arrayBuffer());
  const got = createHash('sha256').update(zip).digest('hex');
  if (!/^[0-9a-f]{64}$/.test(sum) || got !== sum) throw new Error('the downloaded file does not match its checksum; nothing was installed');
  mkdirSync(DIR, { recursive: true });
  for (const f of readdirSync(DIR)) if (/^perovskite-lab-.*\.zip$/.test(f)) try { unlinkSync(join(DIR, f)); } catch { /* in use */ }
  const file = join(DIR, `perovskite-lab-${rel.version}.zip`);
  writeFileSync(file, zip);
  putState({ ...st, downloaded: { version: rel.version, file } });
  return getState();
}

/** Starts the update script in its own window/process and stops this server, so the script can replace the files and restart it. */
function install(lan: boolean) {
  const st = getState(), f = st.downloaded?.file;
  if (!f || !existsSync(f)) throw new Error('download the update first');
  writeFileSync(join(DIR, 'restarting'), new Date().toISOString()); // the start script's window closes instead of waiting for a key
  const args = [f, 'restart', ...(lan ? ['lan'] : [])], env = { ...process.env, PSC_ROOT: ROOT, OPEN_BROWSER: '0' };
  // the script replaces itself during the update, so a copy runs (a script edited while it runs can misbehave)
  const script = process.platform === 'win32' ? 'update.bat' : process.platform === 'darwin' ? 'update.command' : 'update.sh', run = join(DIR, 'run-' + script);
  copyFileSync(join(ROOT, script), run);
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', '"Perovskite Lab update"', `"${run}"`, ...args.map((a) => `"${a}"`)], { cwd: ROOT, env, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  } else {
    const log = openSync(join(DIR, 'update.log'), 'a');
    // under systemd the updater must run outside the service, or stopping the service would stop it too
    const [cmd, a] = process.env.INVOCATION_ID ? ['systemd-run', ['--user', '--collect', `--setenv=PSC_ROOT=${ROOT}`, 'bash', run, ...args]] : ['bash', [run, ...args]];
    spawn(cmd, a as string[], { cwd: ROOT, env, detached: true, stdio: ['ignore', log, log] }).unref();
  }
  setTimeout(() => process.exit(0), 800);
}

export function registerUpdates(app: FastifyInstance, auth: (need?: any) => any, current: string) {
  const view = () => {
    const s = settings(), st = getState();
    return { current, repo: s.repo, tokenSet: !!s.token, ...st, available: !!st.latest && newer(st.latest.version, current), canInstall: ['win32', 'linux', 'darwin'].includes(process.platform) };
  };
  app.get('/api/updates', { preHandler: auth(true) }, async () => view());
  app.post('/api/updates/check', { preHandler: auth(true) }, async () => { await checkNow(current); return view(); });
  app.put('/api/updates/settings', { preHandler: auth(true) }, async (req: any, reply) => {
    const p = UpdateSettingsIn.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0].message });
    const s = settings();
    writeConfig('update.json', { repo: p.data.repo || s.repo, ...(p.data.token === undefined ? (s.token ? { token: s.token } : {}) : p.data.token ? { token: p.data.token.trim() } : {}) });
    await checkNow(current, false);
    return view();
  });
  app.post('/api/updates/download', { preHandler: auth(true) }, async (_req, reply) => {
    try { await download(); return view(); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  app.post('/api/updates/install', { preHandler: auth(true) }, async (_req, reply) => {
    try {
      await backupNow('update'); // before anything changes; the script makes another one with the app stopped
      install(['0.0.0.0', '::'].includes(process.env.HOST || ''));
      return { ok: true };
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  // daily check, the first a minute after start
  setTimeout(() => checkNow(current), 60_000).unref();
  setInterval(() => checkNow(current), 864e5).unref();
}
