// Browser tests: the main flows clicked through in a real browser (Chromium), on a new install.
//   node --import tsx tools/browser.mjs            the server from source (apps/server/src) with the built web app (apps/web/dist)
//   node --import tsx tools/browser.mjs --built    the packaged server (out/panoptica, from tools/package.mjs)
// Flows: first setup (installed as PANOPTICA Setup does, with a licence), the licence in Admin settings, sign out and in, the side menu, equipment, a booking, a stack's run sheet, starting a batch and its run
// sheet, booking for the batch, search, a J–V import, the Overview, the trash, consumption, the builder's page. On a failure it saves a screenshot and the page's errors in out/browser-failure.png and prints the server log.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
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
writeFileSync(join(tmp, 'config/install.json'), JSON.stringify({ by: 'setup' }));
writeFileSync(
  join(tmp, 'config/licence.json'),
  JSON.stringify({
    body: licenceBody,
    sig: sign(null, Buffer.from(licenceBody), testKey.privateKey).toString('base64'),
  }),
);

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
    await page.locator('.top .brand').getByText('Test Lab').waitFor();
    await later();
    username = (await api('GET', '/me')).j.username;
    expect(!!username, 'no account after the setup');
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
  process.exit(1);
}
