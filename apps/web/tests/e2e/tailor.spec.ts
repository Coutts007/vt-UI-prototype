// The tailor's day, on the mock and on the real API (M9). Sign-in, codes, profiles, conflicts,
// orders, claims. Strings come from the app's own text so the tests follow it.
import AxeBuilder from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../../src/i18n/en';
import { tailorEn as tx } from '../../src/views/tailor/tailorText';
import { shot } from './shots';

const seed = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../packages/seed/seed.json'), 'utf8'),
);
const clientOf = (code: string) =>
  seed.clients.find((c: { client_code: string }) => c.client_code === code);

test.use({ viewport: { width: 360, height: 780 } });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(tx.emailLabel).fill('wanjiru@vt.test');
  await page.locator('input[type=password]').fill('vt-demo-2026');
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/t\//);
}

// Inside the app, because the mock's data lives in the page and a full load starts it afresh.
async function go(page: Page, path: string) {
  await page.evaluate((to) => {
    history.pushState(null, '', to);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

async function clean(page: Page) {
  const found = await new AxeBuilder({ page }).analyze();
  expect(found.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
}

// What a phone would send, from the seed's own profile. In the page, so it reaches the mock too.
async function uploadAs(page: Page, code: string, secret: string, version = 1) {
  const template = seed.profiles.find(
    (p: { client_id: string }) => p.client_id === clientOf('AB1004').client_id,
  );
  return page.evaluate(
    async ({ template, code, secret, version }) => {
      const { client_id: _c, received_at: _r, server_checks: _s, ...rest } = template;
      const id = crypto.randomUUID();
      const body = {
        ...rest,
        client_code: code,
        version,
        profile_id: id,
        session: { ...rest.session, session_id: crypto.randomUUID() },
      };
      const reply = await fetch('/api/v1/profiles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': id,
          'X-Client-Secret': secret,
          'X-App-Version': rest.session.app_version,
        },
        body: JSON.stringify(body),
      });
      return reply.status;
    },
    { template, code, secret, version },
  );
}

const SECRET_A = 'ab'.repeat(32);
const SECRET_B = 'cd'.repeat(32);

test('a wrong password says so, and the seed accounts are one tap in development', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel(tx.emailLabel).fill('wanjiru@vt.test');
  await page.locator('input[type=password]').fill('not-the-password');
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('alert')).toHaveText(tx.loginWrong);
  await clean(page);
});

test('issue a code and find the client', async ({ page }) => {
  await signIn(page);
  await go(page, '/t/clients');
  await expect(page.getByRole('button', { name: tx.newCode })).toBeVisible();
  await clean(page);
  await page.getByRole('button', { name: tx.newCode }).click();
  await page.getByRole('button', { name: tx.codeSubmit }).click();
  await expect(page.getByText(tx.codeReady)).toBeVisible();
  await clean(page);
  await shot(page, '02-code-issued');
  const code = await page.getByTestId('issued-code').innerText();
  expect(code).toMatch(/^[A-Z]{2}\d{4}$/);
  await go(page, '/t/clients');
  await page.getByLabel(tx.searchClients).fill(code);
  await expect(page.getByRole('button', { name: new RegExp(code) })).toBeVisible();
});

test('a client page leads to a profile', async ({ page }) => {
  await signIn(page);
  await go(page, `/t/clients/${clientOf('AB1001').client_id}`);
  await page.getByRole('button', { name: /^v\d/ }).first().click();
  await expect(page).toHaveURL(/\/profile/);
  await expect(page.getByText(en.site_chest).first()).toBeVisible();
  await clean(page);
  await shot(page, '04a-profile');
});

test('resolve a conflict', async ({ page }) => {
  await signIn(page);
  await go(page, '/t/conflicts');
  await expect(page.getByRole('heading', { name: tx.conflictsTitle })).toBeVisible();
  const newer = page.getByRole('button', { name: tx.useNewer });
  await expect(newer.first()).toBeVisible();
  await clean(page);
  await shot(page, '06-conflict');
  const before = await newer.count();
  await newer.first().click();
  await expect(newer).toHaveCount(before - 1);
});

