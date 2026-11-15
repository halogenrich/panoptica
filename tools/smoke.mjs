// Security and data-safety checks against a real server with a throw-away database. Run: npm run test:server
// Starts a fake GitHub API too, to test the update download and its checksum.
import { spawn, execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'psc-smoke-')),
  // free ports from the system (fixed ones can fall in ranges Windows reserves)
  freePort = () =>
    new Promise((res) => {
      const s = createNetServer().listen(0, '127.0.0.1', () => {
        const p = s.address().port;
        s.close(() => res(p));
      });
    }),
  PORT = await freePort(),
  GH = await freePort();
const base = `http://127.0.0.1:${PORT}`,
  PW = 'Admin-pass-for-tests-26';
let failed = 0;
const ok = (cond, what) => {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${what}`);
  if (!cond) failed++;
};

// ---- fake GitHub: one release with a zip, its checksum and its signature (and a wrong checksum or signature on demand)
const zip = Buffer.from('PK fake zip for the update test'),
  good = createHash('sha256').update(zip).digest('hex');
let sum = good;
// releases are signed; the test signs with a key of its own and gives the server its public half
const testKey = generateKeyPairSync('ed25519'),
  goodSig = sign(null, zip, testKey.privateKey).toString('base64');
let sig = goodSig; // null: a release with no signature
const published = new Date().toISOString();
const fetched = []; // the assets the app downloaded
const gh = createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer test-token') {
    res.writeHead(404);
    return res.end('{}');
  }
  if (req.url === '/repos/lab/app/releases/latest') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(
      JSON.stringify({
        tag_name: 'v99.0.0',
        name: 'v99.0.0',
        body: 'notes',
        published_at: published,
        html_url: 'x',
        // 0.46: a package per combination of modules, and panoptica.zip with every module (ids 11-13, 21-23, 31-33)
        assets: ['panoptica.zip', 'panoptica-devices.zip', 'panoptica-core.zip'].flatMap((n, i) => [
          { id: 10 * (i + 1) + 1, name: n, size: zip.length },
          { id: 10 * (i + 1) + 2, name: n + '.sha256', size: 64 },
          ...(sig ? [{ id: 10 * (i + 1) + 3, name: n + '.sig', size: 89 }] : []),
        ]),
      }),
    );
  }
  const a = req.url.match(/^\/repos\/lab\/app\/releases\/assets\/(\d+)$/);
  if (a) {
    fetched.push(+a[1]);
    const k = +a[1] % 10;
    if (k === 1 || k === 2 || (k === 3 && sig)) {
      res.writeHead(200);
      return res.end(k === 1 ? zip : k === 2 ? `${sum}  panoptica.zip\n` : sig + '\n');
    }
  }
  res.writeHead(404);
  res.end('{}');
}).listen(GH, '127.0.0.1');

const env = {
  ...process.env,
  PORT: String(PORT),
  HOST: '127.0.0.1',
  DB_PATH: join(tmp, 'data.db'),
  BACKUP_DIR: join(tmp, 'backups'),
  CONFIG_DIR: join(tmp, 'config'),
  UPDATES_DIR: join(tmp, 'updates'),
  ADMIN_USER: 'admin',
  ADMIN_PASSWORD: PW,
  UPDATE_API: `http://127.0.0.1:${GH}`,
  UPDATE_REPO: 'lab/app',
  PANOPTICA_TEST: '1',
  // a module that exists only in the tests, next to Electronic Devices (0.41); the packaged server runs without it
  ...(process.argv.includes('--built') ? {} : { PANOPTICA_TEST_MODULE: join(root, 'tools/fake-module.ts') }),
  // --core (0.43): the core alone, without Electronic Devices (with the test module when run from source)
  ...(process.argv.includes('--core') && !process.argv.includes('--built') ? { PANOPTICA_MODULES: 'none' } : {}),
  UPDATE_PUBLIC_KEY: testKey.publicKey.export({ type: 'spki', format: 'pem' }),
};
// --built: the same checks against the packaged server (out/panoptica, made by tools/package.mjs), the file labs run.
// --core: the core alone (0.43); with --built, the package made with no module (out/core/panoptica).
const BUILT = process.argv.includes('--built'),
  CORE = process.argv.includes('--core'),
  MODULES = CORE ? [] : ['devices'],
  DEV = MODULES.includes('devices'),
  serverCwd = BUILT
    ? join(root, CORE ? 'out/core/panoptica/apps/server' : 'out/panoptica/apps/server')
    : join(root, 'apps/server'),
  serverArgs = BUILT ? ['--no-warnings', 'dist/server.mjs'] : ['--import', 'tsx', 'src/index.ts'];
const srv = spawn(process.execPath, serverArgs, {
  cwd: serverCwd,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
srv.stdout.on('data', (d) => {
  log += d;
});
srv.stderr.on('data', (d) => {
  log += d;
});
const done = (code) => {
  srv.kill();
  gh.close();
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* Windows */
  }
  process.exit(code);
};
// up to a minute: from source, a cold Windows runner compiles the core and the modules on the first start
for (let i = 0; i < 300 && !log.includes('Server listening'); i++) await new Promise((r) => setTimeout(r, 200));
if (!log.includes('Server listening')) {
  console.error('the server did not start in a minute:\n' + log);
  done(1);
}

let cookie = '';
const call = async (method, path, body, headers = {}) => {
  const r = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = t;
  }
  return { s: r.status, j, h: r.headers };
};

console.log('Sign-in');
ok((await call('POST', '/api/login', { username: 'admin', password: 'wrong' })).s === 401, 'wrong password refused');
ok(
  (await call('POST', '/api/login', { username: 'nobody', password: 'wrong' })).s === 401,
  'unknown user refused the same way',
);
const li = await call('POST', '/api/login', { username: 'admin', password: PW });
ok(li.s === 200, 'right password accepted');
const set = li.h.get('set-cookie') ?? '';
cookie = set.split(';')[0];
ok(/HttpOnly/i.test(set) && /SameSite=Lax/i.test(set), 'session cookie is HttpOnly and SameSite=Lax');
const raw = cookie.split('=')[1];
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(env.DB_PATH, { timeout: 5000 }); // wait for the server's writes instead of failing on a lock
ok(
  !db.prepare('SELECT 1 FROM sessions WHERE token=?').get(raw) && !!db.prepare('SELECT 1 FROM sessions').get(),
  'session stored as a hash, not the cookie value',
);
ok(
  !/admin|Admin-pass/.test(db.prepare('SELECT hash FROM users WHERE username=?').get('admin').hash),
  'password stored as a hash',
);

console.log('Headers');
const me = await call('GET', '/api/me');
ok(me.s === 200, 'signed in');
ok(
  (me.h.get('content-security-policy') ?? '').includes("script-src 'self'") &&
    (me.h.get('content-security-policy') ?? '').includes("frame-ancestors 'none'"),
  'Content-Security-Policy',
);
ok(
  me.h.get('x-content-type-options') === 'nosniff' &&
    me.h.get('x-frame-options') === 'DENY' &&
    me.h.get('referrer-policy') === 'same-origin',
  'nosniff, no framing, no referrer',
);
ok(me.h.get('cache-control') === 'no-store', 'API answers are not cached');

console.log('Cross-site requests and permissions');
ok(
  (await call('POST', '/api/backups', null, { origin: 'https://evil.example' })).s === 403,
  'change from another website refused',
);
ok((await call('POST', '/api/backups', null, { origin: base })).s === 200, 'change from the app itself accepted');
const c0 = cookie;
cookie = '';
ok((await call('GET', '/api/users')).s === 401, 'not signed in: refused');
cookie = c0;

console.log('Accounts and passwords');
{
  const pub = (await call('GET', '/api/lab/public')).j;
  ok(pub.setup === null, 'set up already (an admin exists): no setup screens');
  ok((await call('POST', '/api/setup', { admin: {}, lab: {} })).s === 409, 'the setup cannot run again');
}
const photo = 'data:image/png;base64,iVBORw0KGgo=';
const askBody = {
  firstNames: 'Ana',
  surnames: 'de Souza',
  surname: 'Souza',
  email: 'ana@lab.example',
  birthDate: '1999-04-02',
  department: 'Applied Physics',
  supervisor: 'Prof. Lima',
  photo,
};
const asked = await call('POST', '/api/access-requests', askBody);
ok(
  asked.s === 200 && asked.j.username === 'anas',
  `access request: username ${asked.j.username} (first name + surname letter)`,
);
ok((await call('POST', '/api/access-requests', askBody)).s === 409, 'one waiting request per email');
const asked2 = await call('POST', '/api/access-requests', { ...askBody, firstNames: 'Ána', email: 'ana2@lab.example' });
ok(asked2.j.username === 'anaso', 'same name: the next letter of the surname, never a number');
ok((await call('POST', '/api/login/check', { username: 'anas' })).j.next === 'pending', 'waiting for an admin');
ok((await call('POST', '/api/login/check', { username: 'nobody' })).s === 404, 'unknown username: no such user');
ok(
  db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind='access'").get().n === 2,
  'admins are told about each request',
);
const reqs = (await call('GET', '/api/access-requests')).j;
const r1 = reqs.find((r) => r.username === 'anas'),
  r2 = reqs.find((r) => r.username === 'anaso');
ok((await call('POST', `/api/access-requests/${r2.id}/decline`, { reason: 'Not in the lab' })).s === 200, 'declined');
const dc = (await call('POST', '/api/login/check', { username: 'anaso' })).j;
ok(dc.next === 'declined' && dc.reason === 'Not in the lab', 'the declined person sees the reason');
ok((await call('POST', `/api/access-requests/${r1.id}/accept`, { tags: [] })).s === 200, 'accepted');
const setNext = (await call('POST', '/api/login/check', { username: 'anas' })).j;
ok(setNext.next === 'set' && setNext.hasPhoto === true, 'accepted: chooses a password (the photo sent is on file)');
ok(
  (await fetch(base + '/api/login/photo/anas')).status === 200,
  'the photo sent with the request shows on the set-password screen',
);
// the birth date alone confirms the account (no email)
const choose = (password, extra = {}) =>
  call('POST', '/api/login/set', {
    username: 'anas',
    birthDate: '1999-04-02',
    password,
    ...extra,
  });
