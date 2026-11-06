// Security and data-safety checks against a real server with a throw-away database. Run: npm run test:server
// Starts a fake GitHub API too, to test the update download and its checksum.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
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

// ---- fake GitHub: one release with a zip and its checksum (and a wrong checksum on demand)
const zip = Buffer.from('PK fake zip for the update test'),
  good = createHash('sha256').update(zip).digest('hex');
let sum = good;
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
        published_at: new Date().toISOString(),
        html_url: 'x',
        assets: [
          { id: 1, name: 'perovskite-lab.zip', size: zip.length },
          { id: 2, name: 'perovskite-lab.zip.sha256', size: 64 },
        ],
      }),
    );
  }
  if (req.url === '/repos/lab/app/releases/assets/1') {
    res.writeHead(200);
    return res.end(zip);
  }
  if (req.url === '/repos/lab/app/releases/assets/2') {
    res.writeHead(200);
    return res.end(`${sum}  perovskite-lab.zip\n`);
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
};
const srv = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: join(root, 'apps/server'),
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
for (let i = 0; i < 100 && !log.includes('Server listening'); i++) await new Promise((r) => setTimeout(r, 200));
if (!log.includes('Server listening')) {
  console.error(log);
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
const db = new DatabaseSync(env.DB_PATH);
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

console.log('Passwords');
ok(
  (await call('POST', '/api/users', { username: 'ana', name: 'Ana', role: 'member', password: 'short' })).s === 400,
  'short password refused',
);
ok(
  (await call('POST', '/api/users', { username: 'ana', name: 'Ana', role: 'member', password: 'perovskite123' })).s ===
    400,
  'common password refused',
);
ok(
  (await call('POST', '/api/users', { username: 'ana', name: 'Ana', role: 'member', password: 'ana-loves-cells' }))
    .s === 400,
  'password with the username refused',
);
ok(
  (await call('POST', '/api/users', { username: 'ana', name: 'Ana', role: 'member', password: 'blue glass at noon' }))
    .s === 200,
  'good password accepted',
);
const ana = await fetch(base + '/api/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'ana', password: 'blue glass at noon' }),
});
const anaCookie = (ana.headers.get('set-cookie') ?? '').split(';')[0];
ok(
  (await fetch(base + '/api/users', { headers: { cookie: anaCookie } })).status === 403,
  'member cannot open admin pages',
);
for (let i = 0; i < 5; i++) await call('POST', '/api/login', { username: 'ana', password: 'nope' + i });
ok(
  (await call('POST', '/api/login', { username: 'ana', password: 'blue glass at noon' })).s === 429,
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
    acts.includes('Created a user') &&
    acts.includes('Made a backup') &&
    acts.includes('Viewed the backup key'),
  'sign-ins, changes and sensitive reads logged',
);
ok(
  acts.some((x) => x.startsWith('Refused')),
  'refused requests logged',
);
ok(!JSON.stringify(a.j).includes('blue glass'), 'no passwords in the log');
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

console.log('Measurements and comparisons');
{
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
    system: 'padrao',
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
}

console.log('Calendar: shortest booking and cleanup');
{
  const b = await call('POST', '/api/batches', {
    code: 'SMOKE-CAL',
    visibility: 'shared',
    stack: { arch: 'n-i-p', sl: [] },
  });
  ok(b.s === 200, 'batch for bookings made');
  const eq = await call('POST', '/api/equipment', { name: 'GB: Smoke box' });
  const plain = await call('POST', '/api/equipment', { name: 'Smoke profilometer' });
  const eqs = (await call('GET', '/api/calendar?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z')).j.equipment;
  ok(
    eqs.find((e) => e.id === eq.j.id)?.cleanup === 20 && eqs.find((e) => e.id === plain.j.id)?.cleanup === 0,
    'glovebox equipment gets 20 min of cleanup by default, other equipment none',
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
  const bl = (await call('GET', '/api/batches')).j.find((x) => x.id === b.j.id);
  ok(bl.steps === 4 && bl.concluded === 0, 'batch progress counts its booked steps and concluded ones');
  ok((await call('GET', '/api/search?q=Smoke')).j.containers !== undefined, 'search also looks in containers');
}

console.log('Batches: variants, lock, mentions');
{
  const sl = [
    { n: 'Substrate', m: 'Substrate', a: '', b: '', t: '' },
    { n: 'Perovskite', m: 'Spin', a: '', b: '', t: '' },
    { n: 'BCP', m: 'Organic evap', a: '', b: '', t: '' },
  ];
  const b = await call('POST', '/api/batches', {
    code: 'SMOKE-VAR',
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
  const ana = db.prepare("SELECT id FROM users WHERE username='ana'").get().id;
  const c = await call('POST', `/api/comments/batch/${b.j.id}`, { text: 'Look at this @ana, and @nobody.' });
  ok(c.s === 200, 'comment with mentions saved');
  ok(
    db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind='mention' AND user_id=?").get(ana).n === 1,
    'the person mentioned is notified',
  );
  const people = (await call('GET', `/api/comments/batch/${b.j.id}/people`)).j;
  ok(people.some((p) => p.username === 'ana') && people.some((p) => p.me), 'people who can open it are offered');
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
const d = await call('POST', '/api/updates/download');
ok(d.s === 200 && d.j.downloaded?.version === '99.0.0', 'download checked against its checksum');
ok(
  db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind='update'").get().n === 0,
  'no notification for a version found while saving settings',
);

db.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
done(failed ? 1 : 0);