test('an order with a flagged row needs an answer, then moves through its statuses', async ({
  page,
}) => {
  await signIn(page);
  await go(page, '/t/orders/new');
  await page.locator('#order-client').selectOption(clientOf('AB1001').client_id);
  await page.locator('#order-garment').selectOption('shirt');
  await expect(page.getByTestId('item-chest')).toBeVisible();
  await clean(page);
  // Answer whatever is flagged on this profile, using the buttons the rows offer.
  const save = page.getByRole('button', { name: tx.saveOrder });
  for (const box of await page.getByRole('checkbox').all()) {
    if (!(await save.isEnabled())) await box.check();
  }
  for (const button of await page.getByRole('button', { name: tx.measureAtFitting }).all()) {
    if (!(await save.isEnabled())) await button.click();
  }
  await expect(save).toBeEnabled();
  await shot(page, '04b-order-flagged-rows-answered');
  await save.click();
  await expect(page).toHaveURL(/\/t\/orders\/[0-9a-f-]{36}/);
  await expect(page.getByRole('button', { name: tx.status_cutting })).toBeVisible();
  await clean(page);
  await page.getByRole('button', { name: tx.status_cutting }).click();
  await expect(page.getByRole('button', { name: tx.status_cutting })).toHaveAttribute(
    'aria-current',
    'step',
  );
});

test('freeing a code: the next phone reaches only its own, and the old row waits for the tailor', async ({
  page,
}) => {
  await signIn(page);
  await go(page, '/t/clients/new');
  await page.getByRole('button', { name: tx.codeSubmit }).click();
  const code = await page.getByTestId('issued-code').innerText();
  expect(await uploadAs(page, code, SECRET_A)).toBe(201);

  await go(page, '/t/clients');
  await page.getByLabel(tx.searchClients).fill(code);
  await page.getByRole('button', { name: new RegExp(code) }).click();
  await expect(page.getByTestId('claim-state')).toHaveText(tx.claimHeld);
  await clean(page);

  await page.getByRole('button', { name: tx.claimFreeButton }).click();
  await page.getByRole('dialog').getByRole('button', { name: tx.claimFreeConfirm }).click();
  await expect(page.getByTestId('claim-state')).toHaveText(tx.claimFree);

  await page.getByLabel(tx.claimSupersede).check();
  await page.getByRole('button', { name: tx.claimApply }).click();
  // The claim panel and, once it reloads, the profile list both say so.
  await expect(page.getByText(tx.statusSuperseded, { exact: false }).first()).toBeVisible();

  expect(await uploadAs(page, code, SECRET_B, 2)).toBe(201);
  await go(page, '/t/clients');
  await page.getByRole('button', { name: new RegExp(code) }).click();
  await expect(page.getByTestId('claim-state')).toHaveText(tx.claimHeld);
  const reach = await page.evaluate(
    async ({ code, secret }) => {
      const reply = await fetch('/api/v1/data-requests/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Secret': secret },
        body: JSON.stringify({ client_code: code }),
      });
      return (await reply.json()).profiles.map((p: { version: number }) => p.version);
    },
    { code, secret: SECRET_B },
  );
  expect(reach).toEqual([2]);
});

test('a deletion nobody can prove reaches the tailor, who decides', async ({ page }) => {
  await signIn(page);
  await go(page, `/t/clients/${clientOf('AB1003').client_id}`);
  await expect(page.getByText(tx.deletionBanner)).toHaveCount(0);
  const status = await page.evaluate(async (code) => {
    const reply = await fetch('/api/v1/deletion-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_code: code, reason: 'delete' }),
    });
    return (await reply.json()).status;
  }, 'AB1003');
  expect(status).toBe('received');
  await go(page, '/t/clients');
  await go(page, `/t/clients/${clientOf('AB1003').client_id}`);
  await expect(page.getByText(tx.deletionBanner)).toBeVisible();
  await clean(page);
  await page.getByLabel(tx.claimClose).check();
  await page.getByRole('button', { name: tx.claimApply }).click();
  await expect(page.getByText(tx.deletionBanner)).toHaveCount(0);
});

test('sunlight mode at 360 px passes contrast, on every main screen', async ({ page }) => {
  await signIn(page);
  await go(page, '/t/settings');
  await page.getByLabel(tx.sunlightMode).check();
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  await clean(page);
  for (const [path, heading] of [
    ['/t/clients', tx.clientsTitle],
    ['/t/conflicts', tx.conflictsTitle],
    ['/t/audit', tx.auditTitle],
    ['/t/orders/new', tx.newOrder],
  ] as const) {
    await go(page, path);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await clean(page);
  }
});

