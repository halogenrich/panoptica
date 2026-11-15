// PANOPTICA's licence builder (0.46; tiers and lab names 0.49), for PANOPTICA staff only: makes what one lab needs to install
// PANOPTICA with PANOPTICA Setup.
//
//   node tools/builder/builder.mjs --lab "Full lab name" [--acronym ABC] --modules devices --tier 1|2|3 [--users N]
//        --key path/to/key.pem [--lab-id <id>] [--no-setup] [--out folder]
//
// Writes <out>/<lab>-<licence id>/:
//   licence.json        the lab's licence, signed with PANOPTICA's key: the lab's full name and acronym, lab id, modules, tier
//                       and number of people, issued, and the hash of a one-time setup code. PANOPTICA Setup asks for it, and
//                       it decides which package Setup installs.
//   install-sheet.md    for the install crew: the steps, and the setup code (the code is only on this sheet)
// Tiers: 1 covers up to 10 active people, 2 up to 50, 3 more (give the number agreed with the lab: --users). Updates are free.
// The first licence of a lab gets a new lab id; give the same --lab-id for that lab's later licences (an upgrade, a module added,
// a copy of a lost file), or the lab's PANOPTICA refuses them. Later licences need no setup code (--no-setup).
//
// The key is PANOPTICA's private signing key (Ed25519, PEM): read from --key or the SIGNING_KEY environment variable, used, and
// never written anywhere. The licence is checked against release.pub (or --pub, for tests), so the builder never hands out a
// licence the app would refuse.
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, sign, verify } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2),
  opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined),
  flag = (n) => args.includes(n);
let made = ''; // the lab's folder, removed when something fails half way
const fail = (m) => {
  if (made) rmSync(made, { recursive: true, force: true });
  console.error('builder: ' + m);
  process.exit(1);
};

// ---- what to make
const lab = opt('--lab')?.trim().replace(/\s+/g, ' ');
if (!lab) fail('give the lab’s full name: --lab "Full lab name"');
const acronym = opt('--acronym')?.trim() ?? '';
if (acronym.length > 24) fail('the acronym is longer than 24 characters');
const present = readdirSync(join(root, 'modules')).filter((m) =>
  existsSync(join(root, 'modules', m, 'server/src/index.ts')),
);
const mods = (opt('--modules') ?? '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean)
  .sort();
if (!mods.length) fail('give the modules the lab bought: --modules devices (the core is never installed alone)');
for (const m of mods) if (!present.includes(m)) fail(`there is no module ${m} (modules: ${present.join(', ')})`);
const TIERS = { 1: 10, 2: 50 };
const tier = Number(opt('--tier'));
if (![1, 2, 3].includes(tier))
  fail('give the tier: --tier 1 (up to 10 people), 2 (up to 50) or 3 (more, with --users)');
const users = opt('--users') !== undefined ? Number(opt('--users')) : TIERS[tier];
if (!Number.isInteger(users) || users < 1)
  fail(tier === 3 ? 'tier 3 needs the number of people agreed with the lab: --users 80' : 'give --users as a number');
if (tier !== 3 && users !== TIERS[tier])
  fail(`tier ${tier} covers ${TIERS[tier]} people; for another number use tier 3 with --users`);
if (tier === 3 && users <= 50) fail('tier 3 is for more than 50 people; use tier 1 or 2');
if (opt('--updates-until')) console.warn('builder: updates are free since 0.49; --updates-until is ignored');
const pem = opt('--key') ? readFileSync(opt('--key'), 'utf8') : process.env.SIGNING_KEY;
if (!pem) fail('give PANOPTICA’s private key: --key path/to/key.pem (or SIGNING_KEY)');
let key;
try {
  key = createPrivateKey(pem.replace(/\r/g, '').trim() + '\n');
} catch {
  fail('the key cannot be read (an Ed25519 private key in PEM)');
}
const pub = createPublicKey(readFileSync(opt('--pub') ?? join(root, 'release.pub'), 'utf8'));
const signed = (data) => {
  const s = sign(null, data, key);
  if (!verify(null, data, pub, s))
    fail('this key is not PANOPTICA’s (it does not match release.pub): nothing was made');
  return s.toString('base64');
};

// ---- the licence
const today = new Date().toISOString().slice(0, 10),
  labId = opt('--lab-id') ?? randomUUID(),
  id = `L-${today.slice(2).replace(/-/g, '')}-${randomBytes(2).toString('hex')}`;
// the setup code: 16 letters and digits that cannot be confused (no 0/O, 1/I/L), in four groups; ~79 bits
const A = '23456789ABCDEFGHJKMNPQRSTUVWXYZ',
  code = flag('--no-setup')
    ? ''
    : [...randomBytes(16)]
        .map((b) => A[b % A.length])
        .join('')
        .replace(/(.{4})(?=.)/g, '$1-');
const licence = {
  v: 1,
  id,
  lab,
  ...(acronym ? { acronym } : {}),
  labId,
  modules: mods,
  tier,
  users,
  issued: today,
  made: new Date().toISOString(),
  ...(code ? { setup: createHash('sha256').update(code.replace(/-/g, '')).digest('hex') } : {}),
};
const body = JSON.stringify(licence, null, 2);
// signed before anything is written: a wrong key leaves nothing behind
const licenceFile = JSON.stringify({ body, sig: signed(Buffer.from(body, 'utf8')) }, null, 2) + '\n';
const slug = (acronym || lab)
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^\w]+/g, '-')
  .replace(/^-|-$/g, '')
  .toLowerCase();
