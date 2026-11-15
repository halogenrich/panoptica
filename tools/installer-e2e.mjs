// PANOPTICA Setup from end to end, on Windows (0.47) as an administrator (GitHub's Windows machines are). Since 0.49 Setup
// carries the packages and takes the lab's licence file (Setup for macOS, 0.48 to 0.50, is gone since 0.51):
//   node tools/installer-e2e.mjs prepare <package folder> <newer package folder, 99.0.0> <work folder>
//      a throwaway signing key, the packages signed with it (<work>/packages, for tools/installer-build.mjs --packages) and a
//      newer release (<work>/new)
//   node tools/installer-e2e.mjs run <PANOPTICA-Setup.exe> <work folder>
//      a licence from the builder; Setup run silently with it; PANOPTICA running in the background (the startup task) with no
//      script to run by hand and its folder closed to other users; the first setup on this computer; the licence's lab and
//      tier; an update from a fake GitHub, installed by the app and restarted through the task; Setup run again over it while
//      it runs (the data stays; since 0.50.2); the uninstaller removing the task and keeping the data.
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
const tmp = mkdtempSync(join(tmpdir(), 'psc-setup-')),
  DIR = 'C:\\PANOPTICA-E2E',
  base = 'http://127.0.0.1:3000';
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
const show = (f) => {
  try {
    const t = existsSync(f) ? readFileSync(f, 'utf8') : '';
    if (t) console.log(`----- ${f}\n` + t.split(/\r?\n/).slice(-40).join('\n'));
  } catch {}
};
const running = () => spawnSync('schtasks', ['/query', '/tn', 'PANOPTICA']).status === 0;

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
const labName = 'Windows Laboratory of Thin Films',
  acronym = 'WLTF';
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
/** The files in the app's folder. */
const inRoot = (sub = '') => {
  try {
    return readdirSync(join(DIR, 'panoptica', sub));
  } catch {
    return [];
  }
};
const HAND = /^(start|start-network|update|version|restore)\.(bat|command|sh)$/;
try {
  console.log('PANOPTICA Setup on Windows (licence file, 0.49)');
  const v0 = readFileSync(join(work, 'version'), 'utf8').trim();
  const winSetup = (log) =>
    spawnSync(
      setup,
      [
        '/VERYSILENT',
        '/SUPPRESSMSGBOXES',
        '/NORESTART',
        `/DIR=${DIR}`,
        `/LICENCE=${licence}`,
        '/LAN=0',
        `/LOG=${join(tmp, log)}`,
      ],
      { env: { ...process.env, ...test }, stdio: 'inherit' },
    );
  const r = winSetup('setup.log');
  ok(r.status === 0, 'Setup ran silently with the licence file, without the internet');
  let v = null;
  for (let i = 0; i < 60 && !(v = await version()); i++) await sleep(1000);
  ok(v === v0, `PANOPTICA ${v0} is running`);
  ok(running(), 'as the PANOPTICA task, which starts with the computer');
  const files = inRoot();
  ok(
    files.length > 0 && !files.some((f) => HAND.test(f)) && files.some((f) => /^reset-password\./.test(f)),
    'no script to run by hand in the app’s folder; reset-password stays for administrators',
  );
  ok(inRoot('internal').includes('update.bat'), 'the update script is kept for the app');
  const acl = execFileSync('icacls', [DIR]).toString();
  ok(
    /Administrators/.test(acl) && /SYSTEM/.test(acl) && !/\\Users:|Authenticated Users|Everyone/.test(acl),
    'the install folder is the administrators’ and the system’s only',
  );
  // the first setup on this computer (no code needed here): the lab's own names, independent of the licence
  const s = await fetch(base + '/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      admin: {
        firstNames: 'Grace',
        surnames: 'Hopper',
        surname: 'Hopper',
        email: 'grace@win.example',
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
  // an update from GitHub, installed by the app: the task starts it again
  ok(
    (await call('POST', '/api/updates/check')).j?.latest?.version === '99.0.0',
    'the app finds the newer release on GitHub',
  );
  ok((await call('POST', '/api/updates/download')).s === 200, 'downloads and checks it');
  ok((await call('POST', '/api/updates/install')).s === 200, 'and installs it');
  v = null;
  for (let i = 0; i < 240 && (v = await version()) !== '99.0.0'; i++) await sleep(1000);
  ok(v === '99.0.0', 'the update restarted PANOPTICA through its task');
  ok(
    !inRoot().some((f) => HAND.test(f)) && inRoot('internal').includes('update.bat'),
    'after the update, still no script to run by hand',
  );
  // Setup again over it, while PANOPTICA is running: the program is replaced, the lab stays (0.50.2: Setup could not replace
  // node.exe while the running PANOPTICA held it)
  const again = winSetup('setup-again.log');
  if (again.status !== 0)
    try {
      console.log(readFileSync(join(tmp, 'setup-again.log'), 'latin1').split('\n').slice(-40).join('\n'));
    } catch {}
  ok(again.status === 0, 'Setup ran again over the installed PANOPTICA while it was running');
  v = null;
  for (let i = 0; i < 90 && !(v = await version()); i++) await sleep(1000);
  ok(!!v && (await call('GET', '/api/me')).s === 200, 'PANOPTICA runs again, with the lab and its admin');
  // the uninstaller: the task goes, the data stays
  const un = spawnSync(join(DIR, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
    stdio: 'inherit',
  });
  await sleep(5000);
  ok(un.status === 0 && !running(), 'uninstalled: the task is gone');
  ok(!(await version()), 'PANOPTICA stopped');
  const db = join(DIR, 'panoptica/apps/server/data.db');
  ok(existsSync(db), 'the lab’s data stays');
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
  ])
    show(f);
gh.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
