// Browser tests: the main flows clicked through in a real browser (Chromium), on a new install.
//   node --import tsx tools/browser.mjs            the server from source (apps/server/src) with the built web app (apps/web/dist)
//   node --import tsx tools/browser.mjs --built    the packaged server (out/panoptica, from tools/package.mjs)
// Flows: first setup (installed as PANOPTICA Setup does, with a licence), the licence in Admin settings, sign out and in, the side menu, equipment, a booking, a stack's run sheet, starting a batch and its run
// sheet, booking for the batch, search, a J–V import, the Overview, the trash, consumption, the builder's page; 0.52: the Node
// shown in Admin settings › Updates, and the Node a newer release brings (from a fake GitHub). On a failure it saves a screenshot and the page's errors in out/browser-failure.png and prints the server log.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { zipSync } from 'fflate';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { txtFiles } from '../modules/devices/shared/src/ivfixtures.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const BUILT = process.argv.includes('--built'),
  // --core (0.43): the core alone, without Electronic Devices (the package made with --modules none, out/core/panoptica)
  CORE = process.argv.includes('--core');
const freePort = () =>
  new Promise((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => ok(p));
    });
  });
const PORT = await freePort(),
  base = `http://127.0.0.1:${PORT}`,
  tmp = mkdtempSync(join(tmpdir(), 'panoptica-browser-'));
const PW = 'Browser-test-1!';
// installed as PANOPTICA Setup does (0.49): config/install.json and the lab's licence, signed with a throwaway key
const testKey = generateKeyPairSync('ed25519'),
  licenceBody = JSON.stringify({
    v: 1,
    id: 'L-BROWSER-1',
    lab: 'Browser Laboratory of Thin Films',
    acronym: 'BLTF',
    labId: 'browser-lab',
    modules: CORE ? [] : ['devices'],
    tier: 1,
    users: 10,
    issued: '2026-11-14',
  });
mkdirSync(join(tmp, 'config'), { recursive: true });
// what the update script leaves when PANOPTICA did not start on a new Node and the old one went back (0.52)
mkdirSync(join(tmp, 'updates'), { recursive: true });
writeFileSync(join(tmp, 'updates/runtime-failed.txt'), 'to=99.0.0\r\nfrom=26.13.1\r\nreason=start\r\n');
writeFileSync(join(tmp, 'config/install.json'), JSON.stringify({ by: 'setup' }));
writeFileSync(
  join(tmp, 'config/licence.json'),
  JSON.stringify({
    body: licenceBody,
    sig: sign(null, Buffer.from(licenceBody), testKey.privateKey).toString('base64'),
  }),
);

// a fake GitHub with one newer release that carries another Node (0.52); nothing is downloaded from it here
const GH = await freePort(),
  otherNode = process.versions.node.replace(/^(\d+)\..*/, (_, m) => `${m}.99.0`);
// the package is a few bytes signed with the test key; the Node file is signed too, but its node.exe is not Node for Windows,
// so the app refuses it and the update goes on without it
const pkg = Buffer.from('a package for the browser test'),
  nodeZip = Buffer.from(zipSync({ 'node/node.exe': Buffer.from('MZ not Node') })),
  sha = (b) => createHash('sha256').update(b).digest('hex'),
  sig = (b) => sign(null, b, testKey.privateKey).toString('base64'),
  assetBody = [pkg, sha(pkg), sig(pkg), nodeZip, sha(nodeZip), sig(nodeZip)];
const gh = createHttpServer((q, r) => {
  const a = q.url.match(/\/releases\/assets\/(\d+)$/);
  if (a && assetBody[+a[1] - 1]) return r.writeHead(200).end(assetBody[+a[1] - 1]);
  if (q.url !== '/repos/lab/app/releases/latest') return r.writeHead(404).end('{}');
  r.writeHead(200, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      tag_name: 'v99.0.0',
      name: 'PANOPTICA 99.0.0',
      body: 'What changed for the lab.',
      published_at: new Date().toISOString(),
      html_url: 'x',
      assets: [
        ['panoptica.zip', 2_400_000],
        ['panoptica.zip.sha256', 80],
        ['panoptica.zip.sig', 89],
        [`panoptica-node-${otherNode}-win-x64.zip`, 39_400_000],
        [`panoptica-node-${otherNode}-win-x64.zip.sha256`, 100],
        [`panoptica-node-${otherNode}-win-x64.zip.sig`, 89],
      ].map(([name, size], i) => ({ id: i + 1, name, size })),
    }),
  );
}).listen(GH, '127.0.0.1');

