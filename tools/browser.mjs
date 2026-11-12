// Browser tests: the main flows clicked through in a real browser (Chromium), on a new install.
//   node --import tsx tools/browser.mjs            the server from source (apps/server/src) with the built web app (apps/web/dist)
//   node --import tsx tools/browser.mjs --built    the packaged server (out/panoptica, from tools/package.mjs)
// Flows: first setup, sign out and in, the side menu, equipment, a booking, a stack's run sheet, starting a batch and its run
// sheet, booking for the batch, search, a J–V import, the Overview, the trash, consumption. On a failure it saves a screenshot and the page's errors in out/browser-failure.png and prints the server log.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { txtFiles } from '../packages/core/src/ivfixtures.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const BUILT = process.argv.includes('--built');
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

const srv = spawn(
  process.execPath,
  BUILT ? ['--no-warnings', 'dist/server.mjs'] : ['--import', 'tsx', 'src/index.ts'],
  {
    cwd: join(root, BUILT ? 'out/panoptica/apps/server' : 'apps/server'),
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DB_PATH: join(tmp, 'data.db'),
      BACKUP_DIR: join(tmp, 'backups'),
      CONFIG_DIR: join(tmp, 'config'),
      UPDATES_DIR: join(tmp, 'updates'),
      ADMIN_PASSWORD: '', // a new install: the first setup makes the admin
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
  await button.click();
  await page.waitForFunction(() => window.__printed !== null);
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

console.log(`Browser tests (${BUILT ? 'packaged server' : 'server from source'})`);
try {
  let username = '';
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
    await page.locator('.setup-page input').first().fill('Test Lab');
    await page.locator('.setup-page input').nth(1).fill('Example University');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('.setup-foot .btn').click(); // finish
    await page.locator('.top .brand').getByText('Test Lab').waitFor();
    await later();
    username = (await api('GET', '/me')).j.username;
    expect(!!username, 'no account after the setup');
  });

  await step('sign out and sign in again', async () => {
    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await page.getByRole('heading', { name: 'Sign in' }).waitFor();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(PW);
    await page.keyboard.press('Enter');
    await page.locator('.top .brand').getByText('Test Lab').waitFor();
    await later();
  });

  await step('the side menu has the core’s pages and Electronic Devices’ groups', async () => {
    const groups = await page.locator('nav.side .glabel').allTextContents();
    expect(
      groups.join(',') === 'Fabrication,Measurements,Recipes,Designs,Lab',
      'side menu groups: ' + groups.join(', '),
    );
    const fab = await page
      .locator('nav.side > div')
      .filter({ has: page.locator('.glabel', { hasText: 'Fabrication' }) })
      .locator('.navitem')
      .allTextContents();
    expect(fab.join(',') === 'Stacks,Batches,Calendar', 'Fabrication: ' + fab.join(', '));
  });

  await step('equipment is added under Lab › Equipment', async () => {
    await nav('Equipment');
    await page.getByRole('button', { name: 'New equipment' }).click();
    const dlg = page.locator('.modal, .dialog').filter({ hasText: 'New equipment' }).last();
    await dlg.getByLabel('Name').fill('Spin coater A');
    await dlg.getByRole('button', { name: 'Spin coating' }).click();
    await dlg.getByRole('button', { name: 'Add equipment' }).click();
    // the new equipment opens in its sheet
    const sheet = page.locator('.modal-scrim').filter({ hasText: 'What it can do' });
    await sheet.waitFor();
    expect(
      await sheet.evaluate((el) => [...el.querySelectorAll('input')].some((x) => x.value === 'Spin coater A')),
      'the sheet is not the new equipment’s',
    );
    await page.keyboard.press('Escape');
    await page.locator('.modal-scrim').waitFor({ state: 'detached' });
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

  await step('starting a batch asks only for its name and opens it', async () => {
    await page.getByRole('button', { name: 'Start batch' }).click();
    await page.getByLabel('Batch name').fill('Browser batch');
    await page.locator('.start-batch').getByRole('button', { name: 'Start batch' }).click();
    await page
      .getByText(/^B-\d{6}-\d+$/)
      .first()
      .waitFor(); // the batch page, under the code the app gave it
    const b = (await api('GET', '/batches')).j;
    const mine = (b.batches ?? b).find((x) => x.name === 'Browser batch');
    expect(mine && /^B-\d{6}-\d+$/.test(mine.code), 'the batch was not numbered by the app');
  });

  await step('the batch prints its run sheet, not the page', async () => {
    const pr = await printOf(page.getByRole('button', { name: 'Print run sheet' }));
    expect(pr.mode && pr.after, 'the page, not the run sheet, would be printed');
    expect(/Batch B-\d{6}-\d+/.test(pr.text), 'the run sheet does not name the batch');
    await page.waitForTimeout(1100);
    await page.keyboard.press('Shift');
  });

  await step('equipment is booked for the batch from the Calendar', async () => {
    await nav('Calendar');
    await page.getByRole('button', { name: 'New booking' }).click();
    const dlg = page.getByRole('dialog', { name: 'New booking' });
    await dlg.getByRole('radio', { name: /Spin coater A/ }).click();
    // the open batch is offered first, as "subject:id"
    const sel = dlg.locator('select').first();
    expect((await sel.locator('option:checked').textContent())?.includes('Browser batch'), 'the batch is not offered');
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

  await step('search finds the batch and opens it', async () => {
    await nav('Stacks');
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder('Search, or go to a page…').fill('Browser batch');
    const hit = page.locator('.palette .pitem').filter({ hasText: 'Batch' }).filter({ hasText: 'Browser batch' });
    await hit.first().click();
    await page
      .getByText(/^B-\d{6}-\d+$/)
      .first()
      .waitFor();
    expect(/#\/batches\/\d+$/.test(page.url()), 'the address is not the batch’s: ' + page.url());
  });

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

  await step('the Overview tells the period with the module’s part and the equipment time', async () => {
    await page.locator('nav.side').getByRole('button', { name: 'Overview', exact: true }).click();
    await page
      .locator('.ov-lede')
      .getByText(/started 1 batch/)
      .waitFor();
    await page.locator('.ov-stat').filter({ hasText: 'Best cell' }).waitFor();
    await page.locator('.ov').getByRole('tab', { name: 'Equipment', exact: true }).click();
    await page.locator('.eq-use-row').filter({ hasText: 'Spin coater A' }).waitFor();
  });

  await step('the trash names what each item is, and restores it', async () => {
    expect((await api('DELETE', '/presets/' + stackId)).s === 200, 'the stack was not deleted');
    await page.locator('nav.side').getByRole('button', { name: /Trash/ }).click();
    const row = page.locator('tr').filter({ hasText: 'Browser stack' });
    await row.getByText('Stack', { exact: true }).waitFor();
    await row.getByRole('button', { name: 'Restore' }).click();
    await row.waitFor({ state: 'detached' });
    expect((await api('GET', '/presets/' + stackId)).s === 200, 'the stack is not back');
  });

  await step('consumption says where its amounts come from', async () => {
    await nav('Inventory');
    await page.getByRole('tab', { name: 'Consumption', exact: true }).click();
    await page.getByText(/From the recipes of 0 running and done batches/).waitFor();
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
  console.error('----- server log (last lines)\n' + log.split('\n').slice(-30).join('\n'));
  await browser.close();
  srv.kill();
  process.exit(1);
}
