// The installer's helper (0.47; licence file and packages inside 0.49): PANOPTICA Setup runs it with the Node it carries
// (installer/panoptica.iss on Windows, installer/mac on macOS). Bundled with its one library (fflate, for zip files) into
// build/helper.cjs; it needs nothing installed on the computer, and no internet: Setup carries the packages.
//
//   node helper.cjs check   --licence F --packages P --dir D --out result.ini
//      reads the lab's licence (signed by PANOPTICA) and finds the package for its modules among the ones Setup carries
//      (P/index.json). Writes result.ini ([result] ok=1, lab=…, or error=…) for the wizard's pages.
//   node helper.cjs install --licence F --packages P --dir D --lan 1|0 [--task 0]
//      checks the licence and the package (SHA-256 and PANOPTICA's signature), puts it in D/panoptica (an existing install keeps
//      its data: the database is backed up first and only program files are replaced), leaves the licence for the app and marks
//      the install as made by Setup (config/install.json), and starts PANOPTICA in the background whenever the computer starts
//      (port 3000): on Windows as a task run by the system, with a firewall rule when the lab network may open it; on macOS as a
//      launchd daemon (com.panoptica.server), with Node allowed through the firewall. The install folder is the administrators'
//      and the system's only. No script to run by hand is left in it (0.49): the app keeps its update script in internal/, and
//      reset-password stays, for administrators, to recover a lost admin password. Progress goes to
//      D/panoptica/updates/install.log.
//   node helper.cjs uninstall --dir D      (macOS) stops the daemon and removes it; the lab's data stays
import { createHash, createPublicKey, verify } from 'node:crypto';
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
const win = process.platform === 'win32',
  mac = process.platform === 'darwin',
  dir = opt('--dir') ?? (win ? 'C:\\PANOPTICA' : '/Library/PANOPTICA'),
  root = join(dir, 'panoptica'),
  TASK = 'PANOPTICA',
  LABEL = 'com.panoptica.server',
  PLIST = `/Library/LaunchDaemons/${LABEL}.plist`,
  FIREWALL = '/usr/libexec/ApplicationFirewall/socketfilterfw',
  PORT = 3000;
const here = dirname(process.argv[1]);
/** Scripts a manual install runs by hand; an install made by Setup has none (0.49). */
const HAND_RUN = /^(start|start-network|update|version|restore)\.(bat|command|sh)$|^install-shortcut\.sh$/;

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
const signed = (data, sig) => {
  try {
    return verify(null, data, pub(), Buffer.from(String(sig).trim(), 'base64'));
  } catch {
    return false;
  }
};
const ini = (o) =>
  '[result]\r\n' +
  Object.entries(o)
    .map(([k, v]) => `${k}=${String(v).replace(/[\r\n]+/g, ' ')}`)
    .join('\r\n') +
  '\r\n';
// the names the app gives its modules (modules/<id>/server: name)
const MODULES = { devices: 'Electronic Devices' },
  names = (ids) => ids.map((m) => MODULES[m] ?? m).join(', ');
const packageName = (mods) => `panoptica-${[...mods].sort().join('+') || 'core'}.zip`;
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

/** The licence file the lab was given: its text and what it says, when PANOPTICA signed it. */
function readLicence() {
  const f = opt('--licence');
  if (!f) throw new Error('choose the licence file PANOPTICA gave the lab');
  let text, file, l;
  try {
    text = readFileSync(f, 'utf8');
    file = JSON.parse(text);
  } catch {
    throw new Error('this is not a licence file');
  }
  if (typeof file?.body !== 'string' || typeof file?.sig !== 'string') throw new Error('this is not a licence file');
  if (!signed(Buffer.from(file.body, 'utf8'), file.sig))
    throw new Error('this licence is not signed by PANOPTICA, or it was changed');
  try {
    l = JSON.parse(file.body);
  } catch {
    throw new Error('this licence cannot be read');
  }
  if (l?.v !== 1 || !l.lab || !l.labId || !Array.isArray(l.modules))
    throw new Error('this licence is from a newer version of PANOPTICA, or incomplete');
  return { text, l };
}
/** The packages this Setup carries (index.json, written when Setup was built), and the one for the licence's modules. */
function packageFor(l) {
  const dirP = opt('--packages') ?? join(here, 'packages');
  let index;
  try {
    index = JSON.parse(readFileSync(join(dirP, 'index.json'), 'utf8'));
  } catch {
    throw new Error('this PANOPTICA Setup carries no packages: download it again');
  }
  const name = packageName(l.modules),
    p = index.files?.[name];
  if (!p)
    throw new Error(
      `this PANOPTICA Setup has no package for ${names(l.modules) || 'the core alone'}: use a newer Setup, or contact PANOPTICA`,
    );
  return { dir: dirP, version: index.version, name, ...p };
}
const tierText = (l) =>
  l.users ? `Tier ${l.tier ?? ''}: up to ${l.users} people`.replace('Tier : ', '') : 'No limit on people';

async function check() {
  const out = opt('--out');
  try {
    const { l } = readLicence(),
      p = packageFor(l);
    writeFileSync(
      out,
      ini({
        ok: 1,
        lab: l.lab,
        acronym: l.acronym ?? '',
        modules: names(l.modules) || 'the core alone',
        tier: tierText(l),
        version: p.version,
        size: Math.round(p.size / 1048576) + ' MB',
        // the app's folder itself may be closed to the person running the wizard (macOS): that it exists is enough
        upgrade: existsSync(root) ? 1 : 0,
      }),
    );
  } catch (e) {
    writeFileSync(out, ini({ ok: 0, error: e.message.replace(/^./, (c) => c.toUpperCase()) + '.' }));
  }
}