ok((await choose('Glass-at-noon7', { birthDate: '1999-04-03' })).s === 401, 'wrong birth date: refused');
ok((await choose('Ab1!')).s === 400, 'short password refused');
ok((await choose('Glassatnoon7')).s === 400, 'password without a special character refused');
ok((await choose('glass-at-noon7')).s === 400, 'password without an upper case letter refused');
ok((await choose('Anas-glass-7')).s === 400, 'password with the username refused');
const chosen = await choose('Ação-Solar 7');
ok(chosen.s === 200 && /sid=/.test(chosen.h.get('set-cookie') ?? ''), 'accented password accepted, signed in');
ok((await call('POST', '/api/login/check', { username: 'anas' })).j.next === 'password', 'then asks for the password');
ok((await fetch(base + '/api/login/photo/anas')).status === 404, 'and the photo is no longer public');
const noPhoto = await call('POST', '/api/access-requests', {
  ...askBody,
  firstNames: 'Bea',
  email: 'bea@lab.example',
  photo: '',
});
ok(noPhoto.s === 200, 'a request without a photo is accepted (the photo is optional when asking)');
const ana = await fetch(base + '/api/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'anas', password: 'Ação-Solar 7' }), // the same, typed decomposed
});
ok(ana.status === 200, 'the same password typed with combining accents signs in');
const anaCookie = (ana.headers.get('set-cookie') ?? '').split(';')[0];
ok(
  (await fetch(base + '/api/users', { headers: { cookie: anaCookie } })).status === 403,
  'member cannot open admin pages',
);
const vis = await call('POST', '/api/users', {
  firstNames: 'Vic',
  surnames: 'Tor',
  surname: 'Tor',
  email: 'vic@guest.example',
  birthDate: '1990-01-01',
  until: '2099-12-31',
});
ok(vis.s === 200 && vis.j.username === 'vict', 'admins add visitors, with the same username rule');
ok(
  (
    await call('POST', '/api/users', {
      ...{ firstNames: 'Old', surnames: 'Visit', surname: 'Visit', email: 'o@x.example', birthDate: '1990-01-01' },
      until: '2001-01-01',
    })
  ).s === 400,
  'a visit that already ended is refused',
);
const vNo = await call('POST', '/api/login/set', {
  username: 'vict',
  birthDate: '1990-01-01',
  password: 'Visit-2099!',
});
ok(vNo.s === 400 && /photo/.test(vNo.j.error), 'without a photo on file, the first password asks for one');
const vset = await call('POST', '/api/login/set', {
  username: 'vict',
  birthDate: '1990-01-01',
  photo,
  password: 'Visit-2099!',
});
ok(vset.s === 200, 'visitor chooses a password, with a photo');
ok((await call('PATCH', '/api/users/' + vis.j.id, { resetPassword: true })).s === 200, 'admin resets a password');
ok(
  (await call('POST', '/api/login/check', { username: 'vict' })).j.next === 'set',
  'after a reset the person chooses a new one',
);
db.prepare("UPDATE users SET visitor_until='2001-01-01' WHERE id=?").run(vis.j.id);
ok((await call('POST', '/api/login/check', { username: 'vict' })).j.next === 'ended', 'an ended visit is told apart');
for (let i = 0; i < 5; i++) await call('POST', '/api/login', { username: 'anas', password: 'nope' + i });
ok(
  (await call('POST', '/api/login', { username: 'anas', password: 'Ação-Solar 7' })).s === 429,
  'sign-in paused after 5 failures',
);

console.log('Backups');
const b = await call('POST', '/api/backups');
ok(b.s === 200, 'backup made');
const bl = await call('GET', '/api/backups');
ok(bl.j.check?.ok === true, `backup checked: ${bl.j.check?.msg}`);
const mirror = join(tmp, 'second');
(await import('node:fs')).mkdirSync(mirror);
const m = await call('PUT', '/api/backups/mirror', { dir: mirror, encrypt: true });
ok(m.j.last?.ok === true && /encrypted and checked/.test(m.j.last.msg), `second copy: ${m.j.last?.msg}`);
const encs = readdirSync(mirror).filter((f) => f.endsWith('.db.enc'));
ok(
  encs.length > 0 && !readFileSync(join(mirror, encs[0])).includes(Buffer.from('SQLite format')),
  'second copy is encrypted (no readable database inside)',
);
const k = await call('GET', '/api/backups/key');
ok(/^[0-9a-f]{64}$/.test(k.j.key), 'backup key shown to admins');
rmSync(env.BACKUP_DIR, { recursive: true, force: true });
const out = execFileSync(process.execPath, ['db-tools.cjs', 'decrypt', join(mirror, encs[0]), k.j.key], {
  cwd: join(root, 'apps/server'),
  env: { ...env, CONFIG_DIR: join(tmp, 'nokey') },
}).toString();
ok(
  /Decrypted/.test(out) && existsSync(join(env.BACKUP_DIR, encs[0].replace(/\.enc$/, ''))),
  'encrypted copy restores with the key',
);
let wrong = '';
try {
  execFileSync(process.execPath, ['db-tools.cjs', 'decrypt', join(mirror, encs[0]), 'ab'.repeat(32)], {
    cwd: join(root, 'apps/server'),
    env: { ...env, BACKUP_DIR: join(tmp, 'b2'), CONFIG_DIR: join(tmp, 'nokey') },
  });
} catch (e) {
  wrong = e.stdout.toString();
}
ok(/Wrong key/.test(wrong), 'wrong key refused');

console.log('Activity log');
const a = await call('GET', '/api/audit');
const acts = a.j.rows.map((r) => r.action);
ok(
  acts.includes('Signed in') &&
    acts.includes('Failed sign-in') &&
    acts.includes('Chose a password (first sign-in)') &&
    acts.some((x) => x.startsWith('Accepted the access request')) &&
    acts.includes('Made a backup') &&
    acts.includes('Viewed the backup key'),
  'sign-ins, changes and sensitive reads logged',
);
ok(
  acts.some((x) => x.startsWith('Refused')),
  'refused requests logged',
);
ok(!JSON.stringify(a.j).includes('Solar 7'), 'no passwords in the log');
ok((await call('GET', '/api/audit/verify')).j.ok === true, 'log chain intact');
db.prepare("UPDATE audit SET username='someone' WHERE id=2").run();
const v = (await call('GET', '/api/audit/verify')).j;
ok(v.ok === false && v.brokenAt?.id === 2, 'edited log entry detected');

console.log('Live updates');
{
  const ac = new AbortController();
  const es = await fetch(base + '/api/events', { headers: { cookie }, signal: ac.signal });
  ok(
    es.status === 200 && (es.headers.get('content-type') ?? '').startsWith('text/event-stream'),
    'event stream opens for a signed-in user',
  );
  const reader = es.body.getReader(),
    dec = new TextDecoder();
  let got = '';
  const wait = (async () => {
    for (let i = 0; i < 20 && !got.includes('"topics"'); i++) {
      const { value, done } = await reader.read();
      if (done) break;
      got += dec.decode(value);
    }
  })();
  await call('POST', '/api/tags', { name: 'live-test', kind: 'label' }, { 'x-tab': 'other-tab' });
  await Promise.race([wait, new Promise((r) => setTimeout(r, 3000))]);
  ok(
    /"topics":\["users"\]/.test(got) && got.includes('"tab":"other-tab"'),
    'a change is announced to open pages, without its data',
  );
  ac.abort();
  const anon = await fetch(base + '/api/events');
  ok(anon.status === 401, 'no event stream without signing in');
}

