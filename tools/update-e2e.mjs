// End-to-end test of the in-app update on a real machine (CI runs it on Windows and Linux):
// starts an installed copy with its start script, serves a newer release from a fake GitHub, clicks through
// Admin settings › Updates by API (token, download, install) and waits for the app to come back with the new version.
//   node tools/update-e2e.mjs <installed app folder> <newer perovskite-lab.zip> <expected version>
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';

const [app, zipPath, want] = process.argv.slice(2).map((x, i) => (i < 2 ? resolve(x) : x));
const PORT = 3000,
  GH = 4798,
  base = `http://127.0.0.1:${PORT}`,
  PW = 'e2e admin password 26';
const zip = readFileSync(zipPath),
  sum = createHash('sha256').update(zip).digest('hex');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

createServer((q, r) => {
  if (q.headers.authorization !== 'Bearer tok') return r.writeHead(404).end('{}');
  if (q.url === '/repos/lab/app/releases/latest')
    return r.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        tag_name: 'v' + want,
        name: 'v' + want,
        body: 'e2e',
        published_at: new Date().toISOString(),
        html_url: 'x',
        assets: [
          { id: 1, name: 'perovskite-lab.zip', size: zip.length },
          { id: 2, name: 'perovskite-lab.zip.sha256', size: 90 },
        ],
      }),
    );
  if (q.url.endsWith('/assets/1')) return r.writeHead(200).end(zip);
  if (q.url.endsWith('/assets/2')) return r.writeHead(200).end(`${sum}  perovskite-lab.zip\n`);
  r.writeHead(404).end('{}');
}).listen(GH);

const env = {
  ...process.env,
  PORT: String(PORT),
  OPEN_BROWSER: '0',
  ADMIN_USER: 'admin',
  ADMIN_PASSWORD: PW,
  UPDATE_API: `http://127.0.0.1:${GH}`,
  UPDATE_REPO: 'lab/app',
};
log('starting', app);
if (process.platform === 'win32')
  spawn('cmd.exe', ['/c', 'start', '"Perovskite Lab"', '/min', 'cmd', '/c', '"start.bat > app-console.log 2>&1"'], {
    cwd: app,
    env,
    detached: true,
    stdio: 'ignore',
    windowsVerbatimArguments: true,
  }).unref();
else spawn('bash', ['./start.sh'], { cwd: app, env, detached: true, stdio: 'ignore' }).unref();

const version = async () => {
  try {
    return (await (await fetch(base + '/api/version')).json()).version;
  } catch {
    return null;
  }
};
const until = async (what, ok, minutes) => {
  const t0 = Date.now();
  for (;;) {
    const v = await version();
    if (ok(v)) return v;
    if (Date.now() - t0 > minutes * 60e3) throw new Error(`timeout: ${what}`);
    await sleep(3000);
  }
};
let cookie = '';
const call = async (m, p, b) => {
  const r = await fetch(base + p, {
    method: m,
    headers: { ...(b ? { 'content-type': 'application/json' } : {}), cookie },
    body: b ? JSON.stringify(b) : undefined,
  });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = t;
  }
  if (!r.ok) throw new Error(`${m} ${p}: ${r.status} ${t}`);
  return j;
};
const showLogs = () => {
  for (const f of ['updates/update.log', 'app-console.log']) {
    const p = join(app, f);
    if (existsSync(p)) {
      console.log(`----- ${f}`);
      console.log(readFileSync(p, 'utf8'));
    }
  }
};
try {
  const old = await until('first start', (v) => !!v, 12);
  log('running', old);
  await call('POST', '/api/login', { username: 'admin', password: PW });
  const s = await call('PUT', '/api/updates/settings', { token: 'tok' });
  if (!s.available) throw new Error('update not found: ' + JSON.stringify(s));
  log('found', s.latest.version);
  const d = await call('POST', '/api/updates/download');
  log('downloaded', d.downloaded.file);
  await call('POST', '/api/updates/install');
  log('install started');
  const t0 = Date.now();
  const v = await until('restart with the new version', (x) => x === want, 15);
  log(`back on ${v} after ${Math.round((Date.now() - t0) / 1000)} s`);
  cookie = '';
  await call('POST', '/api/login', { username: 'admin', password: PW });
  const a = await call('GET', '/api/audit');
  if (!a.rows.some((r) => r.action === 'Started installing an update')) throw new Error('activity log lost');
  log('data kept (sign-in and activity log)');
  showLogs();
  process.exit(0);
} catch (e) {
  console.error('FAILED:', e.message);
  showLogs();
  process.exit(1);
}
