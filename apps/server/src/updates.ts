import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { UpdateSettingsIn } from '@psc/schema';
import { db } from './db.js';
import { ROOT, readConfig, writeConfig } from './config.js';
import { backupNow } from './backup.js';
import { signedByPanoptica } from './signature.js';
import { licence, setupInstall } from './licence.js';
import { modules, skippedModules } from './modules.js';

/**
 * Updates from the GitHub repository. A release is made on GitHub by the release workflow; it carries panoptica.zip (the app
 * built, with no source code), its SHA-256 and PANOPTICA's signature of it. Once a day the app asks GitHub for the latest
 * release; when it is newer, admins get a notification. In Admin settings › Updates an admin downloads it (checked against its
 * SHA-256, and installed only when the signature is PANOPTICA's) and installs it: the app backs up the database, stops, and
 * the update script replaces the program files (never the data) and starts it again.
 * A public repository needs no token. A private one needs a read-only GitHub token (fine-grained, this repository, Contents:
 * read), kept in config/update.json on this computer, never in the database, backups or the repository.
 * 0.46: a release carries one package per combination of modules (panoptica-devices.zip; panoptica-core.zip has none); the
 * app takes the one for the modules its licence lists (else those it has), and falls back to panoptica.zip (every module).
 * 0.49: updates are free for every licensed lab (no last day of updates), and come from GitHub only: the product keys and the
 * activation service of 0.47 are gone. The repository is one default (DEFAULT_REPO); when the shipped releases move to a public
 * repository, that default changes and lab servers need no token.
 */
/** Where releases come from, unless config/update.json or UPDATE_REPO (tests) says otherwise. */
export const DEFAULT_REPO = 'halogenrich/panoptica';
type Settings = { repo: string; token?: string };
type Release = {
  version: string;
  tag: string;
  name: string;
  notes: string;
  published: string;
  url: string;
  zip?: { id: number; size: number; name: string };
  sha?: { id: number };
  sig?: { id: number };
};
type State = {
  checkedAt?: string;
  latest?: Release;
  error?: string;
  downloaded?: { version: string; file: string };
  notified?: string;
};

const API = process.env.UPDATE_API || 'https://api.github.com';
const DIR = process.env.UPDATES_DIR || join(ROOT, 'updates');
const settings = (): Settings =>
  ({
    repo: process.env.UPDATE_REPO || DEFAULT_REPO,
    ...readConfig<Partial<Settings>>('update.json', {}),
  }) as Settings;
const getState = (): State =>
  JSON.parse(
    (db.prepare("SELECT value FROM meta WHERE key='update_state'").get() as { value: string } | undefined)?.value ??
      '{}',
  );
const putState = (s: State) =>
  db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('update_state',?)").run(JSON.stringify(s));