if (DEV) {
  console.log('Measurements and comparisons');
  // a diode-like cell: the quick check sweep (0.05 V, forward only) is better than the real measurement (0.02 V, both ways),
  // so it would be "best" if it were counted
  const cell = (step, jsc, sample = 'Batch_ref') => {
    const V = [];
    for (let v = 0; v <= 1.15 + 1e-9; v += step) V.push(+v.toFixed(3));
    return { V, J: V.map((v) => jsc - 1e-10 * (Math.exp(v / 0.04) - 1)), sample };
  };
  const curve = (c, scan, dir, substrate = '1') => ({
    file: `${c.sample}_${substrate}_${scan}`,
    sample: c.sample,
    substrate,
    scan,
    pixel: '1',
    dir,
    area: 0.1,
    pin: 100,
    V: dir === 'rev' ? [...c.V].reverse() : c.V,
    J: dir === 'rev' ? [...c.J].reverse() : c.J,
  });
  const quick = cell(0.05, 30),
    real = cell(0.02, 22),
    mod = cell(0.02, 24, 'Batch_mod');
  const r = await call('POST', '/api/iv', {
    name: 'smoke J-V',
    date: '2026-11-06',
    system: 'csv',
    visibility: 'shared',
    curves: [
      curve(quick, '01', 'fwd'),
      curve(real, '02', 'fwd'),
      curve(real, '02', 'rev'),
      curve(mod, '01', 'fwd', '2'),
      curve(mod, '01', 'rev', '2'),
    ],
  });
  ok(r.s === 200, 'measurement imported');
  const full = (await call('GET', '/api/iv/' + r.j.id)).j;
  const kinds = Object.fromEntries(full.curves.map((c) => [`${c.substrate}|${c.scan}|${c.dir}`, c.kind]));
  ok(
    kinds['1|01|fwd'] === 'check' && !kinds['1|02|fwd'] && !kinds['2|01|fwd'],
    'quick scan before the real one is a check sweep',
  );
  const pce = (f) => Math.max(...full.curves.filter(f).map((c) => c.m.pce));
  ok(
    full.best === pce((c) => c.kind !== 'check') && full.best < pce((c) => c.kind === 'check'),
    'a check sweep never gives the best PCE',
  );
  const devs = (await call('GET', '/api/comparisons/devices')).j;
  ok(devs.length === 2 && devs.every((d) => d.pixels === 1), 'devices to compare listed, check sweeps not counted');
  const cmp = await call('POST', '/api/comparisons', {
    name: 'smoke comparison',
    data: {
      groups: [{ id: 'a', name: 'ref', ref: true, members: [{ set: r.j.id, sample: 'Batch_ref', substrate: '1' }] }],
    },
  });
  ok(cmp.s === 200, 'comparison saved');
  const asAna = (path, method = 'GET', body) =>
    fetch(base + path, {
      method,
      headers: { cookie: anaCookie, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  ok((await asAna('/api/comparisons/' + cmp.j.id)).status === 404, 'a comparison is private by default');
  await call('PATCH', '/api/comparisons/' + cmp.j.id, { visibility: 'shared' });
  ok((await asAna('/api/comparisons/' + cmp.j.id)).status === 200, 'shared comparison readable by others');
  ok(
    (await asAna('/api/comparisons/' + cmp.j.id, 'PATCH', { name: 'mine now' })).status === 403,
    'but only its owner (or an admin) can change it',
  );
  ok((await call('DELETE', '/api/comparisons/' + cmp.j.id)).s === 200, 'comparison moved to the trash');
  ok(
    (await call('GET', '/api/trash')).j.items.some((i) => i.kind === 'cmp' && i.id === cmp.j.id),
    'and listed there, to restore',
  );

  // a pixel that works forward but shorts backward is a shorted pixel: neither scan counts
  {
    const good = cell(0.02, 22, 'Shorty'),
      bad = { ...good, J: good.V.map((v) => 20 - 100 * v) }; // Voc 0.2 V: shorted
    const sr = await call('POST', '/api/iv', {
      name: 'smoke short',
      date: '2026-11-09',
      system: 'csv',
      visibility: 'shared',
      curves: [
        curve(good, '01', 'fwd'),
        curve(bad, '01', 'rev'),
        curve(good, '01', 'fwd', '2'),
        curve(good, '01', 'rev', '2'),
      ],
    });
    const sc = (await call('GET', '/api/iv/' + sr.j.id)).j.curves;
    const st = (sub, dir) => sc.find((c) => c.substrate === sub && c.dir === dir).m;
    ok(
      st('1', 'fwd').status === 'short' && st('1', 'fwd').shortBy === 'pixel' && st('1', 'rev').status === 'short',
      'a pixel shorted backward counts as shorted forward too',
    );
    ok(st('2', 'fwd').status === 'ok' && st('2', 'rev').status === 'ok', 'a pixel working both ways stays working');
    await call('DELETE', '/api/iv/' + sr.j.id);
  }

  // a lifetime run: the same pixel read three times; only the first reading counts (here the later ones are better, so they
  // would be the best if they were counted)
  const age = (k) => ({
    ...curve(cell(0.02, 22 + 4 * k, 'Aged_cell'), String(k + 1).padStart(4, '0'), 'rev'),
    t: k * 60,
  });
  const life = await call('POST', '/api/iv', {
    name: 'smoke lifetime',
    date: '2026-11-05',
    system: 'csv',
    visibility: 'shared',
    kind: 'lifetime',
    life: {
      run: 'aged',
      start: '2026-11-05T19:44:57',
      settings: { 'Interval (mins)': '1' },
      times: [0, 60, 120],
      light: [],
      sensors: false,
    },
    curves: [age(0), age(1), age(2)],
  });
  ok(life.s === 200, 'lifetime run imported');
  const lf = (await call('GET', '/api/iv/' + life.j.id)).j;
  ok(lf.kind === 'lifetime' && lf.lifeRun?.run === 'aged', 'it is kept as a lifetime run, with its settings');
  ok(
    lf.curves.map((c) => [c.t, c.kind ?? null].join()).join(';') === '0,;60,life;120,life',
    'later readings are marked as ageing, with their times',
  );
  ok(Math.abs(lf.best - lf.curves.find((c) => c.t === 0).m.pce) < 1e-9, 'best PCE is the first reading');
  const lsum = (await call('GET', '/api/iv')).j.find((s) => s.id === life.j.id);
  ok(
    lsum?.kind === 'lifetime' && lsum.life?.points === 3 && lsum.life.span === 120,
    'listed with its readings and span',
  );
  ok(lf.measuredAt?.startsWith('2026-11-05'), 'measured when the run started');
}

if (DEV) {
  console.log('Calendar: shortest booking and cleanup');
  const b = await call('POST', '/api/batches', {
    name: 'Smoke calendar',
    visibility: 'shared',
    stack: { arch: 'n-i-p', sl: [] },
  });
  ok(b.s === 200, 'batch for bookings made');
  const eq = await call('POST', '/api/equipment', { name: 'Smoke box', cleanup: 20 });
  const plain = await call('POST', '/api/equipment', { name: 'Smoke profilometer' });
  const eqs = (await call('GET', '/api/calendar?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z')).j.equipment;
  ok(
    eqs.find((e) => e.id === eq.j.id)?.cleanup === 20 && eqs.find((e) => e.id === plain.j.id)?.cleanup === 0,
    'cleanup is set per equipment (none unless given)',
  );
  const book = (equipment_id, s, e) =>
    call('POST', '/api/bookings', {
      equipment_id,
      batch_id: b.j.id,
      start: `2030-03-04T${s}:00.000Z`,
      end: `2030-03-04T${e}:00.000Z`,
    });
  ok((await book(eq.j.id, '10:00', '10:30')).s === 400, 'a booking shorter than 1 hour is refused');
  ok((await book(eq.j.id, '10:00', '11:00')).s === 200, 'a 1-hour booking is accepted');
  ok((await book(eq.j.id, '11:10', '12:10')).s === 409, 'nobody can book during the cleanup after it');
  ok((await book(eq.j.id, '08:45', '09:45')).s === 409, 'nor end so late that their own cleanup runs into it');
  ok((await book(eq.j.id, '11:20', '12:20')).s === 200, 'right after the cleanup is fine');
  ok((await book(plain.j.id, '11:00', '12:00')).s === 200, 'equipment without cleanup can be booked back to back');
  ok((await book(plain.j.id, '12:00', '13:00')).s === 200, '(second booking)');
  const order = eqs.map((e) => e.id).reverse();
  ok((await call('PUT', '/api/equipment/order', { ids: order })).s === 200, 'equipment reordered (admin)');
  const after = (await call('GET', '/api/calendar?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z')).j.equipment;
  ok(after.map((e) => e.id).join() === order.join(), 'the calendar lists equipment in the new order');
  ok((await call('PATCH', '/api/equipment/' + eq.j.id, { art: 'glovebox' })).s === 200, 'equipment drawing chosen');
  ok((await call('PATCH', '/api/equipment/' + eq.j.id, { art: 'rocket' })).s === 400, 'unknown drawing refused');
  const withArt = (await call('GET', '/api/calendar?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z')).j.equipment;
  ok(withArt.find((e) => e.id === eq.j.id)?.art === 'glovebox', 'the calendar sends the drawing');
  const bl = (await call('GET', '/api/batches')).j.find((x) => x.id === b.j.id);
  ok(bl.steps === 4 && bl.concluded === 0, 'batch progress counts its booked steps and concluded ones');
  const box = await call('POST', '/api/inventory/containers', {
    name: 'Smoke salt',
    amount: 5,
    size: 10,
    unit: 'g',
    lot: 'L-7',
  });
  ok(
    (await call('GET', '/api/search?q=L-7')).j.hits.some(
      (h) => h.key === 'container:' + box.j.id && h.label === 'Smoke salt, lot L-7' && h.link.view === 'chem',
    ),
    'search also looks in containers (by lot)',
  );
  // working hours (local time of the computer that runs the app): Monday to Friday 08–18 unless set otherwise
  const at = (d, h) => new Date(2030, 2, d, h).toISOString();
  const bookAt = (d, h) =>
    call('POST', '/api/bookings', { equipment_id: plain.j.id, batch_id: b.j.id, start: at(d, h), end: at(d, h + 1) });
  ok((await bookAt(11, 9)).j.offHours === false, 'a booking in working hours is just booked');
  const sun = await bookAt(10, 3);
  ok(sun.s === 200 && sun.j.offHours === true, 'a booking outside working hours is allowed, and flagged');
  const hours = Array.from({ length: 7 }, (_, i) => ({ on: true, from: i === 6 ? '02:00' : '08:00', to: '18:00' }));
  ok((await call('PUT', '/api/lab', { hours })).s === 200, 'working days and hours set (Sundays too)');
  ok((await bookAt(10, 5)).j.offHours === false, 'then a Sunday booking in the hours is not flagged');
  const memberBook = await fetch(base + '/api/bookings', {
    method: 'POST',
    headers: { cookie: anaCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ equipment_id: plain.j.id, batch_id: b.j.id, start: at(12, 22), end: at(12, 23) }),
  });
  ok(memberBook.status !== 500, '(a member books at night)');
  ok(
    (await call('GET', '/api/lab/birthdays')).j.some((x) => x.md === '04-02'),
    'birthdays for the calendar: day and month',
  );

  // a batch is not Done while a block of its plan is not booked and answered
  {
    const pb = await call('POST', '/api/batches', {
      name: 'Smoke plan',
      visibility: 'shared',
      stack: { arch: 'n-i-p', sl: [] },
    });
    ok((await call('PUT', `/api/batches/${pb.j.id}/plan`, { steps: ['Spin', 'Metal'] })).s === 200, 'the plan is kept');
    const me0 = (await call('GET', '/api/me')).j.id;
    const kid = db
      .prepare(
        "INSERT INTO bookings(equipment_id,subject,subject_id,user_id,step,start,end) VALUES(?,'batch',?,?,'Spin','2026-01-05T09:00:00.000Z','2026-01-05T10:00:00.000Z')",
      )
      .run(plain.j.id, pb.j.id, me0).lastInsertRowid;
    ok((await call('POST', `/api/bookings/${kid}/outcome`, { outcome: 'done' })).s === 200, 'one step concluded');
    const st = db.prepare('SELECT status FROM batches WHERE id=?').get(pb.j.id).status;
    ok(st !== 'done', `with a block still unplaced the batch stays ${st}, not Done`);
  }
  // bookings start from now on
  const ago = new Date(Date.now() - 2 * 3.6e6).toISOString(),
    soon = new Date(Date.now() + 3.6e6).toISOString();
  const pastB = await call('POST', '/api/bookings', {
    equipment_id: plain.j.id,
    purpose: 'Late',
    start: ago,
    end: soon,
  });
  ok(pastB.s === 400 && /passed/.test(pastB.j.error), 'a booking cannot start in the past');
  // outside a batch: allowed with a purpose
  const free = (body) =>
    call('POST', '/api/bookings', { equipment_id: plain.j.id, start: at(13, 9), end: at(13, 10), ...body });
  ok((await free({})).s === 400, 'a booking outside a batch needs to say what it is for');
  const fr = await free({ purpose: 'Testing a new holder' });
  ok(fr.s === 200, 'with a purpose it is booked');
  const listed = (await call('GET', `/api/calendar?from=${at(13, 0)}&to=${at(14, 0)}`)).j.bookings;
  ok(
    listed.some(
      (k) => k.id === fr.j.id && k.subject === '' && k.subject_id === null && k.purpose === 'Testing a new holder',
    ),
    'and listed with it',
  );
  // the solar simulator (J–V measurement): a finished batch or a reason
  const sim = await call('POST', '/api/equipment', { name: 'Smoke solar simulator', role: 'measure' });
  const simBook = (body) =>
    call('POST', '/api/bookings', { equipment_id: sim.j.id, start: at(14, 9), end: at(14, 10), ...body });
  ok((await simBook({ batch_id: b.j.id })).s === 400, 'the solar simulator refuses a batch that is not finished');
  ok((await simBook({})).s === 400, 'and a booking without a batch or a reason');
  ok((await simBook({ purpose: 'Lamp calibration' })).s === 200, 'a reason is enough');
  db.prepare("UPDATE batches SET status='done', done_at='2020-01-01T00:00:00Z' WHERE id=?").run(b.j.id);
  const stepsBefore = (await call('GET', '/api/batches')).j.find((x) => x.id === b.j.id).steps;
  const simDone = await call('POST', '/api/bookings', {
    equipment_id: sim.j.id,
    batch_id: b.j.id,
    start: at(15, 9),
    end: at(15, 10),
  });
  ok(simDone.s === 200, 'a finished (even locked) batch can be measured');
  ok(
    (await call('GET', '/api/bookings/pending')).j.every((k) => k.subject === 'batch' && k.equipment_id !== sim.j.id),
    'no outcome is asked for bookings outside a batch nor for measurements',
  );
  const bl2 = (await call('GET', '/api/batches')).j.find((x) => x.id === b.j.id);
  ok(bl2.steps === stepsBefore, 'measurements do not count as fabrication steps');
  ok((await call('DELETE', '/api/bookings/' + simDone.j.id)).s === 200, 'and its booking can be removed');
}

if (DEV) {
  console.log('Batches: variants, lock, mentions');
  const sl = [
    { n: 'Substrate', m: 'Substrate', a: '', b: '', t: '' },
    { n: 'Perovskite', m: 'Spin', a: '', b: '', t: '' },
    { n: 'BCP', m: 'Organic evap', a: '', b: '', t: '' },
  ];
  const b = await call('POST', '/api/batches', {
    name: 'Smoke variants',
    visibility: 'shared',
    stack: { arch: 'p-i-n', sl },
  });
  const put = (list) => call('PUT', `/api/batches/${b.j.id}/variants`, { control: '1 to 4', list });
  ok((await put([{ id: 'A', name: 'Empty' }])).s === 400, 'a variant without a stack or changes is refused');
  ok(
    (await put([{ id: 'A', name: 'Far', changes: [{ t: 'remove', slot: 7 }] }])).s === 400,
    'a change on a layer the batch does not have is refused',
  );
  const v = await put([
    {
      id: 'A',
      name: '5 % MACl',
      substrates: '5 to 8',
      changes: [
        { t: 'additive', slot: 1, name: 'MACl', amount: '5 %' },
        { t: 'remove', slot: 2 },
      ],
    },
  ]);
  ok(v.s === 200 && v.j.list[0].changes.length === 2, 'variant saved');
  const got = (await call('GET', '/api/batches/' + b.j.id)).j;
  ok(got.variants.control === '1 to 4' && got.variants.list[0].name === '5 % MACl', 'variants come with the batch');
  ok((await call('GET', '/api/batches')).j.find((x) => x.id === b.j.id).variants[0].id === 'A', 'list names them');

  // lock: done more than 14 days ago
  db.prepare("UPDATE batches SET status='done', done_at='2020-01-01T00:00:00Z' WHERE id=?").run(b.j.id);
  ok((await call('PATCH', '/api/batches/' + b.j.id, { name: 'x' })).s === 423, 'a finished batch locks by itself');
  ok((await put([])).s === 423, 'variants of a locked batch cannot change');
  ok((await call('DELETE', '/api/batches/' + b.j.id)).s === 423, 'a locked batch cannot go to the trash');
  ok((await call('PATCH', '/api/batches/' + b.j.id, { visibility: 'private' })).s === 200, 'sharing stays open');
  ok((await call('POST', `/api/batches/${b.j.id}/unlock`, {})).s === 200, 'admin unlocks');
  ok((await call('PATCH', '/api/batches/' + b.j.id, { name: 'unlocked' })).s === 200, 'unlocked batch can change');
  ok((await call('POST', `/api/batches/${b.j.id}/lock`, {})).s === 200, 'admin locks again');
  ok((await call('GET', '/api/batches/' + b.j.id)).j.lock.locked, 'locked again');
  ok(
    db.prepare("SELECT COUNT(*) n FROM audit WHERE action='Unlocked a finished batch'").get().n === 1,
    'unlocking is in the activity log',
  );

  // @mentions: ana is told; a name that is no user is ignored
  await call('PATCH', '/api/batches/' + b.j.id, { visibility: 'shared' });
  const ana = db.prepare("SELECT id FROM users WHERE username='anas'").get().id;
  const c = await call('POST', `/api/comments/batch/${b.j.id}`, { text: 'Look at this @anas, and @nobody.' });
  ok(c.s === 200, 'comment with mentions saved');
  ok(
    db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind='mention' AND user_id=?").get(ana).n === 1,
    'the person mentioned is notified',
  );
  const people = (await call('GET', `/api/comments/batch/${b.j.id}/people`)).j;
  ok(people.some((p) => p.username === 'anas') && people.some((p) => p.me), 'people who can open it are offered');
}

if (DEV) {
  console.log('Batches by name, equipment, training, atmosphere and overviews (0.38)');
  const stack = { arch: 'n-i-p', sl: [] };
  const n1 = await call('POST', '/api/batches', { name: 'Smoke named', visibility: 'shared', stack });
  ok(n1.s === 200, 'a batch is started by name');
  const twin = await call('POST', '/api/batches', { name: 'smoke NAMED ', visibility: 'shared', stack });
  ok(twin.s === 409 && /another batch has this name/.test(twin.j.error), 'names tell batches apart (0.45: no codes)');
  ok(
    (await call('POST', '/api/batches', { name: ' ', visibility: 'shared', stack })).s === 400,
    'a batch needs a name',
  );
  const n2 = await call('POST', '/api/batches', { name: 'Smoke named 2', visibility: 'shared', stack });
  ok((await call('PATCH', '/api/batches/' + n2.j.id, { name: 'Smoke Named' })).s === 409, 'nor renamed to one in use');
  ok(
    (await call('PATCH', '/api/batches/' + n2.j.id, { name: ' Smoke renamed ' })).s === 200 &&
      (await call('GET', '/api/batches/' + n2.j.id)).j.name === 'Smoke renamed',
    'renamed',
  );
  ok(
    (await call('GET', '/api/search?q=Smoke renamed')).j.hits.some(
      (h) => h.key === 'batch:' + n2.j.id && h.label === 'Smoke renamed',
    ),
    'search finds a batch by its name and shows only the name',
  );
  ok(
    (await call('PUT', `/api/batches/${n1.j.id}/plan`, { steps: ['Spin', 'Spin anneal'], split: ['s1'] })).s === 200 &&
      (await call('GET', '/api/batches/' + n1.j.id)).j.plan_split === '["s1"]',
    'the runs annealed elsewhere are kept with the plan',
  );

  // equipment: a place, a glovebox that records its atmosphere, and a spin coater inside it
  const asAna = async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { cookie: anaCookie, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { s: r.status, j: await r.json().catch(() => null) };
  };
  const anaId = db.prepare("SELECT id FROM users WHERE username='anas'").get().id;
  const place = await call('POST', '/api/places', { name: 'Smoke room' });
  ok(place.s === 200, 'a place is added');
  const gb = await call('POST', '/api/equipment', { name: 'Smoke glovebox', place_id: place.j.id, atmosphere: true });
  const sc = await call('POST', '/api/equipment', { name: 'Smoke spin coater', parent_id: gb.j.id, steps: ['spin'] });
  ok(gb.s === 200 && sc.s === 200, 'a glovebox and the spin coater inside it are added');
  ok((await asAna('POST', '/api/equipment', { name: 'Mine' })).s === 403, 'members cannot add equipment');
  const at = (d, h) => new Date(2031, 0, d, h).toISOString();
  const book = (who, eq, d, h) =>
    who('POST', '/api/bookings', { equipment_id: eq, purpose: 'Smoke test', start: at(d, h), end: at(d, h + 1) });
  ok((await book(call, sc.j.id, 6, 9)).s === 403, 'what is inside a glovebox is booked with it, not on its own');
  const untrained = await book(asAna, gb.j.id, 6, 9);
  ok(untrained.s === 403 && /trained/.test(untrained.j.error), 'booking needs training on the equipment');
  ok((await call('POST', `/api/equipment/${gb.j.id}/training/${anaId}`)).s === 200, 'an admin records the training');
  ok((await book(asAna, gb.j.id, 6, 9)).s === 200, 'then the trained member books it');
  const off = await call('POST', `/api/equipment/${gb.j.id}/off`, {
    start: at(7, 0),
    end: at(8, 0),
    reason: 'Regeneration',
  });
  ok(off.s === 200, 'an out-of-service period is set');
  ok((await book(asAna, gb.j.id, 7, 10)).s === 409, 'no bookings while it is out of service');
  ok((await call('DELETE', '/api/equipment/off/' + off.j.id)).s === 200, 'and it can be removed');
  ok((await book(asAna, gb.j.id, 7, 10)).s === 200, 'then the time can be booked');
  // atmosphere: a step done in the glovebox asks for its O₂ and H₂O
  const kid = db
    .prepare(
      "INSERT INTO bookings(equipment_id,subject,subject_id,user_id,step,start,end) VALUES(?,'batch',?,?,'Spin','2026-01-05T09:00:00.000Z','2026-01-05T10:00:00.000Z')",
    )
    .run(gb.j.id, n2.j.id, (await call('GET', '/api/me')).j.id).lastInsertRowid;
  ok((await call('POST', `/api/bookings/${kid}/outcome`, { outcome: 'done' })).s === 400, 'done needs the atmosphere');
  ok(
    (await call('POST', `/api/bookings/${kid}/outcome`, { outcome: 'done', atmo: { o2: 0.4, h2o: 0.2 } })).s === 200,
    'with O₂ and H₂O in ppm it is done',
  );

  // overviews: everyone has their own; the Lab overview permission opens the lab
  const per = 'from=2026-01-05T00:00:00.000Z&to=2026-01-12T00:00:00.000Z&unit=week';
  ok((await asAna('GET', '/api/dashboard/scopes')).j.lab === false, 'a member sees no lab scope');
  const mine = await asAna('GET', `/api/dashboard?${per}&scope=me`);
  ok(mine.s === 200 && mine.j.scope === 'one', 'a member opens their own overview');
  ok((await asAna('GET', `/api/dashboard?${per}&scope=lab`)).s === 403, 'but not the lab’s');
  ok((await asAna('GET', '/api/dashboard/person/1')).s === 403, 'nor someone else’s page');
  const labView = (await call('GET', `/api/dashboard?${per}&scope=lab`)).j;
  ok(labView.scope === 'lab', 'an admin opens the lab');
  ok(
    labView.m.devices.lab && labView.people.every((p) => p.m.devices && typeof p.hours === 'number'),
    'the overview has the core’s numbers and the Electronic Devices part (for the period and each person)',
  );
  const tag = await call('POST', '/api/tags', { name: 'Smoke overview', perms: ['overview'] });
  ok((await call('PUT', `/api/users/${anaId}/tags`, { tags: [tag.j.id] })).s === 200, 'a tag with Lab overview given');
  ok((await asAna('GET', `/api/dashboard?${per}&scope=lab`)).s === 200, 'then the member opens the lab overview');
  await call('PUT', `/api/users/${anaId}/tags`, { tags: [] });
}

console.log('Updates');
ok(
  (await call('POST', '/api/updates/check')).j.error?.includes('token'),
  'repository refused without a token: clear message',
);
const u = await call('PUT', '/api/updates/settings', { token: 'test-token' });
ok(u.j.tokenSet && u.j.available && u.j.latest?.version === '99.0.0', 'new version found with the token');
ok(!JSON.stringify(u.j).includes('test-token'), 'token never sent back to the browser');
ok(!readFileSync(env.DB_PATH).includes(Buffer.from('test-token')), 'token not stored in the database');
sum = 'f'.repeat(64);
ok((await call('POST', '/api/updates/download')).s === 400, 'download with a wrong checksum refused');
sum = good;
sig = null;
await call('PUT', '/api/updates/settings', {}); // reads the release again, without telling the admins
const unsigned = await call('POST', '/api/updates/download');
ok(unsigned.s === 400 && /not signed/.test(unsigned.j.error), 'a release with no signature is refused');
sig = sign(null, zip, generateKeyPairSync('ed25519').privateKey).toString('base64');
await call('PUT', '/api/updates/settings', {}); // reads the release again, without telling the admins
const forged = await call('POST', '/api/updates/download');
ok(forged.s === 400 && /signature/.test(forged.j.error), 'a release signed with another key is refused');
sig = goodSig;
await call('PUT', '/api/updates/settings', {}); // reads the release again, without telling the admins
const d = await call('POST', '/api/updates/download');
ok(d.s === 200 && d.j.downloaded?.version === '99.0.0', 'download checked against its checksum and signature');
ok(
  readFileSync(join(root, 'release.pub'), 'utf8').replace(/\s/g, '') ===
    readFileSync(join(root, 'apps/server/src/signature.ts'), 'utf8')
      .match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/)[0]
      .replace(/\s/g, ''),
  'the key in release.pub (update scripts) is the key built into the app',
);
ok(
  db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind='update'").get().n === 0,
  'no notification for a version found while saving settings',
);

console.log('Licence (0.46; tiers, no last day of updates, 0.49)');
// licences signed with the test's key, by the builder PANOPTICA's staff use, or by hand for what the builder never makes
const keys = join(tmp, 'keys');
mkdirSync(keys, { recursive: true });
writeFileSync(join(keys, 'key.pem'), testKey.privateKey.export({ type: 'pkcs8', format: 'pem' }));
writeFileSync(join(keys, 'pub.pem'), env.UPDATE_PUBLIC_KEY);
const built = (...a) => {
  const o = mkdtempSync(join(tmp, 'lab-'));
  execFileSync(
    process.execPath,
    [
      join(root, 'tools/builder/builder.mjs'),
      '--key',
      join(keys, 'key.pem'),
      '--pub',
      join(keys, 'pub.pem'),
      '--out',
      o,
      ...a,
    ],
    { stdio: 'pipe' },
  );
  const d = join(o, readdirSync(o)[0]);
  return {
    text: readFileSync(join(d, 'licence.json'), 'utf8'),
    sheet: readFileSync(join(d, 'install-sheet.md'), 'utf8'),
  };
};
const byHand = (l) => {
  const body = JSON.stringify({ v: 1, issued: '2026-11-13', ...l });
  return JSON.stringify({ body, sig: sign(null, Buffer.from(body), testKey.privateKey).toString('base64') });
};
{
  const own = (mods) => `panoptica-${[...mods].sort().join('+') || 'core'}.zip`,
    names = ['panoptica.zip', 'panoptica-devices.zip', 'panoptica-core.zip'],
    running = (await call('GET', '/api/version')).j.modules;
  // without a licence: the package for the modules it has, else the one with every module
  const pick = (mods) => (names.includes(own(mods)) ? names.indexOf(own(mods)) : 0) * 10 + 11;
  ok(
    fetched.includes(pick(running)),
    `the update was the package for its modules (${own(running)}, else panoptica.zip)`,
  );
  ok((await call('GET', '/api/licence')).j.licence === null, 'no licence: every module in the package runs');
  const first = built(
    '--lab',
    'Smoke Laboratory',
    '--acronym',
    'SL',
    '--modules',
    'devices',
    '--tier',
    '1',
    '--no-setup',
  );
  const body1 = JSON.parse(JSON.parse(first.text).body);
  ok(
    body1.tier === 1 && body1.users === 10 && body1.acronym === 'SL' && !('updatesUntil' in body1),
    'the builder writes the tier, its number of people and the acronym; no last day of updates',
  );
  const forged = JSON.parse(first.text);
  forged.body = forged.body.replace('"users": 10', '"users": 1000');
  ok(
    /not signed/.test((await call('POST', '/api/licence', { text: JSON.stringify(forged) })).j.error),
    'a licence changed after PANOPTICA signed it is refused',
  );
  ok(
    /not signed/.test(
      (
        await call('POST', '/api/licence', {
          text: byHand({ id: 'L-x', lab: 'x', labId: 'x', modules: [] }).replace(/"sig":"[^"]+/, '"sig":"' + goodSig),
        })
      ).j.error,
    ),
    'and one signed by anyone else',
  );
  ok(
    (await call('POST', '/api/licence', { text: first.text }, { 'x-test-remote': '1' })).s === 403 &&
      (await call('GET', '/api/licence', undefined, { 'x-test-remote': '1' })).j.here === false,
    'the licence file is chosen only on the computer that runs PANOPTICA',
  );
  const i1 = await call('POST', '/api/licence', { text: first.text });
  ok(
    i1.s === 200 &&
      i1.j.licence.lab === 'Smoke Laboratory' &&
      i1.j.licence.acronym === 'SL' &&
      i1.j.labId === body1.labId &&
      i1.j.state === 'ok' &&
      !i1.j.critical &&
      i1.j.here === true &&
      !('setup' in i1.j.licence && i1.j.licence.setup),
    'the builder’s licence is installed for its lab',
  );
  const u1 = await call('PUT', '/api/updates/settings', {});
  ok(u1.j.available && !('beyondLicence' in u1.j), 'updates are free: the newer release is offered');
  ok(
    readFileSync(join(root, 'tools/builder/builder.mjs'), 'utf8').includes('--tier') &&
      /tier 3 needs the number/.test(
        (() => {
          try {
            built('--lab', 'Big Lab', '--modules', 'devices', '--tier', '3');
            return '';
          } catch (e) {
            return String(e.stderr);
          }
        })(),
      ),
    'tier 3 needs the number of people agreed with the lab',
  );
  const other = built('--lab', 'Another Lab', '--modules', 'devices', '--tier', '2', '--no-setup');
  ok(
    /another lab/.test((await call('POST', '/api/licence', { text: other.text })).j.error),
    'a licence for another lab is refused',
  );
  const renewed = built(
    '--lab',
    'Smoke Laboratory',
    '--lab-id',
    body1.labId,
    '--modules',
    'devices',
    '--tier',
    '2',
    '--no-setup',
  );
  ok((await call('POST', '/api/licence', { text: renewed.text })).s === 200, 'a renewal for the same lab is installed');
  const u2 = await call('PUT', '/api/updates/settings', {});
  ok(
    u2.j.available && u2.j.latest.zip.name === 'panoptica-devices.zip',
    'updates again, as the package for its licence’s modules',
  );
  const n0 = fetched.length;
  ok((await call('POST', '/api/updates/download')).s === 200 && fetched.slice(n0).includes(21), 'downloaded');
  ok(
    /newer licence/.test((await call('POST', '/api/licence', { text: first.text })).j.error),
    'an older licence does not replace a newer one',
  );
  ok(
    !readFileSync(env.DB_PATH).includes(Buffer.from('BEGIN PRIVATE')) && !first.text.includes('PRIVATE'),
    'no key in the licence or the database',
  );
  ok(
    /Setup code: `[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}`/.test(
      built('--lab', 'Smoke Lab', '--modules', 'devices', '--tier', '1').sheet,
    ),
    'the builder puts a setup code on the install sheet',
  );

  // the tier (0.49): at the licence's number of people, no one new is let in; everyone else keeps working
  const today = new Date().toISOString().slice(0, 10),
    tierLicence = (users) =>
      byHand({
        id: 'L-TIER-' + users,
        lab: 'Smoke Laboratory',
        labId: body1.labId,
        modules: MODULES,
        tier: 3,
        users,
        issued: today,
        made: new Date().toISOString(),
      });
  const guest = await call('POST', '/api/users', {
    firstNames: 'Tia',
    surnames: 'Guest',
    surname: 'Guest',
    email: 'tia@guest.example',
    birthDate: '1990-01-01',
    until: '2099-12-31',
  });
  await call('PATCH', `/api/users/${guest.j.id}`, { active: false });
  const active = (await call('GET', '/api/licence')).j.active;
  ok(
    (await call('POST', '/api/licence', { text: tierLicence(active) })).s === 200,
    'a licence at its number of people',
  );
  const lv = (await call('GET', '/api/licence')).j;
  ok(lv.full && lv.active === active && lv.licence.users === active, 'counts the people with a working account');
  const noVisitor = await call('POST', '/api/users', {
    firstNames: 'Una',
    surnames: 'More',
    surname: 'More',
    email: 'una@guest.example',
    birthDate: '1990-01-01',
    until: '2099-12-31',
  });
  ok(
    noVisitor.s === 402 && noVisitor.j.error === `Your licence covers ${active} people. Contact PANOPTICA to upgrade`,
    'at the limit a visitor is refused, with a note to contact PANOPTICA',
  );
  ok((await call('PATCH', `/api/users/${guest.j.id}`, { active: true })).s === 402, 'and so is enabling an account');
  let waiting = (await call('GET', '/api/access-requests')).j.find((r) => r.status === 'pending');
  if (!waiting) {
    await call('POST', '/api/access-requests', { ...askBody, firstNames: 'Ivo', email: 'ivo@lab.example' });
    waiting = (await call('GET', '/api/access-requests')).j.find((r) => r.status === 'pending');
  }
  const acc = await call('POST', `/api/access-requests/${waiting.id}/accept`, { tags: [] });
  const cnt = (await call('GET', '/api/access-requests/count')).j;
  ok(
    acc.s === 402 && cnt.n >= 1 && /covers/.test(cnt.full),
    'and accepting a request: it stays waiting, and the requests list says why',
  );
  ok((await call('GET', '/api/me')).s === 200, 'everyone who has an account keeps working');
  ok((await call('POST', '/api/licence', { text: tierLicence(active + 50) })).s === 200, 'an upgrade');
  ok(
    (await call('POST', `/api/access-requests/${waiting.id}/accept`, { tags: [] })).s === 200 &&
      (await call('PATCH', `/api/users/${guest.j.id}`, { active: true })).s === 200 &&
      (await call('GET', '/api/access-requests/count')).j.full === '',
    'after the upgrade, people are let in again',
  );
}

