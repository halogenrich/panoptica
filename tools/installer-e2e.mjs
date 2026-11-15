// PANOPTICA Setup from end to end, on Windows (0.47) as an administrator (GitHub's Windows machines are), and on macOS (0.48)
// with sudo needing no password (as on GitHub's Macs). Since 0.49 Setup carries the packages and takes the lab's licence file:
//   node tools/installer-e2e.mjs prepare <package folder> <newer package folder, 99.0.0> <work folder>
//      a throwaway signing key, the packages signed with it (<work>/packages, for tools/installer-build.mjs --packages) and a
//      newer release (<work>/new)
//   node tools/installer-e2e.mjs run <PANOPTICA-Setup.exe | PANOPTICA-Setup.dmg> <work folder>
//      a licence from the builder; Setup run silently with it; PANOPTICA running in the background (the startup task; the launchd
//      daemon) with no script to run by hand and its folder closed to other users; the first setup on this computer; the
//      licence's lab and tier; an update from a fake GitHub, installed by the app and restarted through the task or the daemon;
//      on macOS Setup run again over it (the data stays); the uninstaller removing the task or the daemon and keeping the data.
//      On macOS, with SHOTS=<folder>, the wizard's first pages are opened and screenshotted before the silent install.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const [mode, ...rest] = process.argv.slice(2);
const root = fileURLToPath(new URL('..', import.meta.url));
/** A package folder zipped as a release asset, signed with the throwaway key. */
const pack = (from, to, key) => {
  const files = {},
    walk = (d) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else files['panoptica/' + relative(from, p).split('\\').join('/')] = readFileSync(p);
      }
    };
  walk(from);
  mkdirSync(to, { recursive: true });
  const zip = Buffer.from(zipSync(files, { level: 1 }));
  writeFileSync(join(to, 'panoptica-devices.zip'), zip);
  writeFileSync(join(to, 'panoptica-devices.zip.sig'), sign(null, zip, key).toString('base64') + '\n');
  writeFileSync(
    join(to, 'panoptica-devices.zip.sha256'),
    createHash('sha256').update(zip).digest('hex') + '  panoptica-devices.zip\n',
  );
};
if (mode === 'prepare') {
  const [pkgDir, newDir, work] = rest.map((x) => resolve(x));
  mkdirSync(work, { recursive: true });
  const k = generateKeyPairSync('ed25519');
  writeFileSync(join(work, 'key.pem'), k.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(join(work, 'pub.pem'), k.publicKey.export({ type: 'spki', format: 'pem' }));
  pack(pkgDir, join(work, 'packages'), k.privateKey);
  writeFileSync(join(work, 'version'), JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version);
  pack(newDir, join(work, 'new'), k.privateKey);
  console.log(`prepared ${work}: packages/ and new/, signed with a throwaway key`);
  process.exit(0);
}
if (mode !== 'run') {
  console.error('usage: installer-e2e.mjs prepare <pkg> <newer pkg> <work> | run <setup> <work>');
  process.exit(2);
}
const [setup, work] = [resolve(rest[0]), resolve(rest[1])];
const mac = process.platform === 'darwin',
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

const test = {
  PANOPTICA_TEST: '1',
  UPDATE_PUBLIC_KEY_FILE: join(work, 'pub.pem'),
  // releases from a fake GitHub (below), passed on to the app by the helper in test mode
  UPDATE_API: 'http://127.0.0.1:4799',
  UPDATE_REPO: 'lab/app',
};
// ---- a fake GitHub with one release: the newer package (work/new), its checksum and signature
const rel = join(work, 'new'),
  asset = ['panoptica-devices.zip', 'panoptica-devices.zip.sha256', 'panoptica-devices.zip.sig'];
const gh = createServer((q, r) => {
  if (q.url === '/repos/lab/app/releases/latest')
    return r.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        tag_name: 'v99.0.0',
        name: 'PANOPTICA 99.0.0',
        body: 'e2e',
        published_at: new Date().toISOString(),
        html_url: 'x',
        assets: asset.map((name, i) => ({ id: i + 1, name, size: statSync(join(rel, name)).size })),
      }),
    );
  const a = q.url.match(/\/releases\/assets\/(\d)$/);
  if (a && asset[+a[1] - 1]) return r.writeHead(200).end(readFileSync(join(rel, asset[+a[1] - 1])));
  r.writeHead(404).end('{}');
}).listen(4799, '127.0.0.1');
// ---- the lab's licence, from the builder PANOPTICA's staff use
const labName = mac ? 'Mac Laboratory of Thin Films' : 'Windows Laboratory of Thin Films',
  acronym = mac ? 'MLTF' : 'WLTF';
execFileSync(
  process.execPath,
  [
    join(root, 'tools/builder/builder.mjs'),
    '--lab',
    labName,
    '--acronym',
    acronym,
    '--modules',
    'devices',
    '--tier',
    '1',
    '--key',
    join(work, 'key.pem'),
    '--pub',
    join(work, 'pub.pem'),
    '--out',
    join(tmp, 'labs'),
  ],
  { stdio: 'inherit' },
);
const licence = join(tmp, 'labs', readdirSync(join(tmp, 'labs'))[0], 'licence.json');
/** The files in the app's folder (on macOS only the system may list it). */
const inRoot = (sub = '') => {
  const d = join(DIR, 'panoptica', sub);
  try {
    return mac ? execFileSync('sudo', ['ls', '-1', d]).toString().split('\n').filter(Boolean) : readdirSync(d);
  } catch {
    return [];
  }
};
const HAND = /^(start|start-network|update|version|restore)\.(bat|command|sh)$/;
/** macOS: the disk image opened; Setup's script run as root with the licence (what the wizard does after the password). */
let mount = '';
const macSetup = () =>
  spawnSync(
    'sudo',
    [
      'env',
      ...Object.entries(test).map(([k, v]) => `${k}=${v}`),
      join(mount, 'PANOPTICA Setup.app/Contents/Resources/setup.sh'),
      '--licence',
      licence,
      '--lan',
      '0',
    ],
    { stdio: 'inherit' },
  );