const srv = spawn(
  process.execPath,
  BUILT ? ['--no-warnings', 'dist/server.mjs'] : ['--import', 'tsx', 'src/index.ts'],
  {
    cwd: join(root, BUILT ? (CORE ? 'out/core/panoptica/apps/server' : 'out/panoptica/apps/server') : 'apps/server'),
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DB_PATH: join(tmp, 'data.db'),
      BACKUP_DIR: join(tmp, 'backups'),
      CONFIG_DIR: join(tmp, 'config'),
      UPDATES_DIR: join(tmp, 'updates'),
      ADMIN_PASSWORD: '', // a new install: the first setup makes the admin
      PANOPTICA_TEST: '1',
      UPDATE_PUBLIC_KEY: testKey.publicKey.export({ type: 'spki', format: 'pem' }),
      UPDATE_API: `http://127.0.0.1:${GH}`,
      UPDATE_REPO: 'lab/app',
      // the Node part of updates, which applies to Setup installs on Windows (0.52)
      PANOPTICA_TEST_RUNTIME: '1',
      ...(CORE && !BUILT ? { PANOPTICA_MODULES: 'none' } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let log = '';
srv.stdout.on('data', (d) => (log += d));
srv.stderr.on('data', (d) => (log += d));
for (let i = 0; ; i++) {
  try {
    if ((await fetch(base + '/api/version')).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 120) throw new Error('the server did not start:\n' + log);
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-GB', timezoneId: 'UTC' });
const page = await ctx.newPage();
page.setDefaultTimeout(10_000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let passed = 0;
const step = async (name, fn) => {
  process.stdout.write(`  ${name} … `);
  await fn();
  if (errors.length) throw new Error('errors in the page: ' + errors.join(' | '));
  passed++;
  console.log('ok');
};
const expect = (cond, what) => {
  if (!cond) throw new Error(what);
};
const api = (method, path, body) =>
  page.evaluate(
    async ([m, p, b]) => {
      const r = await fetch(p, {
        method: m,
        headers: b ? { 'content-type': 'application/json' } : {},
        body: b ? JSON.stringify(b) : undefined,
      });
      return { s: r.status, j: await r.json().catch(() => null) };
    },
    [method, '/api' + path, body],
  );
const nav = (label) => page.locator('nav.side').getByRole('button', { name: label, exact: true }).click();
/** Clicks the button, catching what would be printed: window.print is replaced, and the state of the page recorded then. */
const printOf = async (button) => {
  await page.evaluate(() => {
    window.__printed = null;
    window.print = () => {
      const portal = document.querySelector('.print-portal');
      window.__printed = {
        mode: document.body.classList.contains('print-mode'),
        title: portal?.querySelector('.sheet h2')?.textContent ?? '',
        text: portal?.textContent ?? '',
      };
    };
  });
  // clicked from the page: Playwright's own click can wait on a navigation the print button never makes (seen in CI), and a
  // click while the window is still opening can be lost, so click again if nothing was printed
  await button.waitFor();
  for (let i = 0; ; i++) {
    await button.evaluate((b) => b.click());
    const done = await page
      .waitForFunction(() => window.__printed !== null, null, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (done) break;
    if (i === 2) throw new Error('nothing was printed after three clicks');
  }
  // Safari's print() returns at once and lays the page out for printing afterwards: the sheet must still be there then
  await page.waitForTimeout(400);
  const after = await page.evaluate(
    () => document.body.classList.contains('print-mode') && !!document.querySelector('.print-portal .sheet'),
  );
  return { ...(await page.evaluate(() => window.__printed)), after };
};
/** "Later" on the "Complete your profile" window, when it shows. */
const later = async () => {
  const b = page.getByRole('button', { name: 'Later' });
  if (await b.isVisible().catch(() => false)) await b.click();
};

console.log(`Browser tests (${BUILT ? 'packaged server' : 'server from source'}${CORE ? ', the core alone' : ''})`);
try {
  let username = '',
    bookDay = ''; // the day of the booking outside a batch
  await step('first setup offers to restore the lab from a backup, and says what is wrong (0.53)', async () => {
    await page.goto(base);
    await page.getByRole('button', { name: 'Restore from a backup' }).click();
    await page.getByRole('heading', { name: 'Restore from a backup' }).waitFor();
    if (process.env.SHOTS) mkdirSync(join(root, 'out'), { recursive: true });
    const shot = async (name) => {
      if (process.env.SHOTS) await page.screenshot({ path: join(root, 'out', name), fullPage: true });
    };
    await shot('restore-file.png');
    // a file that is not a backup is said at once
    await page.locator('.setup-page input[type=file]').setInputFiles({
      name: 'notes.db',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('these are notes, not a PANOPTICA backup at all'),
    });
    await page.locator('.setup-page .err').getByText('This file is not a PANOPTICA backup.').waitFor();
    expect(
      await page.getByRole('button', { name: 'Restore the lab' }).isDisabled(),
      'Restore the lab is offered without a backup',
    );
    // a folder: the backups are listed by date; a folder that does not exist is said so
    await page.getByRole('tab', { name: 'A folder of backups' }).click();
    await page.getByLabel('Folder').fill(join(tmp, 'nowhere'));
    await page.getByRole('button', { name: 'List backups' }).click();
    await page
      .locator('.setup-page .err')
      .getByText(/the folder does not exist/)
      .waitFor();
    // an encrypted copy, made with a key of the test's: it asks for the key, and a wrong one is refused
    const share = join(tmp, 'share');
    mkdirSync(share, { recursive: true });
    const { createCipheriv, randomBytes } = await import('node:crypto');
    const iv = randomBytes(12),
      c = createCipheriv('aes-256-gcm', randomBytes(32), iv),
      body = Buffer.concat([c.update(Buffer.from('SQLite format 3\0 and more')), c.final()]);
    writeFileSync(
      join(share, 'data-20261116-213000-auto.db.enc'),
      Buffer.concat([Buffer.from('PLB1'), iv, body, c.getAuthTag()]),
    );
    await page.getByLabel('Folder').fill(share);
    await page.getByRole('button', { name: 'List backups' }).click();
    await page.locator('.restore-list').getByText('16/11/2026 21:30').waitFor();
    await page.locator('.restore-list').getByText(', encrypted').waitFor();
    await shot('restore-folder.png');
    if (process.env.SHOTS) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForTimeout(600);
      await shot('restore-folder-390-dark.png');
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Backup key' }).waitFor();
    await page.getByRole('tab', { name: 'Type the key' }).click();
    await page.getByLabel('Backup key').fill('ab'.repeat(32));
    await shot('restore-key.png');
    await page.getByRole('button', { name: 'Restore the lab' }).click();
    await page
      .locator('.setup-page .err')
      .getByText(/The backup key does not open this backup/)
      .waitFor();
    expect(
      (await api('GET', '/lab/public')).j.setup === 'here',
      'the install is no longer new after a refused restore',
    );
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('heading', { name: 'Restore from a backup' }).waitFor();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('heading', { name: 'Set up PANOPTICA' }).waitFor();
  });

  await step('first setup makes the admin and the lab', async () => {
    await page.goto(base);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel(/First name/i).fill('Ada');
    await page.getByLabel(/Surname/i).fill('Lovelace');
    await page.locator('input[type=email]').fill('ada@example.edu');
    await page.locator('input[type=date]').fill('1990-12-10');
    await page.getByLabel('Department').fill('Physics');
    await page.locator('input[type=password]').nth(0).fill(PW);
    await page.locator('input[type=password]').nth(1).fill(PW);
    await page.getByRole('button', { name: 'Continue' }).click();
    // the lab's full name and acronym, shown by its acronym (0.49)
    await page.getByLabel('Full name', { exact: true }).fill('Test Laboratory of Thin Films');
    await page.getByLabel('Acronym', { exact: true }).fill('Test Lab');
    await page.locator('.setup-page').getByRole('tab', { name: 'Acronym' }).click();
    await page.locator('.setup-rail').getByText('Test Lab').waitFor();
    await page.getByLabel('Institution', { exact: true }).fill('Example University');
    await page.getByRole('button', { name: 'Continue' }).click();
    // the Network step (0.51): the lab's address, checked by the server before going on
    await page.getByRole('heading', { name: 'Network' }).waitFor();
    await page.getByLabel('The lab’s address').fill('HTTP://Panoptica-Browser.Example/');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Sign-in screen' }).waitFor();
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('.setup-foot .btn').click(); // finish
    // 0.53: the recovery file, downloaded and said to be kept elsewhere, before going on
    await page.getByRole('heading', { name: 'Save the recovery file' }).waitFor();
    if (process.env.SHOTS) {
      await page.screenshot({ path: join(root, 'out', 'recovery-file.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(root, 'out', 'recovery-file-390-dark.png') });
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    expect(await page.getByRole('checkbox').isDisabled(), 'the recovery file can be confirmed before it is downloaded');
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Download the recovery file' }).click(),
    ]);
    const rf = JSON.parse(readFileSync(await dl.path(), 'utf8'));
    expect(
      rf.type === 'PANOPTICA recovery file' && /^[0-9a-f]{64}$/.test(rf.key) && rf.labId === 'browser-lab',
      'the recovery file holds the key and the lab id',
    );
    expect(/^PANOPTICA-recovery-Test-Lab\.json$/.test(dl.suggestedFilename()), 'the recovery file’s name');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('.top .brand').getByText('Test Lab').waitFor();
    await later();
    username = (await api('GET', '/me')).j.username;
    expect(!!username, 'no account after the setup');
  });

  await step('Admin settings › Backups: the recovery file, and when it was downloaded (0.53)', async () => {
    await page.evaluate(() => (window.location.hash = '#/users'));
    await page.getByRole('tab', { name: 'Backups', exact: true }).click();
    await page.getByRole('heading', { name: 'Recovery file' }).waitFor();
    await page.getByText(/^Last downloaded /).waitFor();
    await page.getByText('Restore from a backup', { exact: true }).waitFor();
    if (process.env.SHOTS) await page.screenshot({ path: join(root, 'out', 'backups-tab.png'), fullPage: true });
  });

  await step('Admin settings › Licence shows the licence’s lab, modules and people', async () => {
    await page.evaluate(() => (window.location.hash = '#/users'));
    await page.getByRole('tab', { name: 'Licence', exact: true }).click();
    const lic = page.locator('.lic');
    await lic.getByText('Browser Laboratory of Thin Films').waitFor();
    await lic.getByText('1 of 10').waitFor();
    await lic.getByText('Choose', { exact: false }).or(lic.getByText('Install a new licence…')).first().waitFor();
    await page.getByRole('tab', { name: 'Lab setup', exact: true }).click();
    expect(
      (await page.getByLabel('Acronym', { exact: true }).inputValue()) === 'Test Lab',
      'the lab’s own acronym is not in Lab setup',
    );
  });

  await step('Admin settings › Network shows the lab’s address; the sign-in footer is a toggle', async () => {
    const port = new URL(base).port;
    const url = `http://panoptica-browser.example${port && port !== '80' ? ':' + port : ''}`;
    await page.getByRole('tab', { name: 'Network', exact: true }).click();
    await page.locator('.net dd').getByText(url, { exact: true }).waitFor();
    expect((await api('GET', '/lab/public')).j.url === url, 'the lab’s address is not public');
    // nothing changed: Save stays off; a wrong address is named before saving
    const save = page.locator('.net-form').getByRole('button', { name: 'Save' });
    expect(await save.isDisabled(), 'Save is on with nothing changed');
    await page.getByLabel('The lab’s address').fill('lab server');
    await page
      .locator('.net-form .err')
      .getByText(/letters, digits/)
      .waitFor();
    await page.getByLabel('The lab’s address').fill('panoptica-browser.example');
    // the footer of the sign-in panel: Name / Logo / Both, shown once there is an institution logo
    await page.getByRole('tab', { name: 'Lab setup', exact: true }).click();
    await page
      .locator('.fld', { hasText: 'Institution logo' })
      .locator('input[type=file]')
      .setInputFiles({
        name: 'inst.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64',
        ),
      });
    await page.getByRole('tab', { name: 'Both', exact: true }).click();
    // Lab setup saves section by section: the Save of the section that holds the footer
    await page
      .locator('section, form')
      .filter({ hasText: 'At the bottom of the sign-in panel' })
      .last()
      .getByRole('button', { name: 'Save', exact: true })
      .click();
    let foot = '';
    for (let i = 0; i < 40 && foot !== 'both'; i++, await page.waitForTimeout(250))
      foot = (await api('GET', '/lab/public')).j.foot;
    expect(foot === 'both', `the footer was saved as ${foot}, not Both`);
  });

  await step('Admin settings › Updates shows the Node it runs and the Node a newer release brings (0.52)', async () => {
    await page.getByRole('tab', { name: 'Updates', exact: true }).click();
    const upd = page.locator('.upd');
    await upd.getByText(`Node ${process.versions.node}`, { exact: true }).waitFor();
    await upd.getByRole('button', { name: 'Check now' }).click();
    await upd.getByText(`Node ${otherNode}`, { exact: true }).waitFor();
    await upd.getByText(`This update also brings Node ${otherNode}.`).waitFor();
    // the download counts the package and Node: 2.4 MB + 39.4 MB
    await upd.getByRole('button', { name: 'Download (39.9 MB)' }).waitFor();
    await upd
      .getByText('PANOPTICA did not start on Node 99.0.0, so the old Node was put back.', { exact: false })
      .waitFor();
    await upd.getByRole('button', { name: 'Download (39.9 MB)' }).click();
    await upd.getByText('Downloaded and checked').waitFor();
    await upd
      .getByText(`Node ${otherNode} was not accepted: its node.exe is not Node for Windows.`, { exact: false })
      .waitFor();
    if (process.env.SHOTS) {
      mkdirSync(join(root, 'out'), { recursive: true });
      const shot = async (name) => writeFileSync(join(root, 'out', name), await page.screenshot({ fullPage: false }));
      await shot('updates-1400.png');
      // after the theme's and the layout's transitions
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForTimeout(600);
      await shot('updates-1400-dark.png');
      await page.emulateMedia({ colorScheme: 'light' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(600);
      await shot('updates-390.png');
      await page.setViewportSize({ width: 1400, height: 900 });
    }
  });

  await step('sign out and sign in again', async () => {
    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await page.getByRole('heading', { name: 'Sign in' }).waitFor();
    await page.locator('.signin-address').getByText('panoptica-browser.example').waitFor();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(PW);
    await page.keyboard.press('Enter');
    await page.locator('.top .brand').getByText('Test Lab').waitFor();
    await later();
  });

  await step(
    CORE
      ? 'the side menu has the core’s pages only'
      : 'the side menu has the core’s pages and Electronic Devices’ groups',
    async () => {
      const groups = await page.locator('nav.side .glabel').allTextContents();
      expect(
        groups.join(',') === (CORE ? 'Lab' : 'Fabrication,Measurements,Recipes,Designs,Lab'),
        'side menu groups: ' + groups.join(', '),
      );
      if (CORE) {
        const items = await page.locator('nav.side .navitem').allTextContents();
        expect(
          items.map((x) => x.trim()).join(',') === 'Overview,Calendar,Inventory,Equipment,Trash',
          'core menu: ' + items.join(', '),
        );
        return;
      }
      const fab = await page
        .locator('nav.side > div')
        .filter({ has: page.locator('.glabel', { hasText: 'Fabrication' }) })
        .locator('.navitem')
        .allTextContents();
      expect(fab.join(',') === 'Stacks,Batches,Calendar', 'Fabrication: ' + fab.join(', '));
    },
  );

  await step('equipment is added under Lab › Equipment', async () => {
    await nav('Equipment');
    await page.getByRole('button', { name: 'New equipment' }).click();
    const dlg = page.locator('.modal, .dialog').filter({ hasText: 'New equipment' }).last();
    await dlg.getByLabel('Name').fill('Spin coater A');
    if (!CORE) await dlg.getByRole('button', { name: 'Spin coating' }).click();
    await dlg.getByRole('button', { name: 'Add equipment' }).click();
    // the new equipment opens in its sheet, once it is saved: the "New equipment" window closes first (it also says "What it
    // can do", so waiting for that text alone could catch it still open while a slow server saves)
    await page.locator('.modal.eq-new').waitFor({ state: 'detached' });
    const sheet = page.locator('.modal-scrim').filter({ has: page.locator('.modal.eq-sheet') });
    await sheet.waitFor();
    expect(
      await sheet.evaluate((el) => [...el.querySelectorAll('input')].some((x) => x.value === 'Spin coater A')),
      'the sheet is not the new equipment’s',
    );
    // a window listens for Escape once it has been drawn and its effects have run: on a slow machine the first press can come
    // before that, so press again until it closes
    for (let i = 0; i < 10 && (await page.locator('.modal-scrim').count()); i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    }
    await page.locator('.modal-scrim').waitFor({ state: 'detached' });
    await page.waitForTimeout(400);
    expect(!(await page.locator('.modal-scrim').count()), 'the equipment sheet opened again after closing');
    const eq = (await api('GET', '/equipment')).j;
    expect(
      (eq.equipment ?? eq).some((e) => e.name === 'Spin coater A'),
      'the equipment is not saved',
    );
  });

  await step('a booking outside a batch is saved and shown', async () => {
    await nav('Calendar');
    await page.getByRole('button', { name: 'New booking' }).click();
    const dlg = page.getByRole('dialog', { name: 'New booking' });
    await dlg.getByRole('radio', { name: /Spin coater A/ }).click();
    await dlg
      .getByPlaceholder(/For example/)
      .first()
      .fill('Browser test run');
    const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
    bookDay = day;
    await dlg.locator('input[type=date]').fill(day);
    await dlg.locator('input[type=time]').nth(0).fill('10:00');
    await dlg.locator('input[type=time]').nth(1).fill('11:00');
    await dlg.getByRole('button', { name: /^(Book|Save)/ }).click();
    await dlg.waitFor({ state: 'detached' });
    const bk = (await api('GET', `/calendar?from=${day}T00:00:00.000Z&to=${day}T23:59:59.000Z`)).j;
    expect(
      (bk.bookings ?? []).some((b) => b.purpose === 'Browser test run'),
      'the booking is not saved',
    );
  });

  let stackId = 0;
  if (!CORE)
    await step('a stack prints its run sheet, not the page', async () => {
      const r = await api('POST', '/presets', {
        segment: 'stk',
        name: 'Browser stack',
        visibility: 'shared',
        data: { arch: 'n-i-p', sl: [] },
      });
      expect(r.s === 200, 'stack not created: ' + JSON.stringify(r.j));
      stackId = r.j.id;
      await page.goto(`${base}/#/stk/${stackId}`);
      await later();
      const pr = await printOf(page.getByRole('button', { name: 'Print run sheet' }));
      expect(pr.mode && pr.after, 'the page, not the run sheet, would be printed');
      expect(pr.title.includes('Browser stack'), `the run sheet is not the stack's: "${pr.title}"`);
      // back in the app (a key press, a second after the print dialog), print mode ends
      await page.waitForTimeout(1100);
      await page.keyboard.press('Shift');
      await page.waitForFunction(
        () => !document.body.classList.contains('print-mode') && !document.querySelector('.print-portal'),
      );
    });

  if (!CORE)
    await step(
      'Export PNG of the 3D view is at least 1000 × 1000, with the legend and without it (0.51.1)',
      async () => {
        const layers = [
          ['Hole transport', 40],
          ['Perovskite', 500],
          ['Electron transport', 30],
          ['Top contact', 100],
        ].map(([n, th], i) => ({ id: 'x' + i, n, m: 'Manual', a: '', b: '', t: '', th }));
        const r = await api('POST', '/presets', {
          segment: 'stk',
          name: 'Browser stack in 3D',
          visibility: 'private',
          data: { arch: 'n-i-p', sl: layers },
        });
        expect(r.s === 200, 'stack not created: ' + JSON.stringify(r.j));
        await page.goto(`${base}/#/stk/${r.j.id}`);
        await later();
        await page.locator('.viewer canvas').waitFor();
        await page.locator('.lbl').first().waitFor();
        await page.waitForTimeout(1500); // the layers drop in and the camera settles
        const size = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
        const exportPng = async (name) => {
          const [dl] = await Promise.all([
            page.waitForEvent('download'),
            page.getByRole('button', { name: 'Export PNG' }).click(),
          ]);
          const file = await dl.path(),
            png = (await import('node:fs')).readFileSync(file);
          expect(png.subarray(1, 4).toString() === 'PNG', 'the export is not a PNG');
          if (process.env.SHOTS) writeFileSync(join(root, 'out', name), png);
          return size(png);
        };
        // the stack page keeps the view's controls behind its cog
        const cog = page.getByRole('button', { name: 'View settings' });
        if (await cog.isVisible().catch(() => false)) await cog.click();
        const legend = page.locator('.viewer-bar input[type=checkbox]');
        for (const [name, on, lines] of [
          ['3d-tags.png', true, false],
          ['3d-lines.png', true, true],
          ['3d-no-legend.png', false, false],
        ]) {
          if ((await legend.isChecked()) !== on) await legend.click();
          if (on) await page.getByRole('button', { name: lines ? 'Lines' : 'Tags', exact: true }).click();
          await page.waitForTimeout(500);
          const s = await exportPng(name);
          expect(s.w >= 1000 && s.h >= 1000, `${name}: the export is ${s.w} × ${s.h} px`);
        }
        if (process.env.SHOTS) {
          // to look at (0.51.2): the ITO seen steeply from above, and the layers' order seen from below, exploded
          const view = page.locator('.viewer').first(),
            bb = await view.boundingBox(),
            cx = bb.x + bb.width / 2,
            cy = bb.y + bb.height / 2;
          await page.getByRole('button', { name: 'View settings' }).click(); // closed, so the stack fills the view
          await page.mouse.move(cx, cy);
          await page.mouse.wheel(0, -700);
          const drag = async (dx, dy) => {
            await page.mouse.move(cx, cy);
            await page.mouse.down();
            await page.mouse.move(cx + dx, cy + dy, { steps: 12 });
            await page.mouse.up();
            await page.waitForTimeout(1200);
          };
          for (const [name, dx, dy] of [
            ['view-steep.png', 0, 160],
            ['view-steep-turned.png', 220, 0],
            ['view-low.png', 0, -260],
            ['view-mid.png', 0, 90],
          ]) {
            await drag(dx, dy);
            await view.screenshot({ path: join(root, 'out', name) });
          }
          await page.getByRole('button', { name: 'View settings' }).click();
          await page.getByRole('button', { name: 'Flip: view from below' }).click();
          await page.getByRole('button', { name: 'View settings' }).click();
          await page.waitForTimeout(1500);
          await view.screenshot({ path: join(root, 'out', 'view-flipped.png') });
          await drag(0, 200);
          await view.screenshot({ path: join(root, 'out', 'view-flipped-steep.png') });
          await page.getByRole('button', { name: 'View settings' }).click();
          await page.getByRole('button', { name: 'Show top side' }).click();
        }
        // the legend switch is remembered in this browser: back as it was for the other flows
        if (!(await legend.isChecked())) await legend.click();
        await page.getByRole('button', { name: 'Tags', exact: true }).click();
      },
    );

  if (!CORE)
    await step('starting a batch asks only for its name and opens it', async () => {
      await page.getByRole('button', { name: 'Start batch' }).click();
      await page.getByLabel('Batch name').fill('Browser batch');
      await page.locator('.start-batch').getByRole('button', { name: 'Start batch' }).click();
      // the batch page, with its name as the title; no code anywhere (0.45). The dialog's field has the same name: it goes first
      await page.locator('.start-batch').waitFor({ state: 'detached' });
      await page.waitForURL(/#\/batches\/\d+/);
      await page.getByRole('textbox', { name: 'Batch name' }).waitFor({ timeout: 20000 });
      expect(
        (await page.getByRole('textbox', { name: 'Batch name' }).inputValue()) === 'Browser batch',
        'the batch page is not titled by its name',
      );
      expect(!/\bB-\d{6}-\d+\b/.test(await page.locator('body').innerText()), 'a batch code is shown');
      // what it will take from the inventory (0.45)
      await page.getByRole('heading', { name: 'From the inventory' }).waitFor();
    });

  if (!CORE)
    await step('the batch prints its run sheet, not the page', async () => {
      const pr = await printOf(page.getByRole('button', { name: 'Print run sheet' }));
      expect(pr.mode && pr.after, 'the page, not the run sheet, would be printed');
      expect(
        pr.text.includes('Browser batch') && !/B-\d{6}-\d+/.test(pr.text),
        'the run sheet does not name the batch',
      );
      await page.waitForTimeout(1100);
      await page.keyboard.press('Shift');
    });

  if (!CORE)
    await step('equipment is booked for the batch from the Calendar', async () => {
      await nav('Calendar');
      await page.getByRole('button', { name: 'New booking' }).click();
      const dlg = page.getByRole('dialog', { name: 'New booking' });
      await dlg.getByRole('radio', { name: /Spin coater A/ }).click();
      // the open batch is offered first, as "subject:id"
      const sel = dlg.locator('select').first();
      expect(
        (await sel.locator('option:checked').textContent())?.includes('Browser batch'),
        'the batch is not offered',
      );
      const day = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
      await dlg.locator('input[type=date]').fill(day);
      await dlg.locator('input[type=time]').nth(0).fill('14:00');
      await dlg.locator('input[type=time]').nth(1).fill('15:00');
      await dlg.getByRole('button', { name: /^(Book|Save)/ }).click();
      await dlg.waitFor({ state: 'detached' });
      const bk = (await api('GET', `/calendar?from=${day}T00:00:00.000Z&to=${day}T23:59:59.000Z`)).j.bookings;
      expect(
        bk.some((b) => b.subject === 'batch' && b.subject_name === 'Browser batch'),
        'the booking is not for the batch',
      );
    });

  if (!CORE)
    await step('search finds the batch and opens it', async () => {
      await nav('Stacks');
      await page.keyboard.press('Control+k');
      await page.getByPlaceholder('Search, or go to a page…').fill('Browser batch');
      const hit = page.locator('.palette .pitem').filter({ hasText: 'Batch' }).filter({ hasText: 'Browser batch' });
      await hit.first().click();
      await page.getByRole('textbox', { name: 'Batch name' }).waitFor();
      expect(/#\/batches\/\d+$/.test(page.url()), 'the address is not the batch’s: ' + page.url());
    });

  if (!CORE)
    await step('J–V files are imported and their parameters shown', async () => {
      await nav('J–V curves');
      await page.getByRole('button', { name: 'Import measurements' }).first().click();
      await page.locator('input[type=file][multiple]').setInputFiles(
        txtFiles().map((f) => ({
          name: f.name.split('/').pop(),
          mimeType: 'text/plain',
          buffer: Buffer.from(f.text),
        })),
      );
      await page.getByRole('button', { name: /^Save measurement/ }).click();
      await page.getByRole('button', { name: /^Save measurement/ }).waitFor({ state: 'detached' });
      const sets = (await api('GET', '/iv')).j;
      const list = sets.sets ?? sets;
      expect(list.length === 1, 'the measurement is not saved');
      const one = (await api('GET', `/iv/${list[0].id}`)).j;
      expect((one.curves ?? []).length === 4, `expected 4 curves, got ${(one.curves ?? []).length}`);
      await page.getByText(/PCE/).first().waitFor();
    });

  let cmpId = 0;
  if (!CORE)
    await step('a comparison’s slide: box plots wider than tall, no table header over another (0.51.2)', async () => {
      const devs = (await api('GET', '/comparisons/devices')).j;
      expect(devs?.length > 0, 'no device to compare');
      const m = devs[0],
        member = { set: m.set, sample: m.sample, substrate: m.substrate };
      const r = await api('POST', '/comparisons', {
        name: 'Browser comparison',
        data: {
          groups: [
            { id: 'a', name: 'Reference', ref: true, members: [member] },
            { id: 'b', name: 'Without annealing', members: [member] },
            { id: 'c', name: 'With annealing', members: [member] },
          ],
        },
      });
      expect(r.s === 200, 'comparison not saved: ' + JSON.stringify(r.j));
      cmpId = r.j.id;
      await page.goto(`${base}/#/cmp/${r.j.id}`);
      await later();
      const slide = async (as) => {
        await page.getByRole('button', { name: 'Export', exact: true }).first().click();
        const row = page.locator('.ov-exp-row').filter({ hasText: 'Box plots, J–V and table' });
        const [dl] = await Promise.all([
          page.waitForEvent('download'),
          row.getByRole('menuitem', { name: as.toUpperCase() }).click(),
        ]);
        return (await import('node:fs')).readFileSync(await dl.path());
      };
      const svg = (await slide('svg')).toString('utf8');
      if (process.env.SHOTS) writeFileSync(join(root, 'out', 'comparison-slide.png'), await slide('png'));
      // laid out in a page of its own: the table's headers (grey) must not run into each other
      const p2 = await ctx.newPage();
      await p2.setContent(`<!doctype html><body style="margin:0">${svg}</body>`);
      const got = await p2.evaluate(() => {
        const root = document.querySelector('body > svg');
        const heads = [...root.querySelectorAll(':scope > g text')]
          .filter((t) => t.getAttribute('fill') === '#5f6570')
          .map((t) => ({ s: t.textContent, b: t.getBBox() }));
        const clash = [];
        for (let i = 0; i < heads.length; i++)
          for (let j = i + 1; j < heads.length; j++) {
            const a = heads[i].b,
              b = heads[j].b;
            if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height)
              clash.push(`${heads[i].s} / ${heads[j].s}`);
          }
        const box = root.querySelector(':scope > svg');
        return { clash, n: heads.length, w: +box.getAttribute('width'), h: +box.getAttribute('height') };
      });
      await p2.close();
      expect(got.n >= 4, `table headers not found (${got.n})`);
      expect(!got.clash.length, 'table headers overlap: ' + got.clash.join(', '));
      // six panels in three columns and two rows: the box plots' area at least 1.5 times as wide as tall
      expect(got.w / got.h >= 1.5, `the box plots are squashed: ${Math.round(got.w)} × ${Math.round(got.h)}`);
    });

  if (!CORE)
    await step(
      'a comparison’s tables: median or mean with ± SD, on the slide too; the table with groups as columns (0.52.1)',
      async () => {
        const { readFileSync } = await import('node:fs');
        const { unzipSync, strFromU8 } = await import('fflate');
        await page.goto(`${base}/#/cmp/${cmpId}`);
        await later();
        const card = page.locator('.cx-table');
        await card.getByText('Median ± SD of the counted pixels').waitFor();
        const exp = async (rowText, fmt) => {
          await page.getByRole('button', { name: 'Export', exact: true }).first().click();
          const row = page.locator('.ov-exp-row').filter({ hasText: rowText });
          const [dl] = await Promise.all([
            page.waitForEvent('download'),
            row.getByRole('menuitem', { name: fmt }).click(),
          ]);
          return readFileSync(await dl.path());
        };
        // the slide: ± SD after the values, and which statistic it is
        const slideSvg = (await exp('Box plots, J–V and table', 'SVG')).toString('utf8');
        expect(slideSvg.includes('± '), 'no ± SD on the slide');
        expect(slideSvg.includes('median ± SD'), 'the slide does not say which statistic');
        // the table turned on its side: a column per group (the reference first), a row per parameter
        const tSvg = (await exp('Groups as columns', 'SVG')).toString('utf8');
        const p2 = await ctx.newPage();
        await p2.setContent(`<!doctype html><body style="margin:0">${tSvg}</body>`);
        const got = await p2.evaluate(() => {
          const root = document.querySelector('body > svg');
          const texts = [...root.querySelectorAll(':scope > g > text, :scope > text')].map((t) => ({
            s: t.textContent,
            b: t.getBBox(),
          }));
          const clash = [];
          for (let i = 0; i < texts.length; i++)
            for (let j = i + 1; j < texts.length; j++) {
              const a = texts[i].b,
                b = texts[j].b;
              if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height)
                clash.push(`${texts[i].s} / ${texts[j].s}`);
            }
          const W = +root.getAttribute('width');
          const out = texts.filter((t) => t.b.x < 0 || t.b.x + t.b.width > W).map((t) => t.s);
          return { all: texts.map((t) => t.s), clash, out };
        });
        await p2.close();
        for (const s of ['Devices', 'Pixels', 'PCE', 'Voc', 'Rsh', 'PCE relative', 'to the reference'])
          expect(
            got.all.some((t) => t.startsWith(s)),
            `row ${s} missing in the table`,
          );
        const heads = got.all.filter((t) => /Reference|annealing/.test(t));
        expect(heads[0] === 'Reference (ref.)', 'the reference is not the first column: ' + heads.join(', '));
        expect(
          got.all.some((t) => t.includes('± ')),
          'no ± SD in the table',
        );
        expect(!got.clash.length, 'texts overlap in the table: ' + got.clash.join(', '));
        expect(!got.out.length, 'texts run out of the table: ' + got.out.join(', '));
        if (process.env.SHOTS)
          writeFileSync(join(root, 'out', 'comparison-table.png'), await exp('Groups as columns', 'PNG'));
        // the same table in Excel
        const x = unzipSync(new Uint8Array(await exp('Groups as columns', 'Excel')));
        const sheet = Object.entries(x)
          .filter(([n]) => n.startsWith('xl/'))
          .map(([, b]) => strFromU8(b))
          .join('');
        for (const s of ['Reference (ref.)', 'Without annealing', 'Devices', 'PCE relative to the reference', '± '])
          expect(sheet.includes(s), `${s} missing in the Excel table`);
        // Mean: the tables follow, and the choice is saved with the comparison
        await card.getByRole('tab', { name: 'Mean' }).click();
        await card.getByText('Mean ± SD of the counted pixels').waitFor();
        expect(
          (await exp('Box plots, J–V and table', 'SVG')).toString('utf8').includes('mean ± SD'),
          'the slide still says median',
        );
        expect(
          (await exp('Groups as columns', 'SVG')).toString('utf8').includes('Mean ± SD'),
          'the table still says median',
        );
        for (let i = 0; i < 20 && (await api('GET', '/comparisons/' + cmpId)).j?.data?.stat !== 'mean'; i++)
          await new Promise((r) => setTimeout(r, 150));
        expect(
          (await api('GET', '/comparisons/' + cmpId)).j?.data?.stat === 'mean',
          'Mean is not saved with the comparison',
        );
        if (process.env.SHOTS)
          await page.screenshot({ path: join(root, 'out', 'comparison-mean.png'), fullPage: true });
        // with values that fit their columns, the SD follows each value on the same line
        await page.locator('.cx-card').getByRole('button', { name: 'Rsh', exact: true }).click();
        const one = (await exp('Box plots, J–V and table', 'SVG')).toString('utf8');
        expect(/<tspan[^>]*>± /.test(one), 'the SD is not on the line of its value');
        if (process.env.SHOTS) {
          writeFileSync(
            join(root, 'out', 'comparison-slide-one-line.png'),
            await exp('Box plots, J–V and table', 'PNG'),
          );
          await page.emulateMedia({ colorScheme: 'dark' });
          await card.screenshot({ path: join(root, 'out', 'comparison-table-dark.png') });
          await page.emulateMedia({ colorScheme: 'light' });
          await page.setViewportSize({ width: 390, height: 844 });
          await card.scrollIntoViewIfNeeded();
          await card.screenshot({ path: join(root, 'out', 'comparison-table-390.png') });
          await page.setViewportSize({ width: 1400, height: 900 });
        }
        await page.locator('.cx-card').getByRole('button', { name: 'Rsh', exact: true }).click();
        await card.getByRole('tab', { name: 'Median' }).click();
      },
    );

  await step(
    CORE
      ? 'the Overview tells the period from the equipment time'
      : 'the Overview tells the period with the module’s part and the equipment time',
    async () => {
      await page.locator('nav.side').getByRole('button', { name: 'Overview', exact: true }).click();
      // the booking is two days ahead: late in the week that is next week's Overview (Mondays start a week)
      const later = await page.evaluate((d) => {
        const monday = (t) => {
          const x = new Date(t);
          x.setHours(0, 0, 0, 0);
          x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
          return x.getTime();
        };
        return monday(d + 'T12:00:00') > monday(Date.now());
      }, bookDay);
      if (CORE && later) await page.locator('.ov').getByRole('button', { name: 'Next' }).click();
      if (CORE)
        await page
          .locator('.ov-lede')
          .getByText(/of equipment time booked/)
          .waitFor();
      else {
        await page
          .locator('.ov-lede')
          .getByText(/started 1 batch/)
          .waitFor();
        await page.locator('.ov-stat').filter({ hasText: 'Best cell' }).waitFor();
      }
      await page.locator('.ov').getByRole('tab', { name: 'Equipment', exact: true }).click();
      await page.locator('.eq-use-row').filter({ hasText: 'Spin coater A' }).waitFor();
    },
  );

  if (!CORE)
    await step('the trash names what each item is, and restores it', async () => {
      expect((await api('DELETE', '/presets/' + stackId)).s === 200, 'the stack was not deleted');
      await page.locator('nav.side').getByRole('button', { name: /Trash/ }).click();
      const row = page.locator('tr').filter({ hasText: 'Browser stack' });
      await row.getByText('Stack', { exact: true }).waitFor();
      await row.getByRole('button', { name: 'Restore' }).click();
      await row.waitFor({ state: 'detached' });
      expect((await api('GET', '/presets/' + stackId)).s === 200, 'the stack is not back');
    });

  await step('a container makes its substance; an export is reviewed before it is imported', async () => {
    await nav('Inventory');
    await page.getByRole('tab', { name: 'Containers', exact: true }).click();
    await page.getByRole('button', { name: 'Add container' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add container' });
    await dlg.getByRole('combobox', { name: 'Substance' }).fill('Browser salt');
    await dlg.getByText('A new substance', { exact: false }).waitFor();
    await dlg.getByLabel('Supplier').fill('Acme');
    await dlg.getByLabel('CAS number').fill('7681-82-5');
    await dlg.getByRole('button', { name: 'Add container' }).click();
    await dlg.waitFor({ state: 'detached' });
    await page.getByRole('tab', { name: 'Substances', exact: true }).click();
    await page.locator('tr').filter({ hasText: 'Browser salt' }).filter({ hasText: '7681-82-5' }).waitFor();
    // a made-up export in OpenEnventory's layout: a title line, "left / size" amounts, places as "compartment X"
    const csv = [
      'name,empirical formula,CAS number,purity/concentration,MW,amount,Lot no.,storage,supplier,comment on chemical',
      'Results from own database',
      '"Browser salt; sodium iodide (German: Natriumiodid)",INa,7681-82-5,99.5 %,149.89,"20 g / 50 g",BX-1,compartment Shelf 9,Beta,',
      '"Browser solvent",C2H6O,64-17-5,,,"0.5 l / 1 l",BX-2,compartment Shelf 9,Gamma,controlled by the Federal Police',
    ].join('\n');
    await page.getByRole('tab', { name: 'Containers', exact: true }).click();
    await page.getByRole('button', { name: 'Import CSV' }).click();
    await page
      .locator('section.import input[type=file]')
      .setInputFiles({ name: 'export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByText(/2 containers of 2 substances; 1 line/).waitFor();
    await page
      .locator('.import-subs tr')
      .filter({ hasText: '7681-82-5' })
      .getByText(/Yes, as Browser salt/)
      .waitFor();
    await page.getByLabel('Storage place for Shelf 9').fill('Browser cabinet');
    await page
      .locator('section.import')
      .getByRole('button', { name: /^Import/ })
      .click();
    await page.locator('section.import').waitFor({ state: 'detached' });
    const subs = (await api('GET', '/chemicals')).j;
    const salt = subs.find((x) => x.name === 'Browser salt'),
      solv = subs.find((x) => x.name === 'Browser solvent');
    expect(salt?.bottles.length === 2 && salt.M === 149.89, 'the imported container did not join its substance');
    expect(
      solv?.pf && solv.bottle?.place === 'Browser cabinet',
      'the new substance, its control or its place is wrong',
    );
  });

  await step(
    CORE ? 'consumption has nothing to add up without a module' : 'consumption says where its amounts come from',
    async () => {
      await nav('Inventory');
      await page.getByRole('tab', { name: 'Consumption', exact: true }).click();
      if (CORE) await page.getByText('No reagent use in the last 26 weeks.').waitFor();
      else await page.getByText(/From the recipes of 0 running and done batches/).waitFor();
    },
  );

  // the builder's page (0.50) is not part of the package: it runs from the repository, on PANOPTICA's own computer
  if (!CORE)
    await step('the builder’s page makes a licence, keeps it in the list and gives it again', async () => {
      const bport = await freePort(),
        pub = join(tmp, 'builder-pub.pem'),
        list = join(tmp, 'issued');
      writeFileSync(pub, testKey.publicKey.export({ type: 'spki', format: 'pem' }));
      const ui = spawn(
        process.execPath,
        [join(root, 'tools/builder/ui.mjs'), '--port', String(bport), '--no-open', '--pub', pub],
        { env: { ...process.env, PANOPTICA_BUILDER_SETTINGS: join(tmp, 'builder.json') }, stdio: 'ignore' },
      );
      try {
        const bp = await ctx.newPage();
        bp.setDefaultTimeout(10_000);
        bp.on('pageerror', (e) => errors.push(e.message));
        for (let i = 0; ; i++) {
          try {
            await bp.goto(`http://127.0.0.1:${bport}/`);
            break;
          } catch {
            if (i > 120) throw new Error('the builder’s page did not start');
            await new Promise((r) => setTimeout(r, 250));
          }
        }
        await bp.getByRole('heading', { name: 'Where to keep the list of licences' }).waitFor();
        await bp.getByLabel('Folder').fill(list);
        await bp.getByRole('button', { name: 'Use this folder' }).click();
        await bp.getByText('No licences yet').waitFor();
        await bp.getByRole('button', { name: 'New lab' }).first().click();
        const dlg = bp.getByRole('dialog', { name: 'New lab' });
        await dlg.getByLabel('Full name').fill('Browser Builder Laboratory');
        await dlg.getByLabel('Acronym (optional)').fill('BBL');
        await dlg.getByRole('button', { name: 'Make licence' }).click();
        await dlg.getByText('Choose the signing key file.').waitFor();
        await dlg.locator('input[type=file]').setInputFiles({
          name: 'signing.pem',
          mimeType: 'application/x-pem-file',
          buffer: Buffer.from(testKey.privateKey.export({ type: 'pkcs8', format: 'pem' })),
        });
        await dlg.getByRole('button', { name: 'Make licence' }).click();
        const made = bp.getByRole('dialog', { name: 'Licence made' });
        expect(
          /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/.test(await made.locator('.b-code code').innerText()),
          'no setup code is shown for the new lab',
        );
        const [dl] = await Promise.all([
          bp.waitForEvent('download'),
          made.getByRole('link', { name: 'Download licence' }).click(),
        ]);
        expect(dl.suggestedFilename() === 'licence.json', 'the licence does not download as licence.json');
        await made.getByRole('button', { name: 'Done' }).click();
        const row = bp.locator('.b-list tbody').filter({ hasText: 'Browser Builder Laboratory' });
        await row.getByText('Up to 10 people').waitFor();
        // an upgrade: a new licence for the same lab, the earlier one still there to download
        await row.getByRole('button', { name: 'New licence' }).click();
        const up = bp.getByRole('dialog', { name: 'New licence for BBL' });
        await up.getByRole('tab', { name: 'Up to 50' }).click();
        await up.locator('input[type=file]').setInputFiles({
          name: 'signing.pem',
          mimeType: 'application/x-pem-file',
          buffer: Buffer.from(testKey.privateKey.export({ type: 'pkcs8', format: 'pem' })),
        });
        await up.getByRole('button', { name: 'Make licence' }).click();
        await bp.getByRole('dialog', { name: 'Licence made' }).getByText('No setup code').waitFor();
        await bp.getByRole('dialog', { name: 'Licence made' }).getByRole('button', { name: 'Done' }).click();
        await row.getByText('Up to 50 people').waitFor();
        await row.getByRole('button', { name: 'Show 1 earlier' }).click();
        await row.locator('tr.b-earlier').getByRole('link', { name: 'Download licence' }).waitFor();
        expect((await bp.locator('.b-list tbody').count()) === 1, 'the upgrade made a second lab');
        // on a phone the list fits the screen
        await bp.setViewportSize({ width: 390, height: 844 });
        expect(
          await bp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          'the list is wider than a phone',
        );
        await bp.close();
      } finally {
        ui.kill();
      }
    });

  console.log(`All ${passed} browser flows passed`);
  await browser.close();
  srv.kill();
  gh.close();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
} catch (e) {
  console.log('FAILED');
  console.error(e.message);
  mkdirSync(join(root, 'out'), { recursive: true });
  await page.screenshot({ path: join(root, 'out/browser-failure.png'), fullPage: true }).catch(() => {});
  if (errors.length) console.error('page errors:', errors.join('\n'));
  // what is on top (a window in the way is the usual cause), and where the app is
  const over = await page
    .locator('.scrim')
    .allInnerTexts()
    .catch(() => []);
  if (over.length) console.error('open windows:', over.map((t) => t.slice(0, 200).replace(/\s+/g, ' ')).join(' | '));
  console.error('address:', page.url());
  console.error('----- server log (last lines)\n' + log.split('\n').slice(-30).join('\n'));
  await browser.close();
  srv.kill();
  gh.close();
  process.exit(1);
}