if (DEV) {
  console.log('Batches take their amounts from the containers (0.45)');
  const box = (b) =>
    call('POST', '/api/inventory/containers', { name: 'Smoke antisolvent', amount: 50, size: 100, unit: 'mL', ...b });
  const main = await box({ supplier: 'Main', use: true }),
    spare = await box({ supplier: 'Spare', amount: 80 });
  const left = (id) => db.prepare('SELECT amount FROM containers WHERE id=?').get(id).amount;
  // a spin program that dispenses 100 µL of antisolvent on each of 10 substrates: 1 mL
  const spin = await call('POST', '/api/presets', {
    segment: 's2',
    name: 'Smoke quench',
    visibility: 'shared',
    data: { steps: [], dp: [{ src: 'Solvent: Smoke antisolvent', v: 100, when: 'before', at: 0 }], N: 10, ov: 0 },
  });
  const tk = await call('POST', '/api/batches', {
    name: 'Smoke takes',
    visibility: 'shared',
    stack: { arch: 'n-i-p', sl: [{ n: 'Quench', m: 'Spin', a: '', b: String(spin.j.id), t: '' }] },
  });
  const snap = (await call('GET', '/api/batches/' + tk.j.id)).j.snapshot;
  ok(
    snap.takes && snap.chems.find((c) => c.name === 'Smoke antisolvent')?.bottle?.id === main.j.id,
    'a batch records the container its recipes use when it starts',
  );
  ok(left(main.j.id) === 50, 'a planned batch takes nothing yet');
  const status = (s) => call('PATCH', '/api/batches/' + tk.j.id, { status: s });
  await status('running');
  ok(left(main.j.id) === 49 && left(spare.j.id) === 80, 'running, it takes 1 mL from that container only');
  const took = (await call('GET', '/api/inventory/draws/batch/' + tk.j.id)).j;
  ok(
    took.length === 1 && took[0].container_id === main.j.id && took[0].amount === 1 && took[0].unit === 'mL',
    'what it took is recorded, in the container’s unit',
  );
  // run data: what was really dispensed replaces the plan (0.45.1), from the same container and under the same date
  const code = (await call('GET', '/api/batches/' + tk.j.id)).j.code;
  const rd = await call('POST', `/api/presets/${spin.j.id}/runs`, { batch: code, values: { 'dp:0': '150', n: '10' } });
  ok(rd.s === 200 && left(main.j.id) === 48.5, 'run data take what was dispensed instead (1.5 mL)');
  const took2 = (await call('GET', '/api/inventory/draws/batch/' + tk.j.id)).j;
  ok(
    took2.length === 1 && took2[0].basis === 'run' && took2[0].at === took[0].at,
    'marked as from run data, same date',
  );
  await call('POST', `/api/presets/${spin.j.id}/runs`, { batch: code, values: { n: '8' } });
  ok(left(main.j.id) === 48.8, 'a later entry changes only what it gives (1.2 mL for 8 substrates)');
  for (const r of (await call('GET', `/api/presets/${spin.j.id}/runs`)).j) await call('DELETE', '/api/runs/' + r.id);
  ok(left(main.j.id) === 49, 'without run data, the planned amount again');
  await status('done');
  ok(left(main.j.id) === 49, 'once: Done takes nothing more');
  const hist = (await call('GET', `/api/inventory/containers/${main.j.id}/draws`)).j;
  ok(
    hist[0]?.what === 'batch Smoke takes' && hist[0].link?.view === 'batches',
    'the container lists what took from it',
  );
  await call('DELETE', '/api/batches/' + tk.j.id);
  ok(left(main.j.id) === 50, 'a batch moved to the trash puts it back');
  ok(
    (await call('POST', `/api/trash/batch/${tk.j.id}/restore`, {})).s === 200 && left(main.j.id) === 49,
    'restored, it takes it again',
  );
  await status('planned');
  ok(left(main.j.id) === 50, 'back to Planned, it puts it back');
  await call('PUT', '/api/inventory/containers/' + main.j.id, {
    name: 'Smoke antisolvent',
    amount: 0,
    size: 100,
    unit: 'mL',
    status: 'empty',
  });
  await status('running');
  ok(left(spare.j.id) === 79, 'its container empty, it takes from the one recipes use now');
  // a batch started before 0.45 takes nothing: its containers' amounts are what people typed
  const old = db
    .prepare("INSERT INTO batches(owner_id,code,name,visibility,snapshot) VALUES(?,?,?,'shared',?)")
    .run(
      db.prepare("SELECT id FROM users WHERE username='admin'").get().id,
      'OLD-1',
      'Smoke older batch',
      JSON.stringify({ ...snap, takes: undefined }),
    ).lastInsertRowid;
  await call('PATCH', '/api/batches/' + old, { status: 'running' });
  ok(
    left(spare.j.id) === 79 && !(await call('GET', '/api/inventory/draws/batch/' + old)).j.length,
    'an older batch takes nothing',
  );
}

