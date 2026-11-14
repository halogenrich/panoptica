// PANOPTICA's internal builder (0.46), for PANOPTICA staff only: makes what one lab needs to install PANOPTICA.
//
//   node tools/builder/builder.mjs --lab "Lab name" --modules devices --updates-until 2027-12-31 --key path/to/key.pem
//        [--lab-id <id>] [--package path/to/panoptica-devices.zip | --build] [--no-setup] [--out folder]
//
// Writes <out>/<lab>-<licence id>/:
//   licence.json        the lab's licence, signed with PANOPTICA's key: lab, lab id, modules, issued, last day of updates, and
//                       the hash of a one-time setup code
//   install-sheet.md    for the install crew: what to copy where, and the setup code (the code is only on this sheet)
//   panoptica-<modules>.zip and .sig   with --package (a release's package for these modules, its .sig next to it), or
//                       --build (packaged from this source and signed with the key)
// The first licence of a lab gets a new lab id; give the same --lab-id for that lab's later licences (renewal, a module added),
// or the lab's PANOPTICA refuses them. Later licences need no setup code (--no-setup): the lab is set up already.
//
// The key is PANOPTICA's private signing key (Ed25519, PEM): read from --key or the SIGNING_KEY environment variable, used, and
// never written anywhere. Everything signed is checked against release.pub (or --pub, for tests), so the builder never hands out
// a licence or package the app would refuse.
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, sign, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
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
const lab = opt('--lab')?.trim();
if (!lab) fail('give the lab’s name: --lab "Lab name"');
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
const until = opt('--updates-until');
if (!/^\d{4}-\d{2}-\d{2}$/.test(until ?? '') || isNaN(Date.parse(until)))
  fail('give the last day of updates as yyyy-mm-dd: --updates-until 2027-12-31');
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
  labId,
  modules: mods,
  issued: today,
  made: new Date().toISOString(),
  updatesUntil: until,
  ...(code ? { setup: createHash('sha256').update(code.replace(/-/g, '')).digest('hex') } : {}),
};
const body = JSON.stringify(licence, null, 2);
// signed before anything is written: a wrong key leaves nothing behind
const licenceFile = JSON.stringify({ body, sig: signed(Buffer.from(body, 'utf8')) }, null, 2) + '\n';
const slug = lab
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\w]+/g, '-')
  .replace(/^-|-$/g, '')
  .toLowerCase();
const out = resolve(opt('--out') ?? join(root, 'out/labs'), `${slug}-${id}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
made = out;
writeFileSync(join(out, 'licence.json'), licenceFile);

// ---- the package for these modules
const pkgName = `panoptica-${mods.join('+')}.zip`;
let pkgNote;
if (opt('--package')) {
  const p = resolve(opt('--package'));
  if (!existsSync(p) || !existsSync(p + '.sig')) fail(`${p} and its .sig are needed`);
  if (basename(p) !== pkgName && basename(p) !== 'panoptica.zip')
    fail(`${basename(p)} is not the package for ${mods.join(', ')} (${pkgName})`);
  const data = readFileSync(p),
    s = Buffer.from(readFileSync(p + '.sig', 'utf8').trim(), 'base64');
  if (!verify(null, data, pub, s)) fail(`${basename(p)} is not signed by PANOPTICA`);
  copyFileSync(p, join(out, pkgName));
  copyFileSync(p + '.sig', join(out, pkgName + '.sig'));
  pkgNote = `${pkgName}, in this folder,`;
} else if (flag('--build')) {
  const tmp = join(out, 'build');
  execFileSync(process.execPath, [join(root, 'tools/package.mjs'), tmp, '--modules', mods.join(',')], {
    stdio: 'inherit',
  });
  execFileSync('zip', ['-qr', join(out, pkgName), 'panoptica'], { cwd: tmp });
  rmSync(tmp, { recursive: true, force: true });
  writeFileSync(join(out, pkgName + '.sig'), signed(readFileSync(join(out, pkgName))) + '\n');
  pkgNote = `${pkgName}, in this folder (built from source),`;
} else
  pkgNote = `${pkgName} from the latest PANOPTICA release (version ${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version} or later; check it with its .sig)`;

// ---- the sheet for the install crew
const dmy = (d) => d.split('-').reverse().join('/');
const sheet = `# Installing PANOPTICA: ${lab}

Licence ${id}, issued ${dmy(today)}. Modules: ${mods.join(', ')}. Updates until ${dmy(until)}.
Lab id: \`${labId}\` (the builder needs it for this lab's next licences).

## On the lab computer

1. Install Node.js 22 (LTS) if it is not there.
2. Unzip ${pkgNote} into the folder PANOPTICA will live in (for example \`C:\\PANOPTICA\` or \`/opt/panoptica\`).
3. Put \`licence.json\` in the \`panoptica\` folder, next to the start scripts. PANOPTICA installs it when it starts.
4. Start PANOPTICA so the lab's network can reach it. On Linux, as a service that starts with the computer:
   \`./install-shortcut.sh --service lan\`. On Windows: \`start-network.bat\` (and a shortcut to it in \`shell:startup\`).
5. ${
  code
    ? `From any computer on the lab network, open PANOPTICA (the address \`start\` prints). It asks for the setup code:

   **Setup code: \`${code}\`**

   Then create the first admin with the lab's responsible person and set up the lab. The code works once; after the first
   admin exists the setup is closed.`
    : 'Sign in as the lab’s admin. Under Admin settings › Licence the new licence shows its modules and its last day of updates.'
}
6. Under Admin settings › Backups, choose a second place for the backups (another disk, or the institution's storage): a
   computer that fails must not take the lab's data with it.

## What the licence does

- Only the modules it lists start.
- Versions published until ${dmy(until)} can be installed (Admin settings › Updates, or from a USB stick with the update
  script). After that day everything keeps working and every record can still be exported; only new versions stop.
- A module bought later: make a new licence for this lab id with the larger module set (\`--no-setup\`), and install the
  package for those modules as an update; the licence file goes in Admin settings › Licence.

Keep this sheet with the lab's records. ${code ? 'Destroy it, or strike out the setup code, once the setup is done.' : ''}
`;
writeFileSync(join(out, 'install-sheet.md'), sheet);
made = '';
console.log(`made ${out}
  licence ${id} for ${lab} (lab id ${labId}): ${mods.join(', ')}, updates until ${until}
  ${code ? 'setup code on install-sheet.md' : 'no setup code'}; package: ${pkgNote}`);
