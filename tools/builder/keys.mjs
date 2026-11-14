// Product keys (0.47), for PANOPTICA staff only: the key a lab types in the installer decides what it gets.
//
//   node tools/builder/keys.mjs new --lab "Lab name" --modules devices --updates-until 2027-12-31 --installs 1 [--lab-id <id>]
//   node tools/builder/keys.mjs renew --lab-id <id> [--modules devices] [--updates-until 2028-12-31] [--installs 2]
//   node tools/builder/keys.mjs list
//   node tools/builder/keys.mjs move --lab-id <id> --computer <install id or computer name>
//   node tools/builder/keys.mjs publish <version>     (a GitHub release's packages, onto the service; needs gh)
//
// Every command talks to the activation service: --service <url> (or ACTIVATION_URL) and --token <admin token> (or
// ACTIVATION_TOKEN). `new` and `renew` sign the lab's licence with PANOPTICA's private key (--key <pem file> or SIGNING_KEY),
// checked against release.pub (or --pub) before anything is sent. The service keeps only each key's SHA-256 and the signed
// licence: the key itself is shown once, here, and written on the lab's key card (out/keys/), never stored anywhere else.
// The licence's setup hash is the key's: the product key also opens the lab's first setup.
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, sign, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const [cmd, ...args] = process.argv.slice(2),
  opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const fail = (m) => {
  console.error('keys: ' + m);
  process.exit(1);
};
const service = (opt('--service') ?? process.env.ACTIVATION_URL ?? '').replace(/\/$/, ''),
  token = opt('--token') ?? process.env.ACTIVATION_TOKEN;
if (!service || !token)
  fail('give the activation service: --service <url> --token <admin token> (or ACTIVATION_URL, ACTIVATION_TOKEN)');