console.log('Database changes in order (0.40)');
{
  // the core's list and each module's (0.43): one sequence 1, 2, 3… with no gaps or repeats, each change recorded once here
  const listed = (f, owner) =>
    [...readFileSync(join(root, f), 'utf8').matchAll(/^ {4}id: (\d+),\r?\n {4}owner: '(\w+)',\r?$/gm)].map((m) => {
      if (m[2] !== owner) throw new Error(`${f}: change ${m[1]} is owned by ${m[2]}`);
      return +m[1];
    });
  const core = listed('apps/server/src/schema.ts', 'core'),
    dev = listed('modules/devices/server/src/schema.ts', 'devices'),
    ids = [...core, ...dev].sort((a, b) => a - b);
  ok(
    core.length > 20 && dev.length > 10 && ids.every((n, i) => n === i + 1),
    `changes numbered 1…${ids.length} across the core (${core.length}) and Electronic Devices (${dev.length})`,
  );
  const rec = db.prepare('SELECT id, owner FROM migrations WHERE id < 10000 ORDER BY id').all();
  ok(
    rec.length === (MODULES.includes('devices') ? ids.length : core.length) &&
      rec.every((r) => (r.owner === 'core' ? core : dev).includes(r.id)),
    'every change of the core and the loaded modules recorded once in the database, under its owner',
  );
  ok(
    rec.every((r) => r.owner === 'core' || r.owner === 'devices'),
    'each change belongs to the core or the Electronic Devices module',
  );
}