const out = resolve(opt('--out') ?? join(root, 'out/labs'), `${slug}-${id}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
made = out;
writeFileSync(join(out, 'licence.json'), licenceFile);

// ---- the sheet for the install crew
const dmy = (d) => d.split('-').reverse().join('/');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const names = { devices: 'Electronic Devices' },
  modNames = mods.map((m) => names[m] ?? m).join(', ');
const sheet = `# Installing PANOPTICA: ${lab}${acronym ? ` (${acronym})` : ''}

Licence ${id}, issued ${dmy(today)}. Modules: ${modNames}. Tier ${tier}: up to ${users} people.
Lab id: \`${labId}\` (the builder needs it for this lab's next licences).

## On the lab's server

1. Copy \`licence.json\` to the server (a USB stick is fine). The internet is not needed.
2. Run PANOPTICA Setup ${version} or later (the Windows \`.exe\` or the macOS \`.dmg\` from the release), as an administrator.
   On the Licence file page, choose \`licence.json\`: Setup shows the lab, the modules and the tier. Setup installs the package
   for these modules and starts PANOPTICA in the background whenever the computer starts.
3. ${
  code
    ? `Open PANOPTICA on the server (http://localhost:3000), or from another computer on the lab network with the setup code:

   **Setup code: \`${code}\`**

   Create the first admin with the lab's responsible person, and fill in the lab's full name and acronym. The code works once;
   after the first admin exists the setup is closed.`
    : 'Sign in as the lab’s admin on the server. The new licence goes in Admin settings › Licence, chosen on the server itself.'
}
4. Under Admin settings › Backups, choose a second place for the backups (another disk, or the institution's storage): a
   computer that fails must not take the lab's data with it.
5. Keep \`licence.json\` with the lab's records. PANOPTICA needs it: if it is lost, PANOPTICA makes a copy for this lab id.

## What the licence does

- Only the modules it lists start.
- Up to ${users} people may have a working account at once (requests waiting and ended visits do not count). At that number,
  accepting a request or adding a visitor is refused with a note to contact PANOPTICA; everyone else keeps working.
- Updates are free.
- An upgrade or a module bought later: make a new licence for this lab id (\`--no-setup\`); the lab's admin installs it in Admin
  settings › Licence, on the server.

Keep this sheet with the lab's records. ${code ? 'Destroy it, or strike out the setup code, once the setup is done.' : ''}
`;
writeFileSync(join(out, 'install-sheet.md'), sheet);
made = '';
console.log(`made ${out}
  licence ${id} for ${lab}${acronym ? ` (${acronym})` : ''} (lab id ${labId}): ${mods.join(', ')}, tier ${tier}, ${users} people
  ${code ? 'setup code on install-sheet.md' : 'no setup code'}`);