/**
 * Copies the new program files over the old ones: never the data, the backups, the settings or the updates folder. The scripts a
 * manual install runs by hand are left out (and removed from an older install); the update script goes to internal/, where only
 * the app runs it (0.49).
 */
function place(src) {
  const keep = new Set(['backups', 'config', 'updates', 'node_modules']),
    keepFile = /^data\.db(-wal|-shm)?$/,
    update = win ? 'update.bat' : 'update.command';
  const walk = (from, to) => {
    mkdirSync(to, { recursive: true });
    for (const f of readdirSync(from)) {
      const a = join(from, f),
        b = join(to, f);
      if (statSync(a).isDirectory()) {
        if (from === src && keep.has(f)) continue;
        walk(a, b);
      } else if (!keepFile.test(f) && !(from === src && HAND_RUN.test(f))) copyFileSync(a, b);
    }
  };
  // the built folders are replaced whole, so files a release removed go too
  for (const d of ['apps/web/dist', 'apps/server/dist']) rmSync(join(root, d), { recursive: true, force: true });
  walk(src, root);
  mkdirSync(join(root, 'internal'), { recursive: true });
  copyFileSync(join(src, update), join(root, 'internal', update));
  if (existsSync(root)) for (const f of readdirSync(root)) if (HAND_RUN.test(f)) rmSync(join(root, f), { force: true });
}

/** Windows: the install folder belongs to the administrators and the system alone (by their SIDs: names change with the language). */
function lockDown() {
  execFileSync('icacls', [dir, '/inheritance:r', '/grant:r', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F', '/Q'], {
    stdio: 'pipe',
  });
  // what is inside takes the folder's permissions again
  execFileSync('icacls', [join(dir, '*'), '/reset', '/T', '/C', '/Q'], { stdio: 'pipe' });
  log('Install folder: administrators and the system only');
}

async function install() {
  mkdirSync(join(root, 'updates'), { recursive: true });
  logFile = join(root, 'updates', 'install.log');
  const lan = opt('--lan') !== '0';
  log(`Installing in ${root} (computer ${hostname()})`);
  const { text, l } = readLicence(),
    p = packageFor(l);
  log(
    `Licence ${l.id}: ${l.lab}${l.acronym ? ` (${l.acronym})` : ''}; ${names(l.modules) || 'the core alone'}; ${tierText(l)}`,
  );
  const zip = readFileSync(join(p.dir, p.name)),
    sig = readFileSync(join(p.dir, p.name + '.sig'), 'utf8').trim();
  if (createHash('sha256').update(zip).digest('hex') !== p.sha256)
    throw new Error('the package in this Setup is damaged (its SHA-256 does not match): download Setup again');
  if (!signed(zip, sig)) throw new Error('the package is not signed by PANOPTICA: nothing was installed');
  log(`Checked ${p.name} ${p.version}: SHA-256 and PANOPTICA’s signature`);

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
  // zip files carry no permissions: the scripts left are made runnable again
  if (!win) {
    for (const f of readdirSync(root)) if (/\.(sh|command)$/.test(f)) chmodSync(join(root, f), 0o755);
    chmodSync(join(root, 'internal', 'update.command'), 0o755);
  }
  log(`${existing ? 'Updated' : 'Installed'} PANOPTICA ${p.version}`);

  // what the app reads at start: its licence, and that Setup made this install, so it needs its licence (config/ is this
  // computer's, not the backups'). The product key of 0.47–0.48 is gone from the settings.
  writeFileSync(join(root, 'licence.json'), text);
  mkdirSync(join(root, 'config'), { recursive: true });
  const upd = join(root, 'config/update.json');
  try {
    const { key: _k, service: _s, ...rest } = JSON.parse(readFileSync(upd, 'utf8'));
    writeFileSync(upd, JSON.stringify(rest, null, 2));
  } catch {}
  writeFileSync(
    join(root, 'config/install.json'),
    JSON.stringify({ by: 'setup', version: p.version, at: new Date().toISOString() }, null, 2),
  );
  rmSync(join(dir, 'install.json'), { force: true }); // the copy 0.48 kept for its wizard
  if (win) lockDown();
  // macOS: the app's folder is the system's alone (what the daemon writes already is, by its umask)
  if (mac) chmodSync(root, 0o700);

  if (opt('--task') === '0' || !(win || mac)) return log('Done (start it with the start script)');
  if (mac) return daemon(lan);
  // how the task starts it: the Node this installer carries, the lab network or not, and the task's name, so an update the app
  // installs restarts it through the task
  const test = Object.entries(testEnv())
    .map(([k, v]) => `set "${k}=${v}"\r\n`)
    .join('');
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

/** The test's signing key and its fake release source, passed on to the app (only with PANOPTICA_TEST). */
function testEnv() {
  if (process.env.PANOPTICA_TEST !== '1') return {};
  const e = { PANOPTICA_TEST: '1', UPDATE_PUBLIC_KEY_FILE: process.env.UPDATE_PUBLIC_KEY_FILE ?? '' };
  for (const k of ['UPDATE_API', 'UPDATE_REPO']) if (process.env[k]) e[k] = process.env[k];
  return e;
}

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