if (CORE) {
  console.log('The core alone, without Electronic Devices (0.43)');
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  ok(
    !['presets', 'batches', 'run_data', 'iv_sets', 'iv_curves', 'comparisons'].some((t) => tables.includes(t)),
    'no Electronic Devices tables in the database',
  );
  ok((await call('GET', '/api/batches')).s === 404 && (await call('GET', '/api/presets')).s === 404, 'nor its routes');
  ok((await call('GET', '/api/chemicals')).j.length === 0, 'no substances before any container');
  const box = await call('POST', '/api/inventory/containers', {
    name: 'Core salt',
    amount: 1,
    size: 2,
    unit: 'g',
    lot: 'C-1',
  });
  ok(
    (await call('GET', '/api/search?q=C-1')).j.hits.some((h) => h.key === 'container:' + box.j.id),
    'search finds containers',
  );
  const use = (await call('GET', '/api/inventory/use')).j;
  ok(
    BUILT ? use.basis.length === 0 && use.events.length === 0 : true,
    'consumption has nothing to sum without a module',
  );
  const scale = await call('POST', '/api/equipment', { name: 'Core balance', role: 'scale' });
  ok(
    scale.s === 200 && db.prepare('SELECT role, steps FROM equipment WHERE id=?').get(scale.j.id).steps === '[]',
    'equipment is added; an old procedure name means nothing without its module',
  );
  const t = (h) => new Date(Date.UTC(2032, 2, 3, h)).toISOString();
  ok(
    (await call('POST', '/api/bookings', { equipment_id: scale.j.id, purpose: 'Calibration', start: t(9), end: t(10) }))
      .s === 200,
    'a booking says what it is for',
  );
  const ov = (
    await call('GET', '/api/dashboard?from=2032-03-01T00:00:00.000Z&to=2032-03-08T00:00:00.000Z&unit=week&scope=lab')
  ).j;
  ok(
    ov.scope === 'lab' && !ov.m.devices && ov.lab.hours >= 1 && ov.equipment.some((e) => e.id === scale.j.id),
    'the Overview has the core’s people and equipment time',
  );
  await call('POST', '/api/backups');
  const chk = (await call('GET', '/api/backups')).j.check;
  ok(
    chk?.ok && /users/.test(chk.msg) && !/recipes/.test(chk.msg),
    `a backup is checked by the core alone: ${chk?.msg}`,
  );
}

console.log('Substances made from containers (0.44)');
{
  const add = (b) => call('POST', '/api/inventory/containers', { amount: 5, size: 10, unit: 'g', ...b });
  const sub = async (id) => (await call('GET', '/api/chemicals')).j.find((c) => c.id === id);
  const chemOf = (box) => db.prepare('SELECT chem_id FROM containers WHERE id=?').get(box).chem_id;
  const a = await add({ name: 'Smoke iodide', cas: '0010101-63-0', supplier: 'Acme', lot: 'A-1', purity: 99.99 });
  const id = chemOf(a.j.id);
  let s = await sub(id);
  ok(
    a.s === 200 && s?.cas === '10101-63-0',
    'a container makes its substance, with the CAS number written the usual way',
  );
  ok(s.bottle?.id === a.j.id && s.pur === 99.99 && s.brand === 'Acme', 'recipes take the purity of its only container');
  const b = await add({ name: 'PbI2 from Beta', cas: '10101-63-0', supplier: 'Beta', lot: 'B-1', purity: 99.9 });
  ok(chemOf(b.j.id) === id, 'another container with the same CAS number is of the same substance');
  ok(
    db.prepare('SELECT name FROM containers WHERE id=?').get(b.j.id).name === 'Smoke iodide',
    'and carries the substance’s name',
  );
  s = await sub(id);
  ok(s.bottles.length === 2 && s.bottle.id === b.j.id, 'with none marked, recipes use the newest container');
  ok((await call('PUT', `/api/inventory/containers/${a.j.id}/use`, { use: true })).s === 200, 'the first one marked');
  s = await sub(id);
  ok(
    s.bottle.id === a.j.id && s.pur === 99.99 && s.bottles.filter((x) => x.use).length === 1,
    'recipes use it, and only it is marked',
  );
  const c = await add({ name: 'Smoke iodide', supplier: 'Gamma', use: true });
  s = await sub(id);
  ok(chemOf(c.j.id) === id && s.bottle.id === c.j.id, 'a container added as the one recipes use takes over (by name)');
  await call('PUT', `/api/inventory/containers/${c.j.id}`, {
    name: 'Smoke iodide',
    amount: 0,
    size: 10,
    unit: 'g',
    status: 'empty',
  });
  s = await sub(id);
  ok(s.bottles.length === 2 && !s.bottles.some((x) => x.id === c.j.id), 'an empty container is no longer in stock');
  const other = await add({ name: 'Smoke iodide', cas: '7790-80-9' });
  const o = await sub(chemOf(other.j.id));
  ok(
    o.id !== id && o.name === 'Smoke iodide (7790-80-9)',
    'the same name with another CAS number is another substance',
  );
  ok(
    (
      await call('PUT', `/api/chemicals/${id}`, {
        name: 'Smoke iodide',
        cas: '10101-63-0',
        f: 'PbI2',
        M: 0,
        roles: ['metal', 'salt'],
        pf: true,
      })
    ).s === 200,
    'a substance’s identity is edited',
  );
  s = await sub(id);
  ok(
    s.M === 461.01 && s.roles.join() === 'metal,salt' && s.role === 'metal' && s.pf,
    'molar mass from the formula, roles and controls kept',
  );
  ok((await call('DELETE', `/api/chemicals/${id}`)).s === 409, 'a substance with containers cannot be deleted');
  ok(
    (await call('GET', '/api/search?q=10101-63-0')).j.hits.some(
      (h) => h.key === 'chemical:' + id && h.hint === 'Substance',
    ),
    'search finds substances by CAS number',
  );
  const imp = await call('POST', '/api/inventory/import', {
    substances: [
      {
        key: '10101-63-0',
        name: 'Lead(II) iodide',
        cas: '10101-63-0',
        f: 'PbI2',
        d: 6.16,
        mp: 402,
        ghs: ['GHS07', 'GHS08'],
      },
      { key: 'smoke solvent', name: 'Smoke solvent', f: 'C3H7NO', roles: ['solvent'], army: true },
    ],
    containers: [
      {
        key: '10101-63-0',
        amount: 25,
        size: 50,
        unit: 'g',
        lot: 'I-1',
        barcode: 'SMK-0001',
        area: 'Smoke cabinet',
        shelf: 'Top',
      },
      { key: 'smoke solvent', amount: 1, size: 1, unit: 'L', area: 'Smoke cabinet' },
      { key: 'nobody', amount: 1, size: 1 },
    ],
  });
  ok(imp.s === 200 && imp.j.imported === 2 && imp.j.substances === 2, 'an import: substances, then their containers');
  s = await sub(id);
  ok(
    s.name === 'Smoke iodide' &&
      s.d === 6.16 &&
      s.mp === 402 &&
      s.ghs.join() === 'GHS07,GHS08' &&
      s.bottles.length === 3,
    'an imported container joins its substance by CAS number, filling what it did not know',
  );
  const solv = (await call('GET', '/api/chemicals')).j.find((x) => x.name === 'Smoke solvent');
  ok(
    Math.abs(solv?.M - 73.09) < 0.02 && solv.army && solv.bottle?.place === 'Smoke cabinet',
    'a new substance, its molar mass and storage place',
  );
  ok(
    (await call('GET', '/api/search?q=SMK-0001')).j.hits.some((h) => h.key.startsWith('container:')),
    'search finds containers by barcode',
  );
  for (const x of [a, b, c, other]) await call('DELETE', '/api/inventory/containers/' + x.j.id);
}

