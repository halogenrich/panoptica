// What the command-line builder (builder.mjs) and the builder's page (ui.mjs, 0.50) share: checking what was asked, signing
// the licence and writing the install sheet. Nothing here reads or writes a file, and the key is used and let go.
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, sign, verify } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** People each tier covers; tier 3 is the number agreed with the lab (more than 50). */
export const TIERS = { 1: 10, 2: 50 };
export const MODULE_NAMES = { devices: 'Electronic Devices' };
export const moduleName = (m) => MODULE_NAMES[m] ?? m;

/** The modules in this copy of the repository. */
export const presentModules = (root) =>
  readdirSync(join(root, 'modules'))
    .filter((m) => existsSync(join(root, 'modules', m, 'server/src/index.ts')))
    .sort();

/** What is wrong with a request for a licence, in words for the person filling the form; '' when nothing is. */
export function problem({ lab, acronym, modules, tier, users }, present) {
  if (!lab) return 'Enter the lab’s full name.';
  if (lab.length > 120) return 'The full name is longer than 120 characters.';
  if ((acronym ?? '').length > 24) return 'The acronym is longer than 24 characters.';
  if (!modules?.length) return 'Choose at least one module: the core is never installed alone.';
  for (const m of modules) if (!present.includes(m)) return `There is no module ${m}.`;
  if (![1, 2, 3].includes(tier)) return 'Choose the tier.';
  if (!Number.isInteger(users) || users < 1) return 'Enter the number of people agreed with the lab.';
  if (tier !== 3 && users !== TIERS[tier]) return `Tier ${tier} covers ${TIERS[tier]} people.`;
  if (tier === 3 && users <= 50) return 'Tier 3 is for more than 50 people. Choose a smaller tier, or a larger number.';
  return '';
}

export const KEY_UNREADABLE = 'the key cannot be read (an Ed25519 private key in PEM)',
  KEY_FOREIGN = 'this key is not PANOPTICA’s (it does not match release.pub): nothing was made';

const dmy = (d) => d.split('-').reverse().join('/');
export const slugOf = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

/**
 * One lab's licence, signed, with its install sheet. `labId` is given for a lab that already has a licence (an upgrade, a
 * module added); `setup: false` leaves the setup code out (that lab is set up already). Throws an Error whose message says
 * what is wrong; the licence is checked against the public key before it is handed out, so a wrong key makes nothing.
 */
export function makeLicence({ lab, acronym = '', modules, tier, users, keyPem, pubPem, labId, setup = true, version }) {
  let key;
  try {
    key = createPrivateKey(String(keyPem).replace(/\r/g, '').trim() + '\n');
  } catch {
    throw new Error(KEY_UNREADABLE);
  }
  const pub = createPublicKey(pubPem);
  const mods = [...modules].sort();
  const today = new Date().toISOString().slice(0, 10),
    id = `L-${today.slice(2).replace(/-/g, '')}-${randomBytes(2).toString('hex')}`;
  labId ??= randomUUID();
  // the setup code: 16 letters and digits that cannot be confused (no 0/O, 1/I/L), in four groups; ~79 bits
  const A = '23456789ABCDEFGHJKMNPQRSTUVWXYZ',
    code = setup
      ? [...randomBytes(16)]
          .map((b) => A[b % A.length])
          .join('')
          .replace(/(.{4})(?=.)/g, '$1-')
      : '';
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
  const body = JSON.stringify(licence, null, 2),
    data = Buffer.from(body, 'utf8');
  let sig;
  try {
    sig = sign(null, data, key);
  } catch {
    throw new Error(KEY_UNREADABLE);
  }
  if (!verify(null, data, pub, sig)) throw new Error(KEY_FOREIGN);
  const file = JSON.stringify({ body, sig: sig.toString('base64') }, null, 2) + '\n';

  const modNames = mods.map(moduleName).join(', ');
  const sheet = `# Installing PANOPTICA: ${lab}${acronym ? ` (${acronym})` : ''}

Licence ${id}, issued ${dmy(today)}. Modules: ${modNames}. Tier ${tier}: up to ${users} people.
Lab id: \`${labId}\` (the builder needs it for this lab's next licences).

## On the lab's server

1. Copy \`licence.json\` to the server (a USB stick is fine). The internet is not needed.
2. Run PANOPTICA Setup ${version} or later (the \`.exe\` from the release), as an administrator.
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
- An upgrade or a module bought later: make a new licence for this lab id (\`--no-setup\`, or New licence in the builder's
  page); the lab's admin installs it in Admin settings › Licence, on the server.

Keep this sheet with the lab's records. ${code ? 'Destroy it, or strike out the setup code, once the setup is done.' : ''}
`;
  return { id, labId, licence, file, sheet, code, folder: `${slugOf(acronym || lab)}-${id}` };
}
