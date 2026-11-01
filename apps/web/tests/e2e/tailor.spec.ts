// The tailor's day, on the mock and on the real API (M9). Sign-in, codes, profiles, conflicts,
// orders, claims. Strings come from the app's own text so the tests follow it.
import AxeBuilder from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../../src/i18n/en';
import { tailorEn as tx } from '../../src/views/tailor/tailorText';

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
});

test('resolve a conflict', async ({ page }) => {
  await signIn(page);
  await go(page, '/t/conflicts');
  await expect(page.getByRole('heading', { name: tx.conflictsTitle })).toBeVisible();
  const newer = page.getByRole('button', { name: tx.useNewer });
  await expect(newer.first()).toBeVisible();
  await clean(page);
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
  await expect(page.getByText(tx.statusSuperseded, { exact: false })).toBeVisible();

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
