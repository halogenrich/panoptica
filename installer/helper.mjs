// The installer's helper (0.47; licence file and packages inside 0.49): PANOPTICA Setup runs it with the Node it carries
// (installer/panoptica.iss, Windows; the Mac installer of 0.48 to 0.50 is gone since 0.51). Bundled with its one library
// (fflate, for zip files) into build/helper.cjs; it needs nothing installed on the computer, and no internet: Setup carries
// the packages.
//
//   node helper.cjs check   --licence F --packages P --dir D --out result.ini
//      reads the lab's licence (signed by PANOPTICA) and finds the package for its modules among the ones Setup carries
//      (P/index.json). Writes result.ini ([result] ok=1, lab=…, or error=…) for the wizard's pages.
//   node helper.cjs install --licence F --packages P --dir D [--out result.ini] [--task 0]
//      checks the licence and the package (SHA-256 and PANOPTICA's signature), puts it in D/panoptica (an existing install keeps
//      its data: the database is backed up first and only program files are replaced), leaves the licence for the app and marks
//      the install as made by Setup (config/install.json), and starts PANOPTICA in the background whenever the computer starts,
//      as a task run by the system. The install folder is the administrators' and the system's only. No script to run by hand
//      is left in it (0.49): the app keeps its update script in internal/, and reset-password stays, for administrators, to
//      recover a lost admin password. Progress goes to D/panoptica/updates/install.log; result.ini gets the address to open.
//   0.51: the runtime is also copied as node/PANOPTICA.exe with PANOPTICA's name and icon (apps/server/src/brand.ts since 0.52), and the task runs that,
//      so Task Manager shows PANOPTICA. The tray icon (D/tray) may be read and run by everyone who signs in to this computer.
//      Who can open PANOPTICA, its port and HTTPS are PANOPTICA's own settings (config/network.json, Admin settings › Network),
//      and PANOPTICA keeps the firewall rule in step with them. A new install starts open to the network on port 80, so the
//      first setup can be done from another computer with the setup code; an install from before 0.51 keeps what it had (port
//      3000; the network when its wizard's checkbox was ticked).
import { createHash, createPublicKey, verify } from 'node:crypto';
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
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { brandRuntime } from '../apps/server/src/brand.ts';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';

