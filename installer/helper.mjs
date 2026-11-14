// The installer's helper (0.47): PANOPTICA Setup (installer/panoptica.iss) runs it with the Node it carries. Bundled with its
// one library (fflate, for zip files) into build/helper.cjs; it needs nothing installed on the computer.
//
//   node helper.cjs check   --key K --service URL --dir D --out result.ini
//      what the key covers (the lab, modules, last day of updates, computers) and whether this computer may use it; keeps
//      nothing at PANOPTICA. Writes result.ini ([result] ok=1, lab=…, or error=…) for the wizard's pages.
//   node helper.cjs install --key K --service URL --dir D --lan 1|0 [--task 0]
//      activates this computer with the key, downloads the key's package (checked against its SHA-256 and PANOPTICA's
//      signature), puts it in D\panoptica (an existing install keeps its data: the database is backed up first and only program
//      files are replaced), leaves the licence, key and install id for the app, and on Windows starts PANOPTICA as a task that
//      runs at startup as the system (port 3000; a firewall rule when the lab network may open it). Writes progress to
//      D\panoptica\updates\install.log.
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';

const [cmd, ...args] = process.argv.slice(2),
  opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const service = (opt('--service') ?? '').trim().replace(/\/$/, ''),
  key = (opt('--key') ?? '').trim().toUpperCase(),
  dir = opt('--dir') ?? 'C:\\PANOPTICA',
  root = join(dir, 'panoptica'),
  win = process.platform === 'win32',
  TASK = 'PANOPTICA',
  PORT = 3000;
const here = dirname(process.argv[1]);

/** PANOPTICA's public key: release.pub next to this helper (tests give their own with PANOPTICA_TEST and a key file). */
const pub = () =>
  createPublicKey(
    readFileSync(
      process.env.PANOPTICA_TEST === '1' && process.env.UPDATE_PUBLIC_KEY_FILE
        ? process.env.UPDATE_PUBLIC_KEY_FILE
        : join(here, 'release.pub'),
      'utf8',
    ),
  );
