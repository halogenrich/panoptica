// PANOPTICA Setup on Windows from end to end (0.47), as an administrator (GitHub's Windows machines are):
//   node tools/installer-e2e.mjs <PANOPTICA-Setup.exe> <package folder> <newer package folder, version 99.0.0>
// A throwaway activation service and signing key; the wizard run silently with a product key; PANOPTICA running as the startup
// task; the first setup on this computer; an update from the service, installed by the app and restarted through the task;
// the uninstaller removing the task and keeping the data.
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const [setup, pkgDir, newDir] = process.argv.slice(2);
const root = fileURLToPath(new URL('..', import.meta.url)),
  tmp = mkdtempSync(join(tmpdir(), 'psc-setup-')),
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
const show = (f) =>
  existsSync(f) && console.log(`----- ${f}\n` + readFileSync(f, 'utf8').split(/\r?\n/).slice(-40).join('\n'));

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
try {
  console.log('PANOPTICA Setup on Windows (0.47)');
  await sleep(1500);
  const v0 = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
  staff('publish', v0, '--from', release(pkgDir, v0));
  const key = staff(
    'new',
    '--lab',
    'Windows Lab',
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
  const r = spawnSync(
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
  ok(r.status === 0, 'the wizard ran silently with the product key');
  let v = null;
  for (let i = 0; i < 60 && !(v = await version()); i++) await sleep(1000);
  ok(v === v0, `PANOPTICA ${v0} is running`);
  ok(
    spawnSync('schtasks', ['/query', '/tn', 'PANOPTICA']).status === 0,
    'as the PANOPTICA task, which starts with the computer',
  );
  // the first setup on this computer (no code needed here)
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
        name: 'Windows Lab',
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
  ok((await call('GET', '/api/licence')).j?.licence?.lab === 'Windows Lab', 'with the key’s licence');
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
  ok(v === '99.0.0', 'the update restarted PANOPTICA through its task');
  // the uninstaller: the task goes, the data stays
  const un = spawnSync(join(DIR, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
    stdio: 'inherit',
  });
  await sleep(5000);
  ok(
    un.status === 0 && spawnSync('schtasks', ['/query', '/tn', 'PANOPTICA']).status !== 0,
    'uninstalled: the task is gone',
  );
  ok(!(await version()), 'PANOPTICA stopped');
  ok(existsSync(join(DIR, 'panoptica/apps/server/data.db')), 'the lab’s data stays');
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
svc.kill();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