if (!BUILT) {
  console.log(
    DEV
      ? 'A second module next to Electronic Devices (a test module, 0.41)'
      : 'A module on the core alone (the test module)',
  );
  const eqs = (await call('GET', '/api/equipment')).j;
  ok(
    eqs.steps.some((x) => x.key === 'fake-mix' && x.module === 'fake') &&
      (!DEV || eqs.steps.some((x) => x.key === 'spin' && x.module === 'devices')) &&
      (DEV || eqs.steps.every((x) => x.module === 'fake')),
    DEV ? 'equipment steps come from every module' : 'the core has no steps of its own: only the test module’s',
  );
  ok(
    (await call('POST', '/api/equipment', { name: 'Fake nothing', steps: ['no-such-step'] })).s === 400,
    'a step no module defines is refused',
  );
  const mix = await call('POST', '/api/equipment', { name: 'Fake mixer', steps: ['fake-mix'] }),
    reader = await call('POST', '/api/equipment', { name: 'Fake reader', steps: ['fake-read'] });
  ok(mix.s === 200 && reader.s === 200, 'equipment that does the test module’s steps');
  const smp = await call('POST', '/api/m/fake/samples', { name: 'First sample' });
  ok(smp.s === 200 && smp.j.code === 'S-1', 'the test module’s own route and table');
  ok(
    db.prepare("SELECT 1 FROM migrations WHERE id=10001 AND owner='fake'").get(),
    'its database change is recorded under its own name',
  );
  const cal = (await call('GET', '/api/calendar?from=2031-02-01T00:00:00.000Z&to=2031-02-08T00:00:00.000Z')).j;
  ok(
    cal.open.some((c) => c.subject === 'sample' && c.id === smp.j.id && c.noun === 'sample') &&
      cal.open.some((c) => c.subject === 'batch') === DEV,
    DEV ? 'the booking form offers batches and samples' : 'the booking form offers samples only',
  );
  const t = (d, h) => new Date(Date.UTC(2031, 1, d, h)).toISOString();
  const bk = (eq, d, h, extra) =>
    call('POST', '/api/bookings', { equipment_id: eq, start: t(d, h), end: t(d, h + 1), ...extra });
  const one = await bk(mix.j.id, 3, 9, { subject: 'sample', subject_id: smp.j.id });
  ok(one.s === 200, 'equipment is booked for a sample');
  const shown = (await call('GET', '/api/calendar?from=2031-02-01T00:00:00.000Z&to=2031-02-08T00:00:00.000Z')).j
    .bookings;
  ok(
    shown.some(
      (k) => k.id === one.j.id && k.subject === 'sample' && k.subject_code === 'S-1' && k.subject_noun === 'sample',
    ),
    'the calendar shows it as sample S-1',
  );
  const over = await bk(mix.j.id, 3, 9, { purpose: 'something else' });
  ok(over.s === 409 && /for sample S-1/.test(over.j.error), 'an overlap names the sample');
  ok(
    (await bk(reader.j.id, 4, 9, { subject: 'sample', subject_id: smp.j.id })).j.error === 'read finished samples only',
    'measuring equipment of the test module takes finished samples only',
  );
  ok(
    (await bk(mix.j.id, 5, 9, { subject: 'sample', subject_id: 999 })).s === 400 &&
      (await bk(mix.j.id, 5, 9, { subject: 'nothing', subject_id: 1 })).s === 400,
    'an unknown sample or kind of subject is refused',
  );
  // an ended step of the sample: its owner gives the outcome, and the module hears of it
  const me = (await call('GET', '/api/me')).j.id;
  const kid = db
    .prepare(
      "INSERT INTO bookings(equipment_id,subject,subject_id,user_id,step,start,end) VALUES(?,'sample',?,?,'Mix','2026-01-06T09:00:00.000Z','2026-01-06T10:00:00.000Z')",
    )
    .run(mix.j.id, smp.j.id, me).lastInsertRowid;
  ok(
    (await call('GET', '/api/bookings/pending')).j.some((k) => k.id === Number(kid) && !k.atmoOnly),
    'the ended sample step asks its outcome',
  );
  ok((await call('POST', `/api/bookings/${kid}/outcome`, { outcome: 'done' })).s === 200, 'outcome given');
  ok(
    db.prepare('SELECT status FROM fake_samples WHERE id=?').get(smp.j.id).status === 'finished',
    'the test module was told (its sample is finished)',
  );
  ok((await bk(reader.j.id, 6, 9, { subject: 'sample', subject_id: smp.j.id })).s === 200, 'then the reader takes it');

  // 0.42: samples as a record type (comments, search, trash), what they used, and their part of the Overview
  ok(
    (await call('GET', '/api/version')).j.modules.join() === [...MODULES, 'fake'].join(),
    'the server lists its modules',
  );
  ok(
    (await call('POST', `/api/comments/sample/${smp.j.id}`, { text: 'Looks fine' })).s === 200,
    'a sample takes comments',
  );
  ok((await call('GET', `/api/comments-count/sample/${smp.j.id}`)).j.n === 1, 'and counts them');
  ok((await call('POST', '/api/comments/nothing/1', { text: 'x' })).s === 404, 'an unknown record type takes none');
  const found = (await call('GET', '/api/search?q=S-1')).j.hits;
  ok(
    found.some((h) => h.key === 'sample:' + smp.j.id && h.hint === 'Sample' && h.link.view === 'fake'),
    'search finds samples',
  );
  const use = (await call('GET', '/api/inventory/use')).j;
  ok(
    use.basis.some((b) => /finished test sample/.test(b)) &&
      use.events.some((e) => e.label === 'S-1' && e.uses[0].name === 'Test salt'),
    'the inventory sums what the test module reports it used',
  );
  const ov = (
    await call('GET', `/api/dashboard?from=2026-01-05T00:00:00.000Z&to=2026-01-12T00:00:00.000Z&unit=week&scope=lab`)
  ).j;
  ok(
    ov.m.fake.samples >= 1 && !!ov.m.devices === DEV && ov.people.some((p) => p.m.fake.samples >= 1),
    DEV
      ? 'the Overview has the test module’s part next to Electronic Devices'
      : 'the Overview has the test module’s part',
  );
  ok((await call('GET', '/api/dashboard/person/' + me)).j.m.fake.samples >= 1, 'and a person’s page too');
  await call('DELETE', '/api/m/fake/samples/' + smp.j.id);
  const after = (await call('GET', '/api/calendar?from=2031-02-01T00:00:00.000Z&to=2031-02-08T00:00:00.000Z')).j
    .bookings;
  ok(!after.some((k) => k.subject === 'sample'), 'bookings of a deleted sample are hidden');
  const inTrash = (await call('GET', '/api/trash')).j.items.find((i) => i.kind === 'sample' && i.id === smp.j.id);
  ok(inTrash?.type === 'Sample' && inTrash.name === 'S-1 First sample', 'the deleted sample is in the trash');
  ok(!(await call('GET', '/api/search?q=S-1')).j.hits.some((h) => h.key === 'sample:' + smp.j.id), 'and out of search');
  ok((await call('POST', `/api/trash/sample/${smp.j.id}/restore`, {})).s === 200, 'restored');
  ok((await call('GET', `/api/comments-count/sample/${smp.j.id}`)).j.n === 1, 'with its comment');
  await call('DELETE', '/api/m/fake/samples/' + smp.j.id);
  ok((await call('DELETE', `/api/trash/sample/${smp.j.id}`)).s === 200, 'then deleted for good');
  ok(
    !db.prepare('SELECT 1 FROM fake_samples WHERE id=?').get(smp.j.id) &&
      !db.prepare("SELECT 1 FROM comments WHERE target='sample' AND target_id=?").get(smp.j.id) &&
      !db.prepare("SELECT 1 FROM bookings WHERE subject='sample' AND subject_id=?").get(smp.j.id),
    'with its comments and bookings',
  );
  ok((await call('DELETE', '/api/trash/nothing/1')).s === 404, 'an unknown record type is not in the trash');
}