const installId = () => {
  try {
    return JSON.parse(readFileSync(join(root, 'config/install.json'), 'utf8')).id;
  } catch {
    return (globalThis.__id ??= randomUUID());
  }
};
async function post(path, body) {
  const r = await fetch(service + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'panoptica-setup' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `the activation service answered ${r.status}`);
  return j;
}
async function file(version, name, id) {
  const r = await fetch(`${service}/v1/files/${version}/${encodeURIComponent(name)}`, {
    headers: { 'x-key': key, 'x-install': id, 'user-agent': 'panoptica-setup' },
    signal: AbortSignal.timeout(900_000),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `the activation service answered ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
const ini = (o) =>
  '[result]\r\n' +
  Object.entries(o)
    .map(([k, v]) => `${k}=${String(v).replace(/[\r\n]+/g, ' ')}`)
    .join('\r\n') +
  '\r\n';
const dmy = (d) => d.split('-').reverse().join('/');
let logFile = '';
const log = (m) => {
  console.log(m);
  if (logFile)
    try {
      appendFileSync(logFile, `[${new Date().toISOString()}] setup: ${m}\n`);
    } catch {}
};
const ps = (script) =>
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { stdio: 'pipe' })
    .toString()
    .trim();
const up = async () => {
  try {
    return (await fetch(`http://127.0.0.1:${PORT}/api/version`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check() {
  const out = opt('--out');
  try {
    if (!key) throw new Error('type the product key');
    if (!service) throw new Error('the activation service’s address is missing');
    const id = installId();
    const j = await post('/v1/check', { key, install: id });
    if (!j.room)
      throw new Error(
        `this product key is in use on ${j.installs.used} computer${j.installs.used === 1 ? '' : 's'}, its limit: contact PANOPTICA to move it to this one`,
      );
    if (!j.latest) throw new Error('PANOPTICA has no release for this key yet: contact PANOPTICA');
    writeFileSync(
      out,
      ini({
        ok: 1,
        lab: j.lab,
        modules: j.modules.join(', ') || 'the core alone',
        updates: dmy(j.updatesUntil),
        computers: `${j.installs.used} of ${j.installs.limit} in use`,
        version: j.latest.version,
        size: Math.round(j.latest.package.size / 1048576) + ' MB',
        upgrade: existsSync(join(root, 'apps/server/dist/server.mjs')) ? 1 : 0,
      }),
    );
  } catch (e) {
    writeFileSync(out, ini({ ok: 0, error: e.message.replace(/^./, (c) => c.toUpperCase()) + '.' }));
  }
}

/** Copies the new program files over the old ones: never the data, the backups, the settings or the updates folder. */
function place(src) {
  const keep = new Set(['backups', 'config', 'updates', 'node_modules']),
    keepFile = /^data\.db(-wal|-shm)?$/;
  const walk = (from, to) => {
    mkdirSync(to, { recursive: true });
    for (const f of readdirSync(from)) {
      const a = join(from, f),
        b = join(to, f);
      if (statSync(a).isDirectory()) {
        if (from === src && keep.has(f)) continue;
        walk(a, b);
      } else if (!keepFile.test(f)) copyFileSync(a, b);
    }
  };
  // the built folders are replaced whole, so files a release removed go too
  for (const d of ['apps/web/dist', 'apps/server/dist']) rmSync(join(root, d), { recursive: true, force: true });
  walk(src, root);
}

async function install() {
  mkdirSync(join(root, 'updates'), { recursive: true });
  logFile = join(root, 'updates', 'install.log');
  const id = installId(),
    lan = opt('--lan') !== '0';
  log(`Installing in ${root} (computer ${hostname()}, install ${id})`);
  const j = await post('/v1/activate', { key, install: id, name: hostname() });
  log(`Activated: ${j.lab}; ${j.modules.join(', ') || 'the core alone'}; updates until ${j.updatesUntil}`);
  const rel = j.latest;
  if (!rel) throw new Error('PANOPTICA has no release for this key yet');
  log(`Downloading ${rel.package.name} ${rel.version} (${Math.round(rel.package.size / 1048576)} MB)`);
  const zip = await file(rel.version, rel.package.name, id),
    sig = (await file(rel.version, rel.package.name + '.sig', id)).toString('utf8').trim();
  if (createHash('sha256').update(zip).digest('hex') !== rel.package.sha256)
    throw new Error('the download is damaged (its SHA-256 does not match): run the installer again');
  if (!verify(null, zip, pub(), Buffer.from(sig, 'base64')))
    throw new Error('the package is not signed by PANOPTICA: nothing was installed');
  log('Checked: SHA-256 and PANOPTICA’s signature');

  // an existing install: stopped, its database backed up; its data stays
  const existing = existsSync(join(root, 'apps/server/dist/server.mjs'));
  if (existing) {
    if (win)
      try {
        ps(`Stop-ScheduledTask -TaskName '${TASK}' -ErrorAction SilentlyContinue`);
      } catch {}
    for (let i = 0; i < 60 && (await up()); i++) await sleep(1000);
    for (const f of ['apps/server/data.db', 'data.db']) {
      const db = join(root, f);
      if (existsSync(db)) {
        mkdirSync(join(root, 'backups'), { recursive: true });
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
        copyFileSync(db, join(root, 'backups', `data-${stamp}-installer.db`));
        log('Database backed up');
      }
    }
  }
  const tmp = join(tmpdir(), 'panoptica-setup-' + process.pid);
  rmSync(tmp, { recursive: true, force: true });
  for (const [name, data] of Object.entries(unzipSync(new Uint8Array(zip)))) {
    if (name.endsWith('/')) continue;
    const f = join(tmp, name);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, data);
  }
  const src = join(tmp, 'panoptica');
  if (!existsSync(join(src, 'apps/server/dist/server.mjs'))) throw new Error('this package is not a PANOPTICA package');
  place(src);
  rmSync(tmp, { recursive: true, force: true });
  log(`${existing ? 'Updated' : 'Installed'} PANOPTICA ${rel.version}`);

  // what the app reads at start: its licence, the key and this computer's id (config/ is this computer's, not the backups')
  writeFileSync(join(root, 'licence.json'), j.licence);
  mkdirSync(join(root, 'config'), { recursive: true });
  const upd = join(root, 'config/update.json');
  let old = {};
  try {
    old = JSON.parse(readFileSync(upd, 'utf8'));
  } catch {}
  writeFileSync(upd, JSON.stringify({ ...old, service, key }, null, 2));
  writeFileSync(join(root, 'config/install.json'), JSON.stringify({ id }, null, 2));

  if (!win || opt('--task') === '0') return log('Done (start it with the start script)');
  // how the task starts it: the Node this installer carries, the lab network or not, and the task's name, so an update the app
  // installs restarts it through the task
  const test =
    process.env.PANOPTICA_TEST === '1'
      ? `set PANOPTICA_TEST=1\r\nset "UPDATE_PUBLIC_KEY_FILE=${process.env.UPDATE_PUBLIC_KEY_FILE ?? ''}"\r\n`
      : '';
  writeFileSync(
    join(root, 'run.cmd'),
    `@echo off\r\nrem Started by the PANOPTICA task at startup (made by the installer; it rewrites this file)\r\ncd /d "%~dp0"\r\nset "PATH=${join(dir, 'node')};%PATH%"\r\nset PORT=${PORT}\r\nset HOST=${lan ? '0.0.0.0' : '127.0.0.1'}\r\nset OPEN_BROWSER=0\r\nset PANOPTICA_TASK=${TASK}\r\n${test}if not exist updates mkdir updates\r\ncd apps\\server\r\nnode --no-warnings dist\\server.mjs >> ..\\..\\updates\\server.log 2>&1\r\n`,
  );
  ps(
    [
      `$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c ""${join(root, 'run.cmd')}""' -WorkingDirectory '${root}'`,
      `$t = New-ScheduledTaskTrigger -AtStartup`,
      `$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest`,
      `$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable`,
      `Register-ScheduledTask -TaskName '${TASK}' -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null`,
    ].join('; '),
  );
  log('Task PANOPTICA registered: it starts PANOPTICA when the computer starts');
  try {
    execFileSync('netsh', ['advfirewall', 'firewall', 'delete', 'rule', `name=${TASK}`], { stdio: 'ignore' });
  } catch {}
  if (lan) {
    execFileSync('netsh', [
      'advfirewall',
      'firewall',
      'add',
      'rule',
      `name=${TASK}`,
      'dir=in',
      'action=allow',
      'protocol=TCP',
      `localport=${PORT}`,
    ]);
    log(`Firewall: the lab network may open port ${PORT}`);
  }
  ps(`Start-ScheduledTask -TaskName '${TASK}'`);
  for (let i = 0; i < 90; i++) {
    if (await up()) return log(`PANOPTICA is running: http://localhost:${PORT}`);
    await sleep(1000);
  }
  throw new Error(`PANOPTICA did not start within 90 s: look at ${join(root, 'updates', 'server.log')}`);
}

(async () => {
  try {
    if (cmd === 'check') await check();
    else if (cmd === 'install') await install();
    else throw new Error('commands: check, install');
  } catch (e) {
    log('Failed: ' + e.message);
    if (opt('--out')) writeFileSync(opt('--out'), ini({ ok: 0, error: e.message }));
    process.exit(1);
  }
})();
