// PANOPTICA Setup from end to end, on Windows (0.47) as an administrator (GitHub's Windows machines are), and on macOS (0.48)
// with sudo needing no password (as on GitHub's Macs):
//   node tools/installer-e2e.mjs <PANOPTICA-Setup.exe | PANOPTICA-Setup.dmg> <package folder> <newer package folder, 99.0.0>
// A throwaway activation service and signing key; Setup run silently with a product key; PANOPTICA running in the background
// (the startup task; the launchd daemon); the first setup on this computer; an update from the service, installed by the app and
// restarted through the task or the daemon; on macOS Setup run again over it (the data stays); the uninstaller removing the
// task or the daemon and keeping the data. On macOS, with SHOTS=<folder>, the wizard's first pages are opened and screenshotted
// (the key checked against the service) before the silent install.
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const [setup, pkgDir, newDir] = process.argv.slice(2);
const mac = process.platform === 'darwin',
  root = fileURLToPath(new URL('..', import.meta.url)),
  tmp = mkdtempSync(join(tmpdir(), 'psc-setup-')),
  DIR = mac ? '/Library/PANOPTICA' : 'C:\\PANOPTICA-E2E',
  base = 'http://127.0.0.1:3000',
  LABEL = 'com.panoptica.server';
let failed = 0;
const ok = (c, m) => {
  console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`);
  if (!c) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const version = async () => {
  try {
    return (await (await fetch(base + '/api/version', { signal: AbortSignal.timeout(3000) })).json()).version;
  } catch {
    return null;
  }
};
// on macOS the app's files are the system's alone (its daemon's umask)
const show = (f) => {
  try {
    const t = mac ? execFileSync('sudo', ['cat', f]).toString() : existsSync(f) ? readFileSync(f, 'utf8') : '';
    if (t) console.log(`----- ${f}\n` + t.split(/\r?\n/).slice(-40).join('\n'));
  } catch {}
};
const running = () =>
  mac
    ? spawnSync('sudo', ['launchctl', 'print', `system/${LABEL}`], { stdio: 'ignore' }).status === 0
    : spawnSync('schtasks', ['/query', '/tn', 'PANOPTICA']).status === 0;

const k = generateKeyPairSync('ed25519');
writeFileSync(join(tmp, 'key.pem'), k.privateKey.export({ type: 'pkcs8', format: 'pem' }));
writeFileSync(join(tmp, 'pub.pem'), k.publicKey.export({ type: 'spki', format: 'pem' }));
const test = { PANOPTICA_TEST: '1', UPDATE_PUBLIC_KEY_FILE: join(tmp, 'pub.pem') };
const release = (from, v) => {
  const files = {},
    walk = (d) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else files['panoptica/' + relative(from, p).split('\\').join('/')] = readFileSync(p);
      }
    };
  walk(from);
  const dir = join(tmp, 'rel-' + v);
  mkdirSync(dir);
  const zip = Buffer.from(zipSync(files, { level: 1 }));
  writeFileSync(join(dir, 'panoptica-devices.zip'), zip);
  writeFileSync(join(dir, 'panoptica-devices.zip.sig'), sign(null, zip, k.privateKey).toString('base64') + '\n');
  return dir;
};
const svc = spawn(process.execPath, [join(root, 'services/activation/server.mjs')], {
  env: {
    ...process.env,
    ADMIN_TOKEN: 'e2e-admin-token-' + 'x'.repeat(24),
    ACTIVATION_DATA: join(tmp, 'svc'),
    PORT: '4799',
  },
  stdio: 'inherit',
});
const staff = (...a) =>
  execFileSync(
    process.execPath,
    [
      join(root, 'tools/builder/keys.mjs'),
      ...a,
      '--service',
      'http://127.0.0.1:4799',
      '--token',
      'e2e-admin-token-' + 'x'.repeat(24),
    ],
    { cwd: root },
  ).toString();
/** macOS: the disk image opened; Setup's script run as root with the key (what the wizard does after the password). */
let mount = '';
const macSetup = (key) =>
  spawnSync(
    'sudo',
    [
      'env',
      ...Object.entries(test).map(([k, v]) => `${k}=${v}`),
      join(mount, 'PANOPTICA Setup.app/Contents/Resources/setup.sh'),
      '--key',
      key,
      '--service',
      'http://127.0.0.1:4799',
      '--lan',
      '0',
    ],
    { stdio: 'inherit' },
  );
/** macOS: the wizard's pages up to the review of the key, screenshotted (System Events types and presses Return). */
async function shots(key) {
  const dir = process.env.SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const app = join(mount, 'PANOPTICA Setup.app'),
    osa = (s) => spawnSync('osascript', ['-e', s], { encoding: 'utf8' }),
    // the wizard's window alone, also printed into the log (a small JPEG in base64) for whoever cannot download artifacts
    shot = (n) => {
      const b = osa(
        'tell application "System Events" to tell window 1 of process "PANOPTICA Setup" to get {position, size}',
      ).stdout.match(/\d+/g);
      const png = join(dir, n + '.png'),
        jpg = join(dir, n + '.jpg');
      spawnSync('screencapture', ['-x', '-o', ...(b?.length === 4 ? ['-R', b.join(',')] : []), png]);
      spawnSync('sips', [
        '-s',
        'format',
        'jpeg',
        '-s',
        'formatOptions',
        '70',
        '--resampleWidth',
        '1000',
        png,
        '--out',
        jpg,
      ]);
      if (existsSync(jpg)) {
        const t = readFileSync(jpg).toString('base64');
        console.log(`SHOT ${n} BEGIN`);
        for (let i = 0; i < t.length; i += 4000) console.log(t.slice(i, i + 4000));
        console.log(`SHOT ${n} END`);
      }
    };
  spawnSync('open', ['-n', app]);
  await sleep(6000);
  osa('tell application "PANOPTICA Setup" to activate');
  await sleep(1000);
  shot('1-intro');
  osa('tell application "System Events" to keystroke return');
  await sleep(1500);
  shot('2-key');
  osa(`tell application "System Events" to keystroke "${key}"`);
  await sleep(500);
  osa('tell application "System Events" to keystroke return');
  await sleep(8000);
  shot('3-review');
  osa('tell application "System Events" to keystroke tab');
  const r = osa('tell application "System Events" to get name of every window of process "PANOPTICA Setup"');
  console.log(`  info the wizard's windows: ${(r.stdout || r.stderr).trim()}`);
  osa('tell application "PANOPTICA Setup" to quit');
  await sleep(1000);
  spawnSync('pkill', ['-f', 'PANOPTICA Setup.app']);
}