console.log('First setup (a fresh install)');
{
  const port2 = await freePort(),
    base2 = `http://127.0.0.1:${port2}`;
  const env2 = { ...env, PORT: String(port2), DB_PATH: join(tmp, 'fresh.db'), ADMIN_PASSWORD: '' };
  const s2 = spawn(process.execPath, serverArgs, {
    cwd: serverCwd,
    env: env2,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log2 = '';
  s2.stdout.on('data', (x) => (log2 += x));
  s2.stderr.on('data', (x) => (log2 += x));
  // the setup message is printed just after "Server listening", so wait for it rather than for the listen line
  for (let i = 0; i < 300 && !log2.includes('not set up yet'); i++) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 300));
  ok(
    /not set up yet/.test(log2) && !/password/i.test(log2.split('not set up yet')[1] ?? ''),
    'no admin password printed: it asks for the setup',
  );
  const j = (m, path, body) =>
    fetch(base2 + path, {
      method: m,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  ok(
    (await (await j('GET', '/api/lab/public')).json()).setup === 'here',
    'setup offered on the computer that runs the app',
  );
  ok((await j('POST', '/api/access-requests', askBody)).status === 409, 'no requests before the setup');
  const setup = {
    admin: {
      firstNames: 'Marie',
      surnames: 'Curie',
      surname: 'Curie',
      email: 'r@lab.example',
      birthDate: '1995-06-01',
      password: 'Perov-Ç4ke',
    },
    lab: {
      name: 'Test Lab',
      institution: 'Example University',
      domains: ['lab.example'],
      departments: ['Applied Physics'],
      hours: Array.from({ length: 7 }, (_, i) => ({ on: i < 6, from: '08:00', to: '18:00' })),
    },
  };
  ok(
    (await j('POST', '/api/setup', { ...setup, admin: { ...setup.admin, password: 'weakpass' } })).status === 400,
    'setup: weak password refused',
  );
  const st = await j('POST', '/api/setup', setup);
  const sj = await st.json();
  ok(
    st.status === 200 && sj.username === 'mariec' && /sid=/.test(st.headers.get('set-cookie') ?? ''),
    'setup makes the first admin and signs in',
  );
  ok((await j('POST', '/api/setup', setup)).status === 409, 'and cannot run again');
  const pub2 = await (await j('GET', '/api/lab/public')).json();
  ok(
    pub2.name === 'Test Lab' && pub2.setup === null && pub2.domains[0] === 'lab.example',
    'the lab name and domains are kept',
  );
  ok(
    (await j('POST', '/api/access-requests', { ...askBody, email: 'ana@gmail.com' })).status === 400,
    'requests only from the lab domains',
  );
  ok(
    (await j('POST', '/api/access-requests', { ...askBody, email: 'ana@sub.lab.example' })).status === 200,
    'subdomains count',
  );
  s2.kill();
}

console.log('A new lab: its licence at the first start, and the setup code (0.46)');
{
  const port3 = await freePort(),
    base3 = `http://127.0.0.1:${port3}`,
    cfg = join(tmp, 'config3');
  mkdirSync(cfg, { recursive: true });
  // the licence the installer leaves next to the app: the core alone, and the hash of a setup code
  writeFileSync(
    join(cfg, 'licence.json'),
    byHand({
      id: 'L-SMOKE-3',
      lab: 'New Lab',
      labId: 'new-lab',
      modules: [],
      setup: createHash('sha256').update('ABCDEFGHJKMNPQRS').digest('hex'),
    }),
  );
  const s3 = spawn(process.execPath, serverArgs, {
    cwd: serverCwd,
    env: { ...env, PORT: String(port3), DB_PATH: join(tmp, 'fresh3.db'), ADMIN_PASSWORD: '', CONFIG_DIR: cfg },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log3 = '';
  s3.stdout.on('data', (x) => (log3 += x));
  s3.stderr.on('data', (x) => (log3 += x));
  for (let i = 0; i < 300 && !log3.includes('not set up yet'); i++) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 300));
  ok(
    /Licence L-SMOKE-3 installed for New Lab/.test(log3),
    'the licence left by the installer is installed at the first start',
  );
  const j3 = (m, path, body, remote = true) =>
    fetch(base3 + path, {
      method: m,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(remote ? { 'x-test-remote': '1' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  ok((await (await j3('GET', '/api/version')).json()).modules.length === 0, 'only the modules it lists start');
  ok(
    (await (await j3('GET', '/api/lab/public')).json()).setup === 'code' &&
      (await (await j3('GET', '/api/lab/public', undefined, false)).json()).setup === 'here',
    'from another computer the setup asks for the code; on the server it does not',
  );
  ok(
    (await j3('POST', '/api/setup/code', { code: 'AAAA-BBBB-CCCC-DDDD' })).status === 403,
    'a wrong setup code is refused',
  );
  const lab3 = {
    admin: {
      firstNames: 'Rosalind',
      surnames: 'Franklin',
      surname: 'Franklin',
      email: 'rf@new.example',
      birthDate: '1990-07-25',
      password: 'Perov-Ç4ke',
    },
    lab: {
      name: 'New Lab',
      institution: '',
      domains: [],
      departments: [],
      hours: Array.from({ length: 7 }, (_, i) => ({ on: i < 5, from: '08:00', to: '18:00' })),
    },
  };
  ok((await j3('POST', '/api/setup', lab3)).status === 403, 'no setup from another computer without the code');
  ok(
    (await j3('POST', '/api/setup/code', { code: 'abcd efgh jkmn pqrs' })).status === 200,
    'the code is read without case or spaces',
  );
  const st3 = await j3('POST', '/api/setup', { ...lab3, code: 'ABCD-EFGH-JKMN-PQRS' });
  ok(
    st3.status === 200 && (await st3.json()).username === 'rosalindf',
    'the first admin is made from another computer with the code',
  );
  ok((await j3('POST', '/api/setup/code', { code: 'ABCD-EFGH-JKMN-PQRS' })).status === 409, 'and the code works once');
  s3.kill();
}

console.log('An install made by PANOPTICA Setup needs its licence (0.49)');
{
  const port4 = await freePort(),
    base4 = `http://127.0.0.1:${port4}`,
    cfg = join(tmp, 'config4');
  mkdirSync(cfg, { recursive: true });
  writeFileSync(join(cfg, 'install.json'), JSON.stringify({ by: 'setup' }));
  const s4 = spawn(process.execPath, serverArgs, {
    cwd: serverCwd,
    env: { ...env, PORT: String(port4), DB_PATH: join(tmp, 'fresh4.db'), CONFIG_DIR: cfg },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log4 = '';
  s4.stdout.on('data', (x) => (log4 += x));
  s4.stderr.on('data', (x) => (log4 += x));
  for (let i = 0; i < 300 && !log4.includes('Server listening'); i++) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 300));
  let c4 = '';
  const j4 = async (m, path, body) => {
    const r = await fetch(base4 + path, {
      method: m,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(c4 ? { cookie: c4 } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.headers.get('set-cookie')) c4 = r.headers.get('set-cookie').split(';')[0];
    return { s: r.status, j: await r.json().catch(() => null) };
  };
  await j4('POST', '/api/login', { username: 'admin', password: PW });
  const l4 = (await j4('GET', '/api/licence')).j;
  ok(l4?.state === 'none' && l4.critical, 'no licence: a critical file missing, shown to admins');
  const visitor = {
    firstNames: 'Sam',
    surnames: 'Visit',
    surname: 'Visit',
    email: 'sam@guest.example',
    birthDate: '1990-01-01',
    until: '2099-12-31',
  };
  const v4 = await j4('POST', '/api/users', visitor);
  ok(v4.s === 402 && /licence file is missing/.test(v4.j.error), 'no one new is let in until it is installed');
  ok((await j4('GET', '/api/me')).s === 200, 'the admin keeps working');
  const fixed = await j4('POST', '/api/licence', {
    text: byHand({ id: 'L-SMOKE-4', lab: 'Setup Lab', labId: 'setup-lab', modules: MODULES, tier: 1, users: 10 }),
  });
  ok(fixed.s === 200 && fixed.j.state === 'ok' && !fixed.j.critical, 'installed again on the server computer');
  ok((await j4('POST', '/api/users', visitor)).s === 200, 'and people are let in again');
  // the lab's own names (0.49), independent of the licence's
  await j4('PUT', '/api/lab', { name: 'Laboratory of Thin Films', acronym: 'LTF', show: 'acronym' });
  const p4 = (await j4('GET', '/api/lab/public')).j;
  ok(
    p4.name === 'LTF' && p4.fullName === 'Laboratory of Thin Films' && p4.acronym === 'LTF',
    'the lab shows the name it chose: its acronym here',
  );
  await j4('PUT', '/api/lab', { acronym: '' });
  ok(
    (await j4('GET', '/api/lab/public')).j.name === 'Laboratory of Thin Films' &&
      (await j4('GET', '/api/lab')).j.show === 'name',
    'without an acronym it shows the full name',
  );
  s4.kill();
}

// the builder's page (0.50): the same licences as the command line, kept in a folder the person chooses. Once is enough: it
// does not depend on how the app was started
if (!BUILT && !CORE) {
  console.log('The builder’s page and its list of licences (0.50)');
  const bport = await freePort(),
    bbase = `http://127.0.0.1:${bport}`,
    list = join(tmp, 'issued');
  const ui = spawn(
    process.execPath,
    [join(root, 'tools/builder/ui.mjs'), '--port', String(bport), '--no-open', '--pub', join(keys, 'pub.pem')],
    { env: { ...process.env, PANOPTICA_BUILDER_SETTINGS: join(tmp, 'builder.json') }, stdio: 'pipe' },
  );
  let ulog = '';
  ui.stdout.on('data', (d) => (ulog += d));
  ui.stderr.on('data', (d) => (ulog += d));
  const b = async (method, path, body, headers = {}) => {
    const r = await fetch(bbase + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json', origin: bbase } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    let j = null;
    try {
      j = JSON.parse(t);
    } catch {
      /* a page or a file */
    }
    return { s: r.status, j, t };
  };
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(bbase + '/api/state')).ok) break;
    } catch {
      /* not up yet */
    }
    if (i > 240) throw new Error('the builder’s page did not start:\n' + ulog);
    await new Promise((r) => setTimeout(r, 250));
  }
  const s0 = (await b('GET', '/api/state')).j;
  ok(s0.folder === null && s0.labs.length === 0, 'it starts with no folder: the person chooses where the list is kept');
  ok(
    (await b('GET', '/')).t.includes('Licence builder') && (await b('GET', '/app.js')).s === 200,
    'the page is served with the app’s own styles and components',
  );
  ok(
    (await b('POST', '/api/folder', { path: list }, { origin: 'http://evil.example' })).s === 403 &&
      // under another name (a site that points its own name at 127.0.0.1); fetch cannot set Host, so a plain request
      (await new Promise((done) =>
        // read to the end and on a connection of its own: one left open is reset when the builder stops (Windows)
        request(
          { port: bport, host: '127.0.0.1', path: '/api/state', headers: { host: 'evil.example' }, agent: false },
          (r) => {
            r.resume();
            r.on('end', () => done(r.statusCode));
          },
        )
          .on('error', () => done(0))
          .end(),
      )) === 403,
    'it answers only to its own page, on this computer',
  );
  ok(
    /inside the repository/.test((await b('POST', '/api/folder', { path: join(root, 'out/issued') })).j.error) &&
      !existsSync(join(root, 'out/issued')),
    'a folder inside the repository is refused: the list holds lab names',
  );
  ok((await b('POST', '/api/folder', { path: list })).j.folder === list, 'the chosen folder is created and used');
  const keyText = readFileSync(join(keys, 'key.pem'), 'utf8'),
    want = { lab: 'Builder Page Laboratory', acronym: 'BPL', modules: ['devices'], tier: 1 };
  ok(/signing key/.test((await b('POST', '/api/licences', want)).j.error), 'the key is asked for with every licence');
  const stranger = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  ok(
    /not PANOPTICA’s signing key/.test((await b('POST', '/api/licences', { ...want, key: stranger })).j.error) &&
      /not a signing key/.test((await b('POST', '/api/licences', { ...want, key: 'hello' })).j.error) &&
      (await b('GET', '/api/state')).j.labs.length === 0,
    'another key, or a file that is no key, makes nothing',
  );
  ok(
    /more than 50/.test((await b('POST', '/api/licences', { ...want, tier: 3, users: 40, key: keyText })).j.error),
    'tier 3 is for more than 50 people',
  );
  const m1 = (await b('POST', '/api/licences', { ...want, key: keyText })).j;
  ok(
    /^L-\d{6}-[0-9a-f]{4}$/.test(m1.id) &&
      /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/.test(m1.code) &&
      m1.labs.length === 1 &&
      m1.labs[0].licences[0].setup,
    'a new lab gets a licence with a setup code, and is in the list',
  );
  const f1 = await b('GET', `/api/licences/${m1.id}/licence.json`),
    body50 = JSON.parse(f1.j.body);
  ok(
    body50.lab === 'Builder Page Laboratory' && body50.acronym === 'BPL' && body50.tier === 1 && body50.users === 10,
    'the licence carries the names, the modules and the tier of the form',
  );
  ok(
    (await call('POST', '/api/licence', { text: f1.t })).j?.error?.includes('another lab'),
    'PANOPTICA reads it as a signed licence (of another lab here)',
  );
  ok(
    (await b('GET', `/api/licences/${m1.id}/licence.json`)).t === f1.t,
    'a lab that lost its file gets the same file again',
  );
  const sheet50 = await b('GET', `/api/licences/${m1.id}/sheet`);
  ok(
    sheet50.t.includes(m1.code) &&
      sheet50.t.includes('<ol>') &&
      (await b('GET', `/api/licences/${m1.id}/install-sheet.md`)).t.includes(m1.code),
    'the install sheet is kept, with the setup code, and opens as a page to print',
  );
  const m2 = (await b('POST', '/api/licences', { ...want, tier: 2, labId: m1.labId, key: keyText })).j,
    body51 = JSON.parse((await b('GET', `/api/licences/${m2.id}/licence.json`)).j.body);
  ok(
    m2.labs.length === 1 &&
      m2.labs[0].licences.length === 2 &&
      m2.labs[0].licences[0].id === m2.id &&
      body51.labId === body50.labId &&
      body51.users === 50 &&
      !body51.setup &&
      m2.code === '',
    'a new licence for a lab in the list keeps its lab id and has no setup code',
  );
  ok(
    (await b('POST', '/api/licences', { ...want, labId: 'no-such-lab', key: keyText })).s === 404,
    'a lab id that is not in the list is refused',
  );
  const everything = readdirSync(list, { recursive: true })
    .map((f) => {
      try {
        return readFileSync(join(list, String(f)), 'utf8');
      } catch {
        return ''; // a folder
      }
    })
    .join('\n');
  ok(
    !everything.includes('PRIVATE KEY') &&
      !readFileSync(join(tmp, 'builder.json'), 'utf8').includes('key') &&
      !ulog.includes('PRIVATE'),
    'the key is nowhere: not in the list’s folder, not in what is remembered, not in the log',
  );
  ui.kill();
  // the builder started again remembers the folder, and reads the list from the licence files themselves
  const ui2 = spawn(
    process.execPath,
    [join(root, 'tools/builder/ui.mjs'), '--port', String(bport), '--no-open', '--pub', join(keys, 'pub.pem')],
    { env: { ...process.env, PANOPTICA_BUILDER_SETTINGS: join(tmp, 'builder.json') }, stdio: 'ignore' },
  );
  let s2 = null;
  for (let i = 0; i < 240 && !s2; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      s2 = await (await fetch(bbase + '/api/state')).json();
    } catch {
      /* not up yet */
    }
  }
  ok(
    s2?.folder === list && s2.labs[0]?.licences.length === 2,
    'started again, it opens the same folder and shows the same list',
  );
  ui2.kill();
}

db.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
done(failed ? 1 : 0);