async function call(method, path, body, raw) {
  const r = await fetch(service + path, {
    method,
    headers: { authorization: 'Bearer ' + token, ...(body && !raw ? { 'content-type': 'application/json' } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(`${method} ${path}: ${j.error ?? r.status}`);
  return j;
}
const keyHash = (k) => createHash('sha256').update(k.replace(/[\s-]/g, '').toUpperCase()).digest('hex');
const day = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '') && !isNaN(Date.parse(d));
function signer() {
  const pem = opt('--key') ? readFileSync(opt('--key'), 'utf8') : process.env.SIGNING_KEY;
  if (!pem) fail('give PANOPTICA’s private key: --key path/to/key.pem (or SIGNING_KEY)');
  let k;
  try {
    k = createPrivateKey(pem.replace(/\r/g, '').trim() + '\n');
  } catch {
    fail('the key cannot be read (an Ed25519 private key in PEM)');
  }
  const pub = createPublicKey(readFileSync(opt('--pub') ?? join(root, 'release.pub'), 'utf8'));
  return (body) => {
    const s = sign(null, Buffer.from(body, 'utf8'), k);
    if (!verify(null, Buffer.from(body, 'utf8'), pub, s))
      fail('this key is not PANOPTICA’s (it does not match release.pub)');
    return JSON.stringify({ body, sig: s.toString('base64') });
  };
}
function modulesArg(given) {
  const all = readdirSync(join(root, 'modules')).filter((m) =>
    existsSync(join(root, 'modules', m, 'server/src/index.ts')),
  );
  const mods = String(given ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .sort();
  if (!mods.length) fail('give the modules the lab bought: --modules devices (the core is never installed alone)');
  for (const m of mods) if (!all.includes(m)) fail(`there is no module ${m} (modules: ${all.join(', ')})`);
  return mods;
}
const licenceBody = (l) =>
  JSON.stringify(
    {
      v: 1,
      id: `L-${l.issued.slice(2).replace(/-/g, '')}-${randomBytes(2).toString('hex')}`,
      ...l,
      made: new Date().toISOString(),
    },
    null,
    2,
  );
const dmy = (d) => d.split('-').reverse().join('/');

if (cmd === 'new') {
  const lab = opt('--lab')?.trim(),
    mods = modulesArg(opt('--modules')),
    until = opt('--updates-until'),
    installs = Math.max(1, +(opt('--installs') ?? 1) || 1);
  if (!lab) fail('give the lab’s name: --lab "Lab name"');
  if (!day(until)) fail('give the last day of updates as yyyy-mm-dd: --updates-until 2027-12-31');
  // 25 letters and digits that cannot be confused (no 0/O, 1/I/L), in five groups: about 124 bits
  const A = '23456789ABCDEFGHJKMNPQRSTUVWXYZ',
    key = [...randomBytes(25)]
      .map((b) => A[b % A.length])
      .join('')
      .replace(/(.{5})(?=.)/g, '$1-');
  const sealed = signer()(
    licenceBody({
      lab,
      labId: opt('--lab-id') ?? randomUUID(),
      modules: mods,
      issued: new Date().toISOString().slice(0, 10),
      updatesUntil: until,
      setup: keyHash(key),
    }),
  );
  await call('PUT', `/v1/admin/keys/${keyHash(key)}`, { licence: sealed, installs });
  const l = JSON.parse(JSON.parse(sealed).body);
  const dir = resolve(opt('--out') ?? join(root, 'out/keys'));
  mkdirSync(dir, { recursive: true });
  const card = join(
    dir,
    `${lab
      .normalize('NFKD')
      .replace(/[^\w]+/g, '-')
      .toLowerCase()}-${l.id}.md`,
  );
  writeFileSync(
    card,
    `# PANOPTICA for ${lab}

**Product key: \`${key}\`**

Modules: ${mods.join(', ')}. Updates until ${dmy(until)}. Computers: ${installs}.
Licence ${l.id}; lab id \`${l.labId}\` (for this lab's renewals).

1. On the computer that will run PANOPTICA, run **PANOPTICA Setup** and type the product key. It downloads what this key
   covers and installs it.
2. Open PANOPTICA (the installer's last page has the address) and type the product key again to create the first admin and
   set up the lab. That works once.

Keep the key safe: it installs PANOPTICA and brings its updates. To move it to another computer, contact PANOPTICA.
`,
  );
  console.log(
    `key ${key}\n  ${lab}: ${mods.join(', ')}, updates until ${until}, ${installs} computer(s)\n  card: ${card}`,
  );
} else if (cmd === 'renew') {
  const id = opt('--lab-id');
  if (!id) fail('give the lab id: --lab-id <id> (keys.mjs list shows it)');
  const k = (await call('GET', '/v1/admin/keys')).find((x) => x.lab_id === id);
  if (!k) fail(`no key for lab id ${id}`);
  const until = opt('--updates-until') ?? k.updates_until;
  if (!day(until)) fail('the last day of updates is yyyy-mm-dd');
  const sealed = signer()(
    licenceBody({
      lab: opt('--lab') ?? k.lab,
      labId: k.lab_id,
      modules: opt('--modules') ? modulesArg(opt('--modules')) : k.modules,
      issued: new Date().toISOString().slice(0, 10),
      updatesUntil: until,
      setup: k.hash,
    }),
  );
  await call('PUT', `/v1/admin/keys/${k.hash}`, { licence: sealed, installs: +(opt('--installs') ?? k.installs) });
  const l = JSON.parse(JSON.parse(sealed).body);
  console.log(
    `renewed ${l.lab}: ${l.modules.join(', ')}, updates until ${l.updatesUntil} (licence ${l.id}); its computers get it at their next check`,
  );
} else if (cmd === 'list') {
  for (const k of await call('GET', '/v1/admin/keys'))
    console.log(
      `${k.lab} (lab id ${k.lab_id}): ${k.modules.join(', ')}, updates until ${k.updates_until}, ${k.computers.length}/${k.installs} computer(s)${k.revoked ? ', revoked' : ''}` +
        k.computers
          .map((c) => `\n    ${c.name || '?'} (${c.install}), since ${c.first_at}, last seen ${c.seen_at}`)
          .join(''),
    );
} else if (cmd === 'move') {
  const k = (await call('GET', '/v1/admin/keys')).find((x) => x.lab_id === opt('--lab-id'));
  if (!k) fail('no key for that lab id');
  const c = k.computers.find((x) => x.install === opt('--computer') || x.name === opt('--computer'));
  if (!c) fail('that computer has not activated this key');
  await call('DELETE', `/v1/admin/keys/${k.hash}/installs/${c.install}`);
  console.log(`${c.name || c.install} no longer uses the key of ${k.lab}: another computer can activate it`);
} else if (cmd === 'publish') {
  const v = args[0];
  if (!/^\d+\.\d+\.\d+$/.test(v ?? '')) fail('give the version: publish 0.47.0');
  const dir = resolve(opt('--from') ?? join(root, 'out/release-' + v));
  if (!opt('--from')) {
    mkdirSync(dir, { recursive: true });
    execFileSync('gh', ['release', 'download', 'v' + v, '--dir', dir, '--clobber', '--pattern', 'panoptica-*'], {
      stdio: 'inherit',
    });
  }
  const rel = opt('--from')
    ? { published: new Date().toISOString(), notes: '' }
    : JSON.parse(execFileSync('gh', ['release', 'view', 'v' + v, '--json', 'publishedAt,body']).toString());
  const files = readdirSync(dir).filter((f) => /^panoptica-[\w+]+\.zip(\.sig|\.sha256)?$/.test(f));
  if (!files.some((f) => f.endsWith('.zip'))) fail('no panoptica-<modules>.zip in that release');
  for (const f of files) await call('PUT', `/v1/admin/releases/${v}/${f}`, null, readFileSync(join(dir, f)));
  await call('POST', `/v1/admin/releases/${v}`, {
    published: rel.publishedAt ?? rel.published,
    notes: rel.body ?? rel.notes ?? '',
  });
  console.log(`published ${v}: ${files.join(', ')}`);
} else fail('commands: new, renew, list, move, publish (see the top of this file)');