/** 0.26.1 > 0.26.0 > 0.25.3; a "v" in front is ignored. */
export const newer = (a: string, b: string) => {
  const p = (v: string) =>
    v
      .replace(/^v/, '')
      .split(/[.-]/)
      .map((x) => parseInt(x, 10) || 0);
  const x = p(a),
    y = p(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

async function gh(path: string, accept = 'application/vnd.github+json') {
  const s = settings();
  const r = await fetch(`${API}${path}`, {
    headers: {
      accept,
      'user-agent': 'panoptica-updater',
      'x-github-api-version': '2022-11-28',
      ...(s.token ? { authorization: `Bearer ${s.token}` } : {}),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
  });
  if (!s.token && [401, 403, 404].includes(r.status))
    throw new Error('GitHub refused the request: if the repository is private, add a read-only token below');
  if (r.status === 404) throw new Error('no release found, or the token cannot read this repository');
  if (r.status === 401 || r.status === 403)
    throw new Error('GitHub refused the token (expired, or without access to this repository)');
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  return r;
}

/** The package this lab installs: panoptica-<its modules, sorted, joined by +>.zip, or panoptica-core.zip with none. */
export const packageName = (mods: string[]) => `panoptica-${[...mods].sort().join('+') || 'core'}.zip`;
const wanted = () => licence()?.modules ?? [...modules().map((m) => m.id), ...skippedModules()];

export async function checkNow(current: string, notify = true): Promise<State> {
  const s = settings(),
    st = getState();
  try {
    const j = (await (await gh(`/repos/${s.repo}/releases/latest`)).json()) as any;
    // this lab's package; else every module in one (releases before 0.46, and the fallback); else the name before 0.36
    const names: string[] = (j.assets ?? []).map((a: any) => a.name),
      zipName = [packageName(wanted()), 'panoptica.zip', 'perovskite-lab.zip'].find((n) => names.includes(n)),
      asset = (n: string) => (j.assets ?? []).find((a: any) => a.name === n);
    const latest: Release = {
      version: String(j.tag_name).replace(/^v/, ''),
      tag: j.tag_name,
      name: j.name || j.tag_name,
      notes: j.body ?? '',
      published: j.published_at,
      url: j.html_url,
      zip: zipName ? { id: asset(zipName).id, size: asset(zipName).size, name: zipName } : undefined,
      sha: zipName && asset(zipName + '.sha256') ? { id: asset(zipName + '.sha256').id } : undefined,
      sig: zipName && asset(zipName + '.sig') ? { id: asset(zipName + '.sig').id } : undefined,
    };
    remember(st, latest, current, notify);
  } catch (e) {
    putState({ ...st, checkedAt: new Date().toISOString(), error: (e as Error).message });
  }
  return getState();
}

/** Keeps what the check found and tells the admins, once per version, when it is newer. */
function remember(st: State, latest: Release | undefined, current: string, notify: boolean) {
  {
    const fresh = !!latest && notify && newer(latest.version, current) && st.notified !== latest.version;
    putState({
      ...st,
      checkedAt: new Date().toISOString(),
      latest,
      error: undefined,
      ...(fresh ? { notified: latest!.version } : {}),
    });
    if (fresh) {
      // tell the admins once per version
      const ins = db.prepare("INSERT INTO notifications(user_id,kind,text,link,actor) VALUES(?,'update',?,?,'')");
      for (const a of db.prepare("SELECT id FROM users WHERE role='admin' AND active=1 AND deleted=0").all() as {
        id: number;
      }[])
        ins.run(
          a.id,
          `Version ${latest!.version} of the app is available. Install it from Admin settings › Updates.`,
          JSON.stringify({ view: 'users', id: 0 }),
        );
    }
  }
}

async function download(): Promise<State> {
  const s = settings(),
    st = getState(),
    rel = st.latest;
  if (!rel?.zip || !rel.sha) throw new Error('this release has no panoptica.zip with its checksum');
  const sum = (await (await gh(`/repos/${s.repo}/releases/assets/${rel.sha.id}`, 'application/octet-stream')).text())
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();
  const zip = Buffer.from(
    await (await gh(`/repos/${s.repo}/releases/assets/${rel.zip.id}`, 'application/octet-stream')).arrayBuffer(),
  );
  const got = createHash('sha256').update(zip).digest('hex');
  if (!/^[0-9a-f]{64}$/.test(sum) || got !== sum)
    throw new Error('the downloaded file does not match its checksum; nothing was installed');
  // the checksum catches a damaged download; the signature says who made the package
  if (!rel.sig) throw new Error('this release is not signed by PANOPTICA; nothing was installed');
  const sig = await (await gh(`/repos/${s.repo}/releases/assets/${rel.sig.id}`, 'application/octet-stream')).text();
  if (!signedByPanoptica(zip, sig))
    throw new Error('the signature of this release is not PANOPTICA’s; nothing was installed');
  mkdirSync(DIR, { recursive: true });
  for (const f of readdirSync(DIR))
    if (/^(panoptica|perovskite-lab)-.*\.zip(\.sig)?$/.test(f))
      try {
        unlinkSync(join(DIR, f));
      } catch {
        /* in use */
      }
  const file = join(DIR, `panoptica-${rel.version}.zip`);
  writeFileSync(file, zip);
  writeFileSync(file + '.sig', sig.trim() + '\n'); // the update script checks it again before replacing anything
  putState({ ...st, downloaded: { version: rel.version, file } });
  return getState();
}

/** Starts the update script in its own window/process and stops this server, so the script can replace the files and restart it. */
function install(lan: boolean) {
  const st = getState(),
    f = st.downloaded?.file;
  if (!f || !existsSync(f)) throw new Error('download the update first');
  writeFileSync(join(DIR, 'restarting'), new Date().toISOString()); // the start script's window closes instead of waiting for a key
  const args = [f, 'restart', ...(lan ? ['lan'] : [])],
    env = { ...process.env, PSC_ROOT: ROOT, OPEN_BROWSER: '0' };
  // the script replaces itself during the update, so a copy runs (a script edited while it runs can misbehave). An install made by
  // PANOPTICA Setup (0.49) has no scripts to run by hand: the update script is kept in internal/, for the app alone
  const script =
      process.platform === 'win32' ? 'update.bat' : process.platform === 'darwin' ? 'update.command' : 'update.sh',
    run = join(DIR, 'run-' + script),
    from = [join(ROOT, 'internal', script), join(ROOT, script)].find((f) => existsSync(f));
  if (!from) throw new Error('the update script is missing: run PANOPTICA Setup again');
  copyFileSync(from, run);
  const note = (m: string) => {
    try {
      appendFileSync(join(DIR, 'update.log'), `[${new Date().toISOString()}] app: ${m}\n`);
    } catch {
      /* the log is a help, not a requirement */
    }
  };
  if (process.platform === 'win32' && process.env.PANOPTICA_TASK) {
    // installed by PANOPTICA Setup (0.47): the app runs as a startup task with no window. The update runs as a task of its own,
    // so it outlives this one; a small script gives it what this process knows (Node's folder, the task to start again)
    const wrap = join(DIR, 'run-update.cmd'),
      keep = [
        'PATH',
        'PANOPTICA_TASK',
        'PANOPTICA_TEST',
        'UPDATE_PUBLIC_KEY_FILE',
        'UPDATE_API',
        'UPDATE_REPO',
        'PORT',
        'HOST',
      ];
    writeFileSync(
      wrap,
      [
        '@echo off',
        ...keep.filter((k) => process.env[k]).map((k) => `set "${k}=${process.env[k]}"`),
        `set "PSC_ROOT=${ROOT}"`,
        'set OPEN_BROWSER=0',
        `call "${run}" ${args.map((a) => `"${a}"`).join(' ')} >> "${join(DIR, 'update.log')}" 2>&1`,
        '',
      ].join('\r\n'),
    );
    const name = process.env.PANOPTICA_TASK + ' update';
    note(`starting the task "${name}"`);
    try {
      execFileSync(
        'schtasks',
        ['/create', '/f', '/tn', name, '/sc', 'once', '/st', '00:00', '/ru', 'SYSTEM', '/tr', `cmd.exe /c "${wrap}"`],
        {
          stdio: 'ignore',
        },
      );
      execFileSync('schtasks', ['/run', '/tn', name], { stdio: 'ignore' });
    } catch (e) {
      note(`could not start the update task: ${(e as Error).message}`);
      throw new Error('the update could not be started: see update.log');
    }
  } else if (process.platform === 'win32') {
    // `start` opens the window; the inner `cmd /c ""script" "args""` is the only form that runs a batch file with quoted
    // arguments from a path with spaces (found by trying the forms on Windows in CI; the update itself is tested there by tools/update-e2e.mjs). The earlier form
    // `start "title" "script.bat" args` silently did nothing, which is why the in-app update did not install on Windows.
    const line = [
      '/c',
      'start',
      '"PANOPTICA update"',
      'cmd',
      '/c',
      `""${run}" ${args.map((a) => `"${a}"`).join(' ')}"`,
    ];
    note(`starting cmd.exe ${line.join(' ')}`);
    const child = spawn('cmd.exe', line, {
      cwd: ROOT,
      env,
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true,
    });
    child.on('error', (e) => note(`could not start the update window: ${e.message}`));
    child.on('exit', (code) => note(`update window launcher exited with ${code}`));
    child.unref();
  } else {
    const log = openSync(join(DIR, 'update.log'), 'a');
    // installed by PANOPTICA Setup on a Mac (0.48), launchd runs the app: the script runs in its own session, outlives this
    // process (the daemon abandons its process group) and starts the daemon again (PANOPTICA_LAUNCHD names it)
    // under systemd the updater must run outside the service, or stopping the service would stop it too
    // (a unit starts with a clean environment: it is given the app folder, the log to write to, and a test's signing key)
    const pass = ['PANOPTICA_TEST', 'UPDATE_PUBLIC_KEY'].flatMap((k) =>
      process.env[k] ? [`--setenv=${k}=${process.env[k]}`] : [],
    );
    const [cmd, a] = process.env.INVOCATION_ID
      ? [
          'systemd-run',
          [
            '--user',
            '--collect',
            `--setenv=PSC_ROOT=${ROOT}`,
            `--setenv=PSC_LOG=${join(DIR, 'update.log')}`,
            ...pass,
            'bash',
            '-c',
            'exec bash "$0" "$@" >>"$PSC_LOG" 2>&1',
            run,
            ...args,
          ],
        ]
      : ['bash', [run, ...args]];
    spawn(cmd, a as string[], { cwd: ROOT, env, detached: true, stdio: ['ignore', log, log] }).unref();
  }
  setTimeout(() => process.exit(0), 800);
}

export function registerUpdates(app: FastifyInstance, auth: (need?: any) => any, current: string) {
  /** The end of updates/update.log: what the last update did, step by step (written by the app and the update script). */
  const lastLog = () => {
    try {
      return readFileSync(join(DIR, 'update.log'), 'utf8').trim().split(/\r?\n/).slice(-40).join('\n');
    } catch {
      return '';
    }
  };
  const view = () => {
    const s = settings(),
      st = getState();
    return {
      current,
      repo: s.repo,
      tokenSet: !!s.token,
      defaultRepo: DEFAULT_REPO,
      ...st,
      available: !!st.latest && newer(st.latest.version, current),
      /** 0.49: an install made by PANOPTICA Setup has no update script to run by hand */
      byHand: !setupInstall(),
      canInstall: ['win32', 'linux', 'darwin'].includes(process.platform),
      log: lastLog(),
    };
  };
  app.get('/api/updates', { preHandler: auth(true) }, async () => view());
  app.post('/api/updates/check', { preHandler: auth(true) }, async () => {
    await checkNow(current);
    return view();
  });
  app.put('/api/updates/settings', { preHandler: auth(true) }, async (req: any, reply) => {
    const p = UpdateSettingsIn.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0].message });
    const s = settings(),
      saved = readConfig<Partial<Settings>>('update.json', {}),
      // only a repository other than the default is kept, so a change of the default (DEFAULT_REPO) reaches every lab
      repo = p.data.repo ?? saved.repo;
    writeConfig('update.json', {
      ...(repo && repo !== DEFAULT_REPO ? { repo } : {}),
      ...(p.data.token === undefined
        ? s.token
          ? { token: s.token }
          : {}
        : p.data.token
          ? { token: p.data.token.trim() }
          : {}),
    });
    await checkNow(current, false);
    return view();
  });
  app.post('/api/updates/download', { preHandler: auth(true) }, async (_req, reply) => {
    try {
      await download();
      return view();
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
  app.post('/api/updates/install', { preHandler: auth(true) }, async (_req, reply) => {
    try {
      await backupNow('update'); // before anything changes; the script makes another one with the app stopped
      install(['0.0.0.0', '::'].includes(process.env.HOST || ''));
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
  // daily check, the first a minute after start
  setTimeout(() => checkNow(current), 60_000).unref();
  setInterval(() => checkNow(current), 864e5).unref();
}
