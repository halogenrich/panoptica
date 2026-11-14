// The installer's helper (0.47): PANOPTICA Setup runs it with the Node it carries (installer/panoptica.iss on Windows, and since
// 0.48 installer/mac on macOS). Bundled with its one library (fflate, for zip files) into build/helper.cjs; it needs nothing
// installed on the computer.
//
//   node helper.cjs check   --key K --service URL --dir D --out result.ini
//      what the key covers (the lab, modules, last day of updates, computers) and whether this computer may use it; keeps
//      nothing at PANOPTICA. Writes result.ini ([result] ok=1, lab=…, or error=…) for the wizard's pages.
//   node helper.cjs install --key K --service URL --dir D --lan 1|0 [--task 0]
//      activates this computer with the key, downloads the key's package (checked against its SHA-256 and PANOPTICA's
//      signature), puts it in D\panoptica (an existing install keeps its data: the database is backed up first and only program
//      files are replaced), leaves the licence, key and install id for the app, and starts PANOPTICA in the background whenever
//      the computer starts (port 3000): on Windows as a task run by the system, with a firewall rule when the lab network may
//      open it; on macOS as a launchd daemon (com.panoptica.server), with Node allowed through the firewall. Writes progress
//      to D/panoptica/updates/install.log.
//   node helper.cjs uninstall --dir D      (macOS) stops the daemon and removes it; the lab's data stays
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
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
  win = process.platform === 'win32',
  mac = process.platform === 'darwin',
  dir = opt('--dir') ?? (win ? 'C:\\PANOPTICA' : '/Library/PANOPTICA'),
  root = join(dir, 'panoptica'),
  TASK = 'PANOPTICA',
  LABEL = 'com.panoptica.server',
  PLIST = `/Library/LaunchDaemons/${LABEL}.plist`,
  FIREWALL = '/usr/libexec/ApplicationFirewall/socketfilterfw',
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
// on macOS only the system can read the app's folder once it runs (its daemon's umask), so the wizard, which checks the key as
// the person, reads this computer's id from a copy next to it
const ids = () => [join(root, 'config/install.json'), join(dir, 'install.json')];
const installId = () => {
  for (const f of ids())
    try {
      return JSON.parse(readFileSync(f, 'utf8')).id;
    } catch {}
  return (globalThis.__id ??= randomUUID());
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
const quiet = (c, a) => {
  try {
    execFileSync(c, a, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const xml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sh = (t) => `'${t.replace(/'/g, `'\\''`)}'`;

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
        upgrade: [join(root, 'apps/server/dist/server.mjs'), ...ids()].some(existsSync) ? 1 : 0,
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
    if (mac) quiet('launchctl', ['bootout', `system/${LABEL}`]);
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
  // zip files carry no permissions: the scripts are made runnable again
  if (!win) for (const f of readdirSync(root)) if (/\.(sh|command)$/.test(f)) chmodSync(join(root, f), 0o755);
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
  if (mac) writeFileSync(join(dir, 'install.json'), JSON.stringify({ id }, null, 2), { mode: 0o644 });

  if (opt('--task') === '0' || !(win || mac)) return log('Done (start it with the start script)');
  if (mac) return daemon(lan);
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

/** The test's signing key, passed on to the app (only with PANOPTICA_TEST). */
const testEnv = () =>
  process.env.PANOPTICA_TEST === '1'
    ? { PANOPTICA_TEST: '1', UPDATE_PUBLIC_KEY_FILE: process.env.UPDATE_PUBLIC_KEY_FILE ?? '' }
    : {};

/**
 * macOS (0.48): PANOPTICA as a launchd daemon run by the system, started with the computer and again when it stops by itself;
 * what it writes (the database, backups, logs) only the system can read.
 * When it exits on purpose (to install an update, which then starts it again with `launchctl kickstart`) launchd leaves it
 * stopped, and the update keeps running after the app is gone.
 */
async function daemon(lan) {
  const node = join(dir, 'node', 'bin');
  const env = {
    PATH: `${node}:/usr/bin:/bin:/usr/sbin:/sbin`,
    PORT: String(PORT),
    HOST: lan ? '0.0.0.0' : '127.0.0.1',
    OPEN_BROWSER: '0',
    PANOPTICA_LAUNCHD: LABEL,
    ...testEnv(),
  };
  writeFileSync(
    join(root, 'run.sh'),
    [
      '#!/bin/bash',
      '# Started by launchd when the computer starts (made by PANOPTICA Setup; it rewrites this file)',
      'cd "$(dirname "$0")" || exit 1',
      ...Object.entries(env).map(([k, v]) => `export ${k}=${sh(v)}`),
      'mkdir -p updates',
      'cd apps/server || exit 1',
      'exec node --no-warnings dist/server.mjs >> ../../updates/server.log 2>&1',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  writeFileSync(
    PLIST,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>${xml(join(root, 'run.sh'))}</string></array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>AbandonProcessGroup</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>Umask</key><integer>63</integer>
  <key>StandardErrorPath</key><string>${xml(join(root, 'updates', 'launchd.log'))}</string>
</dict>
</plist>
`,
    { mode: 0o644 },
  );
  quiet('launchctl', ['bootout', `system/${LABEL}`]);
  execFileSync('launchctl', ['bootstrap', 'system', PLIST], { stdio: 'pipe' });
  log(`Daemon ${LABEL} loaded: it starts PANOPTICA when the computer starts`);
  // the firewall asks about programs that listen to the network: Node is allowed (macOS asks nothing when it is off)
  const bin = join(node, 'node');
  if (lan && existsSync(FIREWALL)) {
    quiet(FIREWALL, ['--add', bin]);
    quiet(FIREWALL, ['--unblockapp', bin]);
    log(`Firewall: the lab network may open port ${PORT}`);
  }
  for (let i = 0; i < 90; i++) {
    if (await up()) return log(`PANOPTICA is running: http://localhost:${PORT}`);
    await sleep(1000);
  }
  throw new Error(`PANOPTICA did not start within 90 s: look at ${join(root, 'updates', 'server.log')}`);
}

/** macOS: the daemon stops and goes, and Node leaves the firewall's list; the program and the lab's data stay. */
async function uninstall() {
  if (!mac) throw new Error('on Windows, uninstall PANOPTICA from Settings › Apps');
  quiet('launchctl', ['bootout', `system/${LABEL}`]);
  rmSync(PLIST, { force: true });
  if (existsSync(FIREWALL)) quiet(FIREWALL, ['--remove', join(dir, 'node', 'bin', 'node')]);
  for (let i = 0; i < 30 && (await up()); i++) await sleep(1000);
  log(`Daemon ${LABEL} removed; the lab's data stays in ${root}`);
}

(async () => {
  try {
    if (cmd === 'check') await check();
    else if (cmd === 'install') await install();
    else if (cmd === 'uninstall') await uninstall();
    else throw new Error('commands: check, install, uninstall');
  } catch (e) {
    log('Failed: ' + e.message);
    if (opt('--out')) writeFileSync(opt('--out'), ini({ ok: 0, error: e.message }));
    process.exit(1);
  }
})();