/** macOS: the wizard's pages up to the review of the licence, screenshotted (System Events presses Return). */
async function shots() {
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
  // opened with the licence already chosen (--licence), as IT can; the open panel itself is not driven
  spawnSync('open', ['-n', app, '--args', '--licence', licence]);
  await sleep(6000);
  osa('tell application "PANOPTICA Setup" to activate');
  await sleep(1000);
  shot('1-intro');
  osa('tell application "System Events" to keystroke return');
  await sleep(1500);
  shot('2-licence');
  osa('tell application "System Events" to keystroke return');
  await sleep(6000);
  shot('3-review');
  osa('tell application "PANOPTICA Setup" to quit');
  await sleep(1000);
  spawnSync('pkill', ['-f', 'PANOPTICA Setup.app']);
}

try {
  console.log(`PANOPTICA Setup on ${mac ? 'macOS' : 'Windows'} (licence file, 0.49)`);
  const v0 = readFileSync(join(work, 'version'), 'utf8').trim();
  if (mac) {
    mount = join(tmp, 'dmg');
    mkdirSync(mount);
    execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, setup], { stdio: 'inherit' });
    await shots();
  }
  const r = mac
    ? macSetup()
    : spawnSync(
        setup,
        [
          '/VERYSILENT',
          '/SUPPRESSMSGBOXES',
          '/NORESTART',
          `/DIR=${DIR}`,
          `/LICENCE=${licence}`,
          '/LAN=0',
          `/LOG=${join(tmp, 'setup.log')}`,
        ],
        { env: { ...process.env, ...test }, stdio: 'inherit' },
      );
  ok(r.status === 0, 'Setup ran silently with the licence file, without the internet');
  let v = null;
  for (let i = 0; i < 60 && !(v = await version()); i++) await sleep(1000);
  ok(v === v0, `PANOPTICA ${v0} is running`);
  ok(running(), mac ? `as the launchd daemon ${LABEL}` : 'as the PANOPTICA task, which starts with the computer');
  const files = inRoot();
  ok(
    files.length > 0 && !files.some((f) => HAND.test(f)) && files.some((f) => /^reset-password\./.test(f)),
    'no script to run by hand in the app’s folder; reset-password stays for administrators',
  );
  ok(inRoot('internal').includes(mac ? 'update.command' : 'update.bat'), 'the update script is kept for the app');
  if (mac) {
    const st = execFileSync('stat', ['-f', '%Su %Lp', join(DIR, 'panoptica')])
      .toString()
      .trim();
    ok(st === 'root 700', `the app’s folder is the system’s alone (${st})`);
  } else {
    const acl = execFileSync('icacls', [DIR]).toString();
    ok(
      /Administrators/.test(acl) && /SYSTEM/.test(acl) && !/\\Users:|Authenticated Users|Everyone/.test(acl),
      'the install folder is the administrators’ and the system’s only',
    );
  }
  // the first setup on this computer (no code needed here): the lab's own names, independent of the licence
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
        name: 'Thin Films Lab',
        acronym: 'TFL',
        show: 'acronym',
        institution: '',
        domains: [],
        departments: [],
        hours: Array.from({ length: 7 }, (_, i) => ({ on: i < 5, from: '08:00', to: '18:00' })),
      },
    }),
  });
  ok(s.status === 200, 'the first setup');
  const cookie = s.headers.get('set-cookie')?.split(';')[0] ?? '',
    call = async (m, p, b) => {
      const x = await fetch(base + p, {
        method: m,
        headers: { cookie, ...(b ? { 'content-type': 'application/json' } : {}) },
        body: b ? JSON.stringify(b) : undefined,
      });
      return { s: x.status, j: await x.json().catch(() => null) };
    };
  const lic = (await call('GET', '/api/licence')).j;
  ok(
    lic?.state === 'ok' &&
      !lic.critical &&
      lic.licence?.lab === labName &&
      lic.licence?.acronym === acronym &&
      lic.licence?.users === 10,
    'with the licence Setup was given: its lab, acronym and tier',
  );
  ok((await (await fetch(base + '/api/lab/public')).json()).name === 'TFL', 'the lab shows the name it chose');
  // an update from GitHub, installed by the app: the task or the daemon starts it again
  ok(
    (await call('POST', '/api/updates/check')).j?.latest?.version === '99.0.0',
    'the app finds the newer release on GitHub',
  );
  ok((await call('POST', '/api/updates/download')).s === 200, 'downloads and checks it');
  ok((await call('POST', '/api/updates/install')).s === 200, 'and installs it');
  v = null;
  for (let i = 0; i < 240 && (v = await version()) !== '99.0.0'; i++) await sleep(1000);
  ok(v === '99.0.0', `the update restarted PANOPTICA through its ${mac ? 'daemon' : 'task'}`);
  ok(
    !inRoot().some((f) => HAND.test(f)) && inRoot('internal').includes(mac ? 'update.command' : 'update.bat'),
    'after the update, still no script to run by hand',
  );
  if (mac) {
    // Setup again over it: the program is replaced, the lab stays
    ok(macSetup().status === 0, 'Setup ran again over the installed PANOPTICA');
    for (let i = 0; i < 60 && !(v = await version()); i++) await sleep(1000);
    ok(!!v && (await call('GET', '/api/me')).s === 200, 'PANOPTICA runs again, with the lab and its admin');
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
gh.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