// M10: the sheet, both share paths, the PDF and the 10-minute links (frontend-spec 13.9, F6).
const SHEET_ORDER = seed.orders.find(
  (o: { order_no: string; client_code: string }) =>
    o.order_no === 'ORD-0001' && o.client_code === 'AB1001',
);
const REAL_API = Boolean(process.env.VT_E2E_REAL_API);

async function openSheet(page: Page, withName: boolean) {
  await signIn(page);
  await go(page, `/t/orders/${SHEET_ORDER.order_id}/sheet`);
  const box = page.getByRole('checkbox', { name: tx.sheetIncludeName });
  if (withName) await box.check();
  else await box.uncheck();
  await page.getByRole('button', { name: tx.sheetGenerate }).click();
  const preview = page.getByRole('img', { name: tx.sheetPreviewAlt });
  await expect(preview).toBeVisible();
  // The real API renders A4 at 150 dpi; the mock serves a one-pixel stand-in.
  await expect
    .poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(REAL_API ? 1240 : 1);
  return preview;
}

test('a sheet is generated, previewed and shared through the share sheet', async ({ page }) => {
  await page.addInitScript(() => {
    const shared: { files: number; type: string; text: string }[] = [];
    (window as unknown as { __shared: typeof shared }).__shared = shared;
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: { files: File[]; text: string }) => {
        shared.push({ files: data.files.length, type: data.files[0].type, text: data.text });
      },
    });
  });
  await openSheet(page, true);
  const text = page.getByTestId('share-text');
  await page.getByText(tx.sheetShareText).click();
  await expect(text).toContainText(`Client AB1001 · ${clientOf('AB1001').display_name} ·`);
  await expect(text).toContainText('No photo is stored.');
  await clean(page);
  await shot(page, '04c-sheet');
  await page.getByRole('button', { name: tx.sheetShareWhatsApp }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared))
    .toEqual([
      {
        files: 1,
        type: 'image/png',
        text: (await text.textContent()) ?? '',
      },
    ]);
});

test('without file sharing the picture downloads and WhatsApp opens with the text', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
  await page
    .context()
    .route('https://wa.me/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: 'whatsapp' }),
    );
  await openSheet(page, false);
  const download = page.waitForEvent('download');
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: tx.sheetShareWhatsApp }).click();
  expect((await download).suggestedFilename()).toMatch(/^sheet-[0-9a-f]{8}\.png$/);
  const tab = await popup;
  await tab.waitForURL(/^https:\/\/wa\.me\//);
  const opened = decodeURIComponent(new URL(tab.url()).searchParams.get('text') ?? '');
  expect(opened).toMatch(/^Virtual Tailor · Client AB1001 · Profile v\d+ /);
  expect(opened).not.toContain(clientOf('AB1001').display_name);
  await expect(page.getByText(tx.sheetAttachHint)).toBeVisible();
  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: tx.sheetDownloadPdf }).click();
  expect((await pdf).suggestedFilename()).toMatch(/\.pdf$/);
});

test('an expired link is replaced by a new sheet without the tailor noticing', async ({ page }) => {
  test.skip(!REAL_API, 'the mock answers inside its service worker, out of reach of page.route');
  await openSheet(page, false);
  let refused = 0;
  await page.route('**/api/v1/files/sheets/*.pdf*', async (route) => {
    if (refused++ === 0) {
      await route.fulfill({
        status: 403,
        contentType: 'application/problem+json',
        body: JSON.stringify({ code: 'sheet_link_invalid' }),
      });
    } else await route.continue();
  });
  const made = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/sheets'));
  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: tx.sheetDownloadPdf }).click();
  await made;
  expect((await pdf).suggestedFilename()).toMatch(/\.pdf$/);
  expect(refused).toBe(2);
});

test('changing the name choice drops the sheet already made, so the old name cannot be sent', async ({
  page,
}) => {
  await openSheet(page, true);
  const preview = page.getByRole('img', { name: tx.sheetPreviewAlt });
  await page.getByRole('checkbox', { name: tx.sheetIncludeName }).uncheck();
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('button', { name: tx.sheetShareWhatsApp })).toHaveCount(0);
  await page.getByRole('button', { name: tx.sheetGenerate }).click();
  await expect(preview).toBeVisible();
  await page.getByText(tx.sheetShareText).click();
  await expect(page.getByTestId('share-text')).not.toContainText(clientOf('AB1001').display_name);
});
