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
//      0.51: PANOPTICA on port 80, open to the network, until its first setup; its runtime as PANOPTICA.exe; the tray icon
//      running, reading the status and making a backup; network settings changed while it runs (another port and this computer
//      alone; HTTPS on 443 with a certificate made here, a wrong key refused, port 80 sending people on), the firewall rule
//      following them, and the lab's address on the sign-in screen.
//      0.52: the update carries Node. Setup's own Node comes from a runtime file (Node 26) put with the packages; the first
//      update (99.0.0) brings Node 24, swapped by the update script; the next (99.0.1) brings Node 20, on which PANOPTICA cannot
//      start (no node:sqlite), so the update script puts Node 24 back and the admins are told; the last (99.0.2) brings a Node
//      file signed with another key, refused by the app before anything changes, and the update installs PANOPTICA alone.
//      Setup run again then puts its own Node back.
import http from 'node:http';
import https from 'node:https';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { nodeForWindows, writeRuntimeFile } from './runtime-file.mjs';

const [mode, ...rest] = process.argv.slice(2);
const root = fileURLToPath(new URL('..', import.meta.url));
/** A package folder zipped as a release asset, signed with the throwaway key (as another version when asked). */
const pack = (from, to, key, version) => {
  const files = {},
    walk = (d) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else files['panoptica/' + relative(from, p).split('\\').join('/')] = readFileSync(p);
      }
    };
  walk(from);
  if (version)
    for (const f of ['panoptica/package.json', 'panoptica/built.json'])
      if (files[f]) files[f] = Buffer.from(JSON.stringify({ ...JSON.parse(files[f].toString('utf8')), version }));
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
  // the runtime files (0.52), signed with the same key: Setup's Node (26, with the packages) and the Nodes the updates bring
  process.env.SIGNING_KEY = k.privateKey.export({ type: 'pkcs8', format: 'pem' });
  process.env.UPDATE_PUBLIC_KEY = k.publicKey.export({ type: 'spki', format: 'pem' });
  const n26 = await nodeForWindows('26'),
    n24 = await nodeForWindows('24'),
    n20 = await nodeForWindows('20');
  writeRuntimeFile(join(work, 'packages'), n26);
  writeRuntimeFile(join(work, 'new'), n24);
  pack(newDir, join(work, 'new2'), k.privateKey, '99.0.1');
  writeRuntimeFile(join(work, 'new2'), n20);
  pack(newDir, join(work, 'new3'), k.privateKey, '99.0.2');
  const forged = writeRuntimeFile(join(work, 'new3'), n26);
  writeFileSync(
    forged + '.sig',
    sign(null, readFileSync(forged), generateKeyPairSync('ed25519').privateKey).toString('base64') + '\n',
  );
  writeFileSync(join(work, 'nodes.json'), JSON.stringify({ setup: n26.version, a: n24.version, b: n20.version }));
  console.log(
    `prepared ${work}: packages/ (Node ${n26.version}), new/ (Node ${n24.version}), new2/ (Node ${n20.version}), new3/ (a forged Node file), signed with a throwaway key`,
  );
  process.exit(0);
}
if (mode !== 'run') {
  console.error('usage: installer-e2e.mjs prepare <pkg> <newer pkg> <work> | run <setup> <work>');
  process.exit(2);
}
const [setup, work] = [resolve(rest[0]), resolve(rest[1])];
const tmp = mkdtempSync(join(tmpdir(), 'psc-setup-')),
  DIR = 'C:\\PANOPTICA-E2E';
// a new install made by Setup answers on port 80 (0.51); the test moves it and back
let base = 'http://127.0.0.1';
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
const pwsh = (c) => spawnSync('powershell.exe', ['-NoProfile', '-Command', c], { encoding: 'utf8' }).stdout.trim();
/** The firewall rule PANOPTICA keeps (0.51), as netsh shows it. */
const rule = () =>
  spawnSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=PANOPTICA'], { encoding: 'utf8' }).stdout;