const [cmd, ...args] = process.argv.slice(2),
  opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const win = process.platform === 'win32',
  dir = opt('--dir') ?? 'C:\\PANOPTICA',
  root = join(dir, 'panoptica'),
  TASK = 'PANOPTICA';
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
/** Where PANOPTICA answers on this computer: what it wrote for the tray when it started, else its settings, else port 3000. */
const where = () => {
  const read = (f) => {
    try {
      return JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      return null;
    }
  };
  const s = read(join(dir, 'tray', 'server.json')) ?? read(join(root, 'config', 'network.json')) ?? {};
  return { port: s.port ?? 3000, https: !!s.https, local: s.local ?? '' };
};
/** PANOPTICA answers (its certificate is for the lab's name, not 127.0.0.1: not checked here). */
const up = () =>
  new Promise((res) => {
    const w = where(),
      q = (w.https ? httpsGet : httpGet)(
        `${w.https ? 'https' : 'http'}://127.0.0.1:${w.port}/api/version`,
        { timeout: 2000, rejectUnauthorized: false },
        (r) => {
          r.resume();
          res(r.statusCode === 200);
        },
      );
    q.on('error', () => res(false));
    q.on('timeout', () => q.destroy());
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
        // the Node this Setup carries is the one running this helper (the wizard's "What will be installed", 0.51)
        node: process.versions.node,
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
    update = 'update.bat';
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
  // the tray icon (0.51) runs for whoever signs in here: its folder may be read and run (it holds the program, PANOPTICA's
  // port and version, and the token for backups and update checks from this computer)
  if (existsSync(join(dir, 'tray')))
    execFileSync('icacls', [join(dir, 'tray'), '/grant', '*S-1-5-32-545:(OI)(CI)RX', '/Q'], { stdio: 'pipe' });
  log('Install folder: administrators and the system only; the tray icon for everyone who signs in');
}

async function install() {
  mkdirSync(join(root, 'updates'), { recursive: true });
  logFile = join(root, 'updates', 'install.log');
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
  // who can open it and on which port (0.51): PANOPTICA's own settings from now on. A new install is open to the network on
  // port 80 until its first setup decides; an older install keeps what its wizard set (port 3000)
  const net = join(root, 'config/network.json');
  if (!existsSync(net)) {
    let open = 'network';
    if (existing)
      try {
        open = /set HOST=0\.0\.0\.0/.test(readFileSync(join(root, 'run.cmd'), 'utf8')) ? 'network' : 'computer';
      } catch {}
    writeFileSync(net, JSON.stringify({ open, port: existing ? 3000 : 80 }, null, 2));
    log(`Network: ${open === 'network' ? 'open to the network' : 'this computer only'}, port ${existing ? 3000 : 80}`);
  }
  if (win) {
    // the runtime under PANOPTICA's name and icon, for Task Manager (0.51)
    const node = join(dir, 'node');
    if (existsSync(join(node, 'node.exe'))) {
      brandRuntime(join(node, 'node.exe'), join(node, 'PANOPTICA.exe'), join(here, 'panoptica.ico'), p.version);
      log('Runtime: node\\PANOPTICA.exe');
    }
    lockDown();
  }

  if (opt('--task') === '0' || !win) return log('Done (start it with the start script)');
  // how the task starts it: the Node this installer carries, the lab network or not, and the task's name, so an update the app
  // installs restarts it through the task
  const test = Object.entries(testEnv())
    .map(([k, v]) => `set "${k}=${v}"\r\n`)
    .join('');
  // the port and who can open it are in config/network.json (0.51); the runtime is PANOPTICA.exe
  writeFileSync(
    join(root, 'run.cmd'),
    `@echo off\r\nrem Started by the PANOPTICA task at startup (made by the installer; it rewrites this file)\r\ncd /d "%~dp0"\r\nset "PATH=${join(dir, 'node')};%PATH%"\r\nset OPEN_BROWSER=0\r\nset PANOPTICA_TASK=${TASK}\r\n${test}if not exist updates mkdir updates\r\ncd apps\\server\r\nPANOPTICA.exe --no-warnings dist\\server.mjs >> ..\\..\\updates\\server.log 2>&1\r\n`,
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
  // what an earlier start wrote for the tray says nothing about this one
  rmSync(join(dir, 'tray', 'server.json'), { force: true });
  ps(`Start-ScheduledTask -TaskName '${TASK}'`);
  for (let i = 0; i < 90; i++) {
    if (await up()) {
      const w = where(),
        url =
          w.local || `${w.https ? 'https' : 'http'}://localhost${w.port === (w.https ? 443 : 80) ? '' : ':' + w.port}`;
      if (opt('--out')) writeFileSync(opt('--out'), ini({ ok: 1, url }));
      return log(`PANOPTICA is running: ${url}`);
    }
    await sleep(1000);
  }
  throw new Error(`PANOPTICA did not start within 90 s: look at ${join(root, 'updates', 'server.log')}`);
}

/** The test's signing key and its fake release source, passed on to the app (only with PANOPTICA_TEST). */
function testEnv() {
  if (process.env.PANOPTICA_TEST !== '1') return {};
  const e = { PANOPTICA_TEST: '1', UPDATE_PUBLIC_KEY_FILE: process.env.UPDATE_PUBLIC_KEY_FILE ?? '' };
  for (const k of ['UPDATE_API', 'UPDATE_REPO', 'RUNTIME_WAIT']) if (process.env[k]) e[k] = process.env[k];
  return e;
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
