// The product key from end to end (0.47), on any system: PANOPTICA's activation service, a staff key, the installer's helper
// installing the key's package into a new folder, the installed app starting with the key's licence, and its updates coming
// from the service with the key. Uses the package npm run check just made (out/panoptica) and a throwaway signing key.
// Windows' own parts (the wizard, the startup task, the firewall, restarting after an update) are tested by
// tools/installer-e2e.mjs on Windows.
import { spawn, execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('..', import.meta.url)),
  tmp = mkdtempSync(join(tmpdir(), 'psc-activation-'));
let failed = 0;
const ok = (c, m) => {
  console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`);
  if (!c) failed++;
};
const freePort = () =>
  new Promise((r) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });
const procs = [];
const start = (args, env, cwd, until) =>
  new Promise((res, rej) => {
    const p = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    procs.push(p);
    let out = '';
    const t = setTimeout(() => rej(new Error('did not start: ' + out)), 60_000);
    const on = (d) => {
      out += d;
      if (until.test(out)) {
        clearTimeout(t);
        res(p);
      }
    };
    p.stdout.on('data', on);
    p.stderr.on('data', on);
  });
const done = () => {
  for (const p of procs) p.kill();
  rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
};

try {
  console.log('Product keys: the activation service, the installer’s helper, the app (0.47)');
  const pkg = join(root, 'out/panoptica');
  if (!existsSync(join(pkg, 'apps/server/dist/server.mjs'))) throw new Error('run tools/package.mjs first');
  // a throwaway PANOPTICA key: the helper, the app and the staff tool are all told to trust it
  const k = generateKeyPairSync('ed25519');
  writeFileSync(join(tmp, 'key.pem'), k.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(join(tmp, 'pub.pem'), k.publicKey.export({ type: 'spki', format: 'pem' }));
  const test = { PANOPTICA_TEST: '1', UPDATE_PUBLIC_KEY_FILE: join(tmp, 'pub.pem') };
  // the release: the package zipped as a lab downloads it, signed
  const files = {};
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else files['panoptica/' + relative(pkg, p).split('\\').join('/')] = readFileSync(p);
    }
  };
  walk(pkg);
  const rel = join(tmp, 'release');
  mkdirSync(rel);
  const zip = Buffer.from(zipSync(files, { level: 1 }));
  writeFileSync(join(rel, 'panoptica-devices.zip'), zip);
  writeFileSync(join(rel, 'panoptica-devices.zip.sig'), sign(null, zip, k.privateKey).toString('base64') + '\n');
  // the service
  const sport = await freePort(),
    service = `http://127.0.0.1:${sport}`,
    token = 'test-admin-token-' + 'x'.repeat(24);
  await start(
    [join(root, 'services/activation/server.mjs')],
    { ADMIN_TOKEN: token, ACTIVATION_DATA: join(tmp, 'service'), PORT: String(sport), HOST: '127.0.0.1' },
    root,
    /activation service on port/,
  );
  const staff = (...a) =>
    execFileSync(
      process.execPath,
      [join(root, 'tools/builder/keys.mjs'), ...a, '--service', service, '--token', token],
      { cwd: root, stdio: 'pipe' },
    ).toString();
  const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version;
  ok(/published/.test(staff('publish', version, '--from', rel)), 'staff publish a release’s packages');
  const made = staff(
    'new',
    '--lab',
    'Key Lab',
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
  );
  const key = made.match(/^key (\S+)/)[1];
  ok(/^([2-9A-HJKMNP-Z]{5}-){4}[2-9A-HJKMNP-Z]{5}$/.test(key), 'a new product key, on its card only');
  ok(
    !readFileSync(join(tmp, 'service/activation.db')).includes(Buffer.from(key)),
    'the service keeps no key, only its hash',
  );
  // the helper, as the wizard runs it
  const helper = join(root, 'installer/build/helper.cjs');
  if (!existsSync(helper)) execFileSync(process.execPath, [join(root, 'tools/installer-build.mjs'), '--helper-only']);
  const dir = join(tmp, 'PANOPTICA'),
    run = (...a) =>
      execFileSync(process.execPath, [helper, ...a, '--service', service, '--dir', dir], {
        env: { ...process.env, ...test },
        stdio: 'pipe',
      }).toString();
  const iniOf = (f) =>
    Object.fromEntries(
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.includes('='))
        .map((l) => l.split(/=(.*)/s).slice(0, 2)),
    );
  run('check', '--key', 'AAAAA-AAAAA-AAAAA-AAAAA-AAAAA', '--out', join(tmp, 'bad.ini'));
  ok(/not valid/.test(iniOf(join(tmp, 'bad.ini')).error ?? ''), 'a wrong key is refused before anything is installed');
  run('check', '--key', key.toLowerCase(), '--out', join(tmp, 'check.ini'));
  const c = iniOf(join(tmp, 'check.ini'));
  ok(
    c.ok === '1' && c.lab === 'Key Lab' && c.modules === 'devices' && c.version === version,
    'the wizard is told what the key covers',
  );
  run('install', '--key', key, '--lan', '0', '--task', '0');
  const app = join(dir, 'panoptica');
  ok(
    existsSync(join(app, 'apps/server/dist/server.mjs')) && existsSync(join(app, 'licence.json')),
    'the key’s package and licence are installed',
  );
  ok(
    JSON.parse(readFileSync(join(app, 'config/update.json'), 'utf8')).key === key,
    'the key is left for the app’s updates',
  );
  // a second computer: over the key's limit
  const other = join(tmp, 'OTHER');
  let refused = '';
  try {
    execFileSync(
      process.execPath,
      [helper, 'install', '--key', key, '--service', service, '--dir', other, '--task', '0'],
      {
        env: { ...process.env, ...test },
        stdio: 'pipe',
      },
    );
  } catch (e) {
    refused = e.stdout.toString();
  }
  ok(/in use on 1 computer/.test(refused), 'a second computer is refused within the key’s limit');
  // the installed app
  const port = await freePort(),
    base = `http://127.0.0.1:${port}`;
  await start(
    ['--no-warnings', 'dist/server.mjs'],
    { ...test, PORT: String(port), HOST: '127.0.0.1', ADMIN_PASSWORD: '' },
    join(app, 'apps/server'),
    /not set up yet/,
  );
  const remote = { 'x-test-remote': '1' };
  ok(
    (await (await fetch(base + '/api/lab/public', { headers: remote })).json()).setup === 'code',
    'it asks other computers for the setup code',
  );
  const setup = await fetch(base + '/api/setup', {
    method: 'POST',
    headers: { ...remote, 'content-type': 'application/json' },
    body: JSON.stringify({
      admin: {
        firstNames: 'Ada',
        surnames: 'Lovelace',
        surname: 'Lovelace',
        email: 'ada@key.example',
        birthDate: '1990-12-10',
        password: 'Key-lab-2026!',
      },
      lab: {
        name: 'Key Lab',
        institution: '',
        domains: [],
        departments: [],
        hours: Array.from({ length: 7 }, (_, i) => ({ on: i < 5, from: '08:00', to: '18:00' })),
      },
      code: key,
    }),
  });
  ok(setup.status === 200, 'and the product key is that code');
  const cookie = setup.headers.get('set-cookie').split(';')[0],
    call = async (m, p, b) => {
      const r = await fetch(base + p, {
        method: m,
        headers: { cookie, ...(b ? { 'content-type': 'application/json' } : {}) },
        body: b ? JSON.stringify(b) : undefined,
      });
      return { s: r.status, j: await r.json().catch(() => null) };
    };
  const lic = (await call('GET', '/api/licence')).j;
  ok(lic.licence?.lab === 'Key Lab' && lic.byKey, 'it runs with the key’s licence');
  // a renewal and a newer release, through the service
  staff(
    'renew',
    '--lab-id',
    lic.licence.labId,
    '--updates-until',
    '2101-01-31',
    '--key',
    join(tmp, 'key.pem'),
    '--pub',
    join(tmp, 'pub.pem'),
  );
  staff('publish', '99.0.0', '--from', rel);
  const u = (await call('POST', '/api/updates/check')).j;
  ok(u.source === 'key' && u.available && u.latest.version === '99.0.0', 'updates come from the service with the key');
  ok((await call('GET', '/api/licence')).j.licence.updatesUntil === '2101-01-31', 'and the renewed licence with them');
  const d = await call('POST', '/api/updates/download');
  ok(d.s === 200 && d.j.downloaded?.version === '99.0.0', 'the key’s package is downloaded and checked');
} catch (e) {
  console.log('  FAIL ' + (e.stack ?? e));
  failed++;
}
done();
