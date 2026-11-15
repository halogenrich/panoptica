// PANOPTICA's licence builder (0.46; tiers and lab names 0.49), for PANOPTICA staff only: makes what one lab needs to install
// PANOPTICA with PANOPTICA Setup. This is the command line; `npm run builder` opens the same thing as a page (ui.mjs, 0.50),
// which also keeps the list of the licences issued. Both sign through licence.mjs.
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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLicence, presentModules, TIERS } from './licence.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2),
  opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined),
  flag = (n) => args.includes(n);
const fail = (m) => {
  console.error('builder: ' + m);
  process.exit(1);
};

// ---- what to make
const lab = opt('--lab')?.trim().replace(/\s+/g, ' ');
if (!lab) fail('give the lab’s full name: --lab "Full lab name"');
const acronym = opt('--acronym')?.trim() ?? '';
if (acronym.length > 24) fail('the acronym is longer than 24 characters');
const present = presentModules(root);
const mods = (opt('--modules') ?? '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean)
  .sort();
if (!mods.length) fail('give the modules the lab bought: --modules devices (the core is never installed alone)');
for (const m of mods) if (!present.includes(m)) fail(`there is no module ${m} (modules: ${present.join(', ')})`);
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

// ---- the licence and the sheet for the install crew; signed and checked before anything is written, so a wrong key
// leaves nothing behind
let made;
try {
  made = makeLicence({
    lab,
    acronym,
    modules: mods,
    tier,
    users,
    keyPem: pem,
    pubPem: readFileSync(opt('--pub') ?? join(root, 'release.pub'), 'utf8'),
    labId: opt('--lab-id'),
    setup: !flag('--no-setup'),
    version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  });
} catch (e) {
  fail(e.message);
}
const out = resolve(opt('--out') ?? join(root, 'out/labs'), made.folder);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'licence.json'), made.file);
writeFileSync(join(out, 'install-sheet.md'), made.sheet);
console.log(`made ${out}
  licence ${made.id} for ${lab}${acronym ? ` (${acronym})` : ''} (lab id ${made.labId}): ${mods.join(', ')}, tier ${tier}, ${users} people
  ${made.code ? 'setup code on install-sheet.md' : 'no setup code'}`);