/** PANOPTICA changes the firewall rule in the background (netsh takes a second or two): waits for it, up to 15 s. */
const ruleBecomes = async (test) => {
  let r = '';
  for (let i = 0; i < 30 && !test((r = rule())); i++) await sleep(500);
  if (!test(r)) console.log(r);
  return test(r);
};
/** The tray icon's test modes: --status, --backup. */
const trayRun = (a) => {
  const r = spawnSync(join(DIR, 'tray', 'PANOPTICA-tray.exe'), [a], { encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, out: (r.stdout ?? '').trim() };
};
let cookieJar = '';
/** A request over HTTPS to a certificate made for the lab's name (not checked: this is 127.0.0.1), or plain HTTP. */
const get = (url, method = 'GET', body) =>
  new Promise((res) => {
    const q = (url.startsWith('https') ? https : http).request(
      url,
      {
        method,
        rejectUnauthorized: false,
        headers: { cookie: cookieJar, ...(body ? { 'content-type': 'application/json' } : {}) },
      },
      (r) => {
        let d = '';
        r.on('data', (x) => (d += x));
        r.on('end', () => res({ status: r.statusCode, body: d, location: r.headers.location }));
      },
    );
    q.on('error', (e) => res({ status: 0, body: e.message }));
    q.end(body ? JSON.stringify(body) : undefined);
  });

const test = {
  PANOPTICA_TEST: '1',
  UPDATE_PUBLIC_KEY_FILE: join(work, 'pub.pem'),
  // releases from a fake GitHub (below), passed on to the app by the helper in test mode
  UPDATE_API: 'http://127.0.0.1:4799',
  UPDATE_REPO: 'lab/app',
  // 0.52: how long the update script waits for PANOPTICA on a new Node before putting the old one back
  RUNTIME_WAIT: '45',
};
// ---- a fake GitHub with one release at a time: a newer package (work/new, new2, new3), its checksum and signature, and the
// Node it carries (0.52)
let rel = join(work, 'new'),
  relVersion = '99.0.0';
const asset = () => readdirSync(rel).sort();
const nodes = JSON.parse(readFileSync(join(work, 'nodes.json'), 'utf8'));
const gh = http
  .createServer((q, r) => {
    if (q.url === '/repos/lab/app/releases/latest')
      return r.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          tag_name: 'v' + relVersion,
          name: 'PANOPTICA ' + relVersion,
          body: 'e2e',
          published_at: new Date().toISOString(),
          html_url: 'x',
          assets: asset().map((name, i) => ({ id: i + 1, name, size: statSync(join(rel, name)).size })),
        }),
      );
    const a = q.url.match(/\/releases\/assets\/(\d+)$/);
    if (a && asset()[+a[1] - 1]) return r.writeHead(200).end(readFileSync(join(rel, asset()[+a[1] - 1])));
    r.writeHead(404).end('{}');
  })
  .listen(4799, '127.0.0.1');
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
        `/LOG=${join(tmp, log)}`,
      ],
      { env: { ...process.env, ...test }, stdio: 'inherit' },
    );
  // 0.51: a new install listens on port 80 (HTTPS later on 443). On GitHub's Windows machines a service of Windows may hold
  // them (http.sys): shown, then stopped, so the test checks PANOPTICA on the real ports. A lab's computer has nothing there
  // unless IIS or another web server runs; if one does, PANOPTICA starts on 3000 and says why (Admin settings › Network).
  const holders = () =>
    spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' })
      .stdout.split('\n')
      .filter((l) => /LISTENING/.test(l) && /:(80|443)\s/.test(l))
      .map((l) => l.trim().replace(/\s+/g, ' '));
  const busy = holders();
  if (busy.length) {
    console.log('  ports 80/443 before Setup:\n    ' + busy.join('\n    '));
    console.log(
      spawnSync('netsh', ['http', 'show', 'servicestate', 'view=requestq'], { encoding: 'utf8' })
        .stdout.split('\n')
        .filter((l) => /Process IDs|Registered URLs|HTTP:\/\/|HTTPS:\/\//i.test(l))
        .slice(0, 20)
        .join('\n'),
    );
    spawnSync('net', ['stop', 'http', '/y'], { stdio: 'inherit' });
    console.log('  after stopping http.sys: ' + (holders().join('; ') || 'free'));
  }
  console.log(
    '  excluded port ranges: ' +
      spawnSync('netsh', ['int', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp'], { encoding: 'utf8' })
        .stdout.split('\n')
        .filter((l) => /^\s*\d+\s+\d+/.test(l))
        .map((l) => l.trim().replace(/\s+/g, '-'))
        .join(', '),
  );
  const r = winSetup('setup.log');
  ok(r.status === 0, 'Setup ran silently with the licence file, without the internet');
  let v = null;
  for (let i = 0; i < 60 && !(v = await version()); i++) await sleep(1000);
  ok(v === v0, `PANOPTICA ${v0} is running`);
  ok(running(), 'as the PANOPTICA task, which starts with the computer');
  const exeNode = () =>
    pwsh(`(Get-Item '${join(DIR, 'node', 'PANOPTICA.exe')}').VersionInfo.Comments`).replace(
      /^Node\.js (\S+) runtime$/,
      '$1',
    );
  ok(exeNode() === nodes.setup, `on the Node of the release's runtime file (${exeNode()})`);
  const files = inRoot();
  ok(
    files.length > 0 && !files.some((f) => HAND.test(f)) && files.some((f) => /^reset-password\./.test(f)),
    'no script to run by hand in the app’s folder; reset-password stays for administrators',
  );
  ok(inRoot('internal').includes('update.bat'), 'the update script is kept for the app');
  // 0.51: open to the network on port 80 until the first setup decides; PANOPTICA in Task Manager; the tray icon
  const net0 = JSON.parse(readFileSync(join(DIR, 'panoptica/config/network.json'), 'utf8'));
  ok(net0.open === 'network' && net0.port === 80, 'a new install is open to the network on port 80');
  const desc = pwsh(`(Get-Item '${join(DIR, 'node', 'PANOPTICA.exe')}').VersionInfo.FileDescription`),
    procs = pwsh(
      `@(Get-Process -Name PANOPTICA -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${join(DIR, 'node', 'PANOPTICA.exe')}' }).Count`,
    );
  ok(
    desc === 'PANOPTICA' && +procs >= 1,
    `PANOPTICA runs as PANOPTICA.exe, described as PANOPTICA (${desc}, ${procs})`,
  );
  ok(await ruleBecomes((r) => /LocalPort:\s+80\b/.test(r)), 'the firewall lets the network reach port 80');
  const trayExe = join(DIR, 'tray', 'PANOPTICA-tray.exe');
  spawn(trayExe, [], { detached: true, stdio: 'ignore' }).unref();
  await sleep(5000);
  ok(+pwsh('@(Get-Process -Name PANOPTICA-tray -ErrorAction SilentlyContinue).Count') >= 1, 'the tray icon runs');
  const st = trayRun('--status');
  ok(
    st.status === 0 && st.out.startsWith(`running ${v0} http://localhost`),
    `the tray icon reads the status (${st.out})`,
  );
  const bk = trayRun('--backup');
  ok(
    bk.status === 0 && /^data-.*-manual\.db$/.test(bk.out) && existsSync(join(DIR, 'panoptica/backups', bk.out)),
    `the tray icon makes a backup (${bk.out})`,
  );
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
      // the Network step (0.51): open to the network, with the lab's address
      network: { open: 'network', address: 'panoptica-e2e.example', https: false },
    }),
  });
  ok(s.status === 200, 'the first setup, with its Network step');
  cookieJar = s.headers.get('set-cookie')?.split(';')[0] ?? '';
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
  ok(
    (await (await fetch(base + '/api/lab/public')).json()).url === 'http://panoptica-e2e.example',
    'the sign-in screen has the lab’s address',
  );
  // network settings changed while it runs (0.51): another port and this computer alone, then HTTPS on 443
  let n = await call('PUT', '/api/network', { open: 'computer', address: 'panoptica-e2e.example', port: 8080 });
  ok(n.s === 200 && n.j?.port === 8080, 'moved to port 8080, this computer alone');
  ok((await fetch('http://127.0.0.1:8080/api/version')).ok, 'it answers on port 8080');
  ok(
    await ruleBecomes((r) => !/Rule Name:\s+PANOPTICA/.test(r)),
    'the firewall rule is gone: only this computer may open it',
  );
  await sleep(1500);
  ok(trayRun('--status').out.startsWith(`running ${v0} http://localhost:8080`), 'the tray icon follows the port');
  const base80 = base;
  base = 'http://127.0.0.1:8080';
  const certs = join(tmp, 'certs');
  mkdirSync(certs);
  const ossl = (...a) => execFileSync('openssl', a, { cwd: certs, stdio: 'pipe' });
  ossl(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'key.pem',
    '-out',
    'cert.pem',
    '-days',
    '20',
    '-subj',
    '/CN=panoptica-e2e.example',
    '-addext',
    'subjectAltName=DNS:panoptica-e2e.example',
  );
  ossl(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'other.pem',
    '-out',
    'other-cert.pem',
    '-days',
    '20',
    '-subj',
    '/CN=other.example',
  );
  const pem = readFileSync(join(certs, 'cert.pem'), 'utf8'),
    key = readFileSync(join(certs, 'key.pem'), 'utf8');
  n = await call('PUT', '/api/network', {
    open: 'network',
    address: 'panoptica-e2e.example',
    https: true,
    cert: { pem, key: readFileSync(join(certs, 'other.pem'), 'utf8') },
  });
  ok(
    n.s === 400 && /does not belong/.test(n.j?.error),
    `a key that is not the certificate's is refused (${n.j?.error})`,
  );
  ok((await fetch(base + '/api/version')).ok, 'and the old settings stay');
  n = await call('PUT', '/api/network', {
    open: 'network',
    address: 'panoptica-e2e.example',
    https: true,
    cert: { pem, key },
  });
  ok(n.s === 200 && n.j?.https && n.j?.port === 443, `HTTPS on port 443 under the service (${n.j?.error ?? ''})`);
  const sec = await get('https://127.0.0.1/api/lab/public');
  ok(
    sec.status === 200 && JSON.parse(sec.body).url === 'https://panoptica-e2e.example',
    'it answers with HTTPS, at the lab’s address',
  );
  const plain = await get('http://127.0.0.1/batches');
  ok(
    plain.status === 301 && plain.location === 'https://panoptica-e2e.example/batches',
    'port 80 sends people on to HTTPS',
  );
  ok(
    await ruleBecomes((r) => /LocalPort:\s+(443,80|80,443)\b/.test(r)),
    'the firewall lets the network reach ports 443 and 80',
  );
  await sleep(1500);
  ok(
    trayRun('--status').out.startsWith(`running ${v0} https://panoptica-e2e.example`),
    'the tray icon reads it over HTTPS',
  );
  n = await get('https://127.0.0.1/api/network', 'PUT', {
    open: 'network',
    address: 'panoptica-e2e.example',
    https: false,
  });
  ok(n.status === 200, 'back to HTTP on port 80');
  base = base80;
  ok((await fetch(base + '/api/version')).ok, 'it answers on port 80 again');
  // an update from GitHub, installed by the app: the task starts it again
  ok(
    (await call('POST', '/api/updates/check')).j?.latest?.version === '99.0.0',
    'the app finds the newer release on GitHub',
  );
  let dl = await call('POST', '/api/updates/download');
  ok(dl.s === 200, 'downloads and checks it');
  ok(
    dl.j?.runtime?.node === nodes.setup && dl.j.runtime.ready === nodes.a,
    `with the Node it carries, checked and ready (${dl.j?.runtime?.ready})`,
  );
  ok((await call('POST', '/api/updates/install')).s === 200, 'and installs it');
  v = null;
  for (let i = 0; i < 240 && (v = await version()) !== '99.0.0'; i++) await sleep(1000);
  ok(v === '99.0.0', 'the update restarted PANOPTICA through its task');
  ok(
    !inRoot().some((f) => HAND.test(f)) && inRoot('internal').includes('update.bat'),
    'after the update, still no script to run by hand',
  );
  // 0.52: the update script swapped Node
  let rt = (await call('GET', '/api/updates')).j?.runtime;
  ok(rt?.node === nodes.a, `PANOPTICA now runs on Node ${nodes.a} (${rt?.node})`);
  ok(
    exeNode() === nodes.a &&
      pwsh(`(Get-Item '${join(DIR, 'node', 'PANOPTICA.exe')}').VersionInfo.FileDescription`) === 'PANOPTICA',
    'PANOPTICA.exe was made again from the new node.exe',
  );
  ok(!existsSync(join(DIR, 'node.old')) && !existsSync(join(DIR, 'panoptica/updates/runtime')), 'nothing left behind');
  // a Node PANOPTICA cannot start on: the old one goes back
  rel = join(work, 'new2');
  relVersion = '99.0.1';
  ok(
    (await call('POST', '/api/updates/check')).j?.runtime?.carries?.version === nodes.b,
    `99.0.1 brings Node ${nodes.b}`,
  );
  dl = await call('POST', '/api/updates/download');
  ok(dl.s === 200 && dl.j?.runtime?.ready === nodes.b, 'downloaded with it');
  ok((await call('POST', '/api/updates/install')).s === 200, 'and installed');
  v = null;
  for (let i = 0; i < 360 && (v = await version()) !== '99.0.1'; i++) await sleep(1000);
  rt = (await call('GET', '/api/updates')).j?.runtime;
  ok(
    v === '99.0.1' && rt?.node === nodes.a && rt.failed?.reason === 'start' && rt.failed.to === nodes.b,
    `PANOPTICA did not start on Node ${nodes.b}: 99.0.1 runs on Node ${rt?.node} again (${JSON.stringify(rt?.failed)})`,
  );
  const told = (await call('GET', '/api/notifications')).j;
  ok(
    JSON.stringify(told ?? '').includes(`did not start on Node ${nodes.b}`),
    'the admins are told the update put the old Node back',
  );
  ok(
    exeNode() === nodes.a && !existsSync(join(DIR, 'node.old')),
    'the old Node is back in place, PANOPTICA.exe with it',
  );
  // a Node file signed with another key: refused before anything changes; the update installs PANOPTICA alone
  rel = join(work, 'new3');
  relVersion = '99.0.2';
  await call('POST', '/api/updates/check');
  dl = await call('POST', '/api/updates/download');
  ok(
    dl.s === 200 && /not signed by PANOPTICA/.test(dl.j?.runtime?.refused?.reason ?? '') && !dl.j.runtime.ready,
    `a forged Node file is refused (${dl.j?.runtime?.refused?.reason}); the update is still downloaded`,
  );
  ok((await call('POST', '/api/updates/install')).s === 200, 'and installed');
  v = null;
  for (let i = 0; i < 240 && (v = await version()) !== '99.0.2'; i++) await sleep(1000);
  rt = (await call('GET', '/api/updates')).j?.runtime;
  ok(v === '99.0.2' && rt?.node === nodes.a, `99.0.2 runs, on Node ${rt?.node} as before`);
  // Setup again over it, while PANOPTICA is running: the program is replaced, the lab stays (0.50.2: Setup could not replace
  // node.exe while the running PANOPTICA held it)
  const again = winSetup('setup-again.log');
  if (again.status !== 0)
    try {
      console.log(readFileSync(join(tmp, 'setup-again.log'), 'latin1').split('\n').slice(-40).join('\n'));
    } catch {}
  ok(again.status === 0, 'Setup ran again over the installed PANOPTICA (and its tray icon) while it was running');
  v = null;
  for (let i = 0; i < 90 && !(v = await version()); i++) await sleep(1000);
  ok(!!v && (await call('GET', '/api/me')).s === 200, 'PANOPTICA runs again, with the lab and its admin');
  rt = (await call('GET', '/api/updates')).j?.runtime;
  ok(rt?.node === nodes.setup && exeNode() === nodes.setup, `on Setup's own Node again (${rt?.node})`);
  // the uninstaller: the task goes, the data stays
  const un = spawnSync(join(DIR, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
    stdio: 'inherit',
  });
  await sleep(5000);
  ok(un.status === 0 && !running(), 'uninstalled: the task is gone');
  ok(
    spawnSync('reg', ['query', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'PANOPTICA tray'])
      .status !== 0,
    'the tray icon no longer starts at sign-in',
  );
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