try {
  console.log(`PANOPTICA Setup on ${mac ? 'macOS (0.48)' : 'Windows (0.47)'}`);
  await sleep(1500);
  const v0 = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
  staff('publish', v0, '--from', release(pkgDir, v0));
  const key = staff(
    'new',
    '--lab',
    mac ? 'Mac Lab' : 'Windows Lab',
    '--modules',
    'devices',
    '--updates-until',
    '2100-12-31',
    '--installs',
    '1',
    '--key',
    join(tmp, 'key.pem'),
    '--pub',
    join(tmp, 'pub.pem'),
    '--out',
    join(tmp, 'cards'),
  ).match(/^key (\S+)/)[1];
  if (mac) {
    mount = join(tmp, 'dmg');
    mkdirSync(mount);
    execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, setup], { stdio: 'inherit' });
    await shots(key);
  }
  const r = mac
    ? macSetup(key)
    : spawnSync(
        setup,
        [
          '/VERYSILENT',
          '/SUPPRESSMSGBOXES',
          '/NORESTART',
          `/DIR=${DIR}`,
          `/KEY=${key}`,
          '/SERVICE=http://127.0.0.1:4799',
          '/LAN=0',
          `/LOG=${join(tmp, 'setup.log')}`,
        ],
        { env: { ...process.env, ...test }, stdio: 'inherit' },
      );
  ok(r.status === 0, 'Setup ran silently with the product key');
  let v = null;
  for (let i = 0; i < 60 && !(v = await version()); i++) await sleep(1000);
  ok(v === v0, `PANOPTICA ${v0} is running`);
  ok(running(), mac ? `as the launchd daemon ${LABEL}` : 'as the PANOPTICA task, which starts with the computer');
  // the first setup on this computer (no code needed here)
  const s = await fetch(base + '/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      admin: {
        firstNames: 'Grace',
        surnames: 'Hopper',
        surname: 'Hopper',
        email: mac ? 'grace@mac.example' : 'grace@win.example',
        birthDate: '1990-12-09',
        password: 'Windows-lab-2026!',
      },
      lab: {
        name: mac ? 'Mac Lab' : 'Windows Lab',
        institution: '',
        domains: [],
        departments: [],
        hours: Array.from({ length: 7 }, (_, i) => ({ on: i < 5, from: '08:00', to: '18:00' })),
      },
    }),
  });
  ok(s.status === 200, 'the first setup');
  const cookie = s.headers.get('set-cookie')?.split(';')[0] ?? '',
    call = async (m, p) => {
      const x = await fetch(base + p, { method: m, headers: { cookie } });
      return { s: x.status, j: await x.json().catch(() => null) };
    };
  ok(
    (await call('GET', '/api/licence')).j?.licence?.lab === (mac ? 'Mac Lab' : 'Windows Lab'),
    'with the key’s licence',
  );
  // an update from the service, installed by the app: the task starts it again
  staff('publish', '99.0.0', '--from', release(newDir, '99.0.0'));
  ok(
    (await call('POST', '/api/updates/check')).j?.latest?.version === '99.0.0',
    'the app finds the newer release with its key',
  );
  ok((await call('POST', '/api/updates/download')).s === 200, 'downloads and checks it');
  ok((await call('POST', '/api/updates/install')).s === 200, 'and installs it');
  v = null;
  for (let i = 0; i < 240 && (v = await version()) !== '99.0.0'; i++) await sleep(1000);
  ok(v === '99.0.0', `the update restarted PANOPTICA through its ${mac ? 'daemon' : 'task'}`);
  if (mac) {
    // Setup again over it: the program is replaced, the lab stays (same computer, so the key's one install is still this one)
    ok(macSetup(key).status === 0, 'Setup ran again over the installed PANOPTICA');
    for (let i = 0; i < 60 && (v = await version()) !== '99.0.0'; i++) await sleep(1000);
    ok(v === '99.0.0' && (await call('GET', '/api/me')).s === 200, 'PANOPTICA runs again, with the lab and its admin');
  }
  // the uninstaller: the task or the daemon goes, the data stays
  const un = mac
    ? spawnSync('sudo', [join(DIR, 'Uninstall PANOPTICA.command')], { stdio: 'inherit' })
    : spawnSync(join(DIR, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
        stdio: 'inherit',
      });
  await sleep(5000);
  ok(un.status === 0 && !running(), `uninstalled: the ${mac ? 'daemon' : 'task'} is gone`);
  ok(!(await version()), 'PANOPTICA stopped');
  const db = join(DIR, 'panoptica/apps/server/data.db');
  ok(mac ? spawnSync('sudo', ['test', '-f', db]).status === 0 : existsSync(db), 'the lab’s data stays');
} catch (e) {
  console.log('  FAIL ' + (e.stack ?? e));
  failed++;
}
if (failed)
  for (const f of [
    join(tmp, 'setup.log'),
    join(DIR, 'panoptica/updates/install.log'),
    join(DIR, 'panoptica/updates/server.log'),
    join(DIR, 'panoptica/updates/update.log'),
    join(DIR, 'panoptica/updates/launchd.log'),
  ])
    show(f);
if (mount) spawnSync('hdiutil', ['detach', mount, '-force'], { stdio: 'ignore' });
svc.kill();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
