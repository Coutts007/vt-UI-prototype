// The tailor directory and Get code (D27), on the mock.
import AxeBuilder from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../../src/i18n/en';
import { sw } from '../../src/i18n/sw';
const seed = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../packages/seed/seed.json'), 'utf8'),
);

const CODE = /^[A-Z]{2}[0-9]{4}$/;
const WANJIRU = 'Mama Wanjiru Tailors';
const OTIENO = 'Otieno Bespoke';
const wanjiruUser = seed.users.find((u: { email: string }) => u.email === 'wanjiru@vt.test');
const wanjiruListing = seed.directory_listings.find(
  (l: { tailor_id: string }) => l.tailor_id === wanjiruUser.user_id,
);

const getCode = (page: Page, name: string, words = en.directoryGetCode) =>
  page.getByRole('button', { name: `${words}: ${name}` });

async function axe(page: Page, scope = 'html') {
  const found = await new AxeBuilder({ page }).include(scope).analyze();
  expect(found.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
}

async function smallTargets(page: Page) {
  return page
    .locator('#content button, #content a, #content select, #content input[type=search]')
    .evaluateAll((all) =>
      all
        .filter((el) => {
          const height = el.getBoundingClientRect().height;
          return height > 0 && height < 48;
        })
        .map((el) => el.outerHTML.slice(0, 80)),
    );
}

// The draft as it is on disk, the row that holds client_code in the settings store.
const storedDraft = (page: Page) =>
  page.evaluate(async () => {
    const [{ name }] = await indexedDB.databases();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(name!);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const rows = await new Promise<{ value?: Record<string, unknown> }[]>((resolve, reject) => {
      const all = db.transaction('settings').objectStore('settings').getAll();
      all.onsuccess = () => resolve(all.result);
      all.onerror = () => reject(all.error);
    });
    db.close();
    return rows.find((row) => row.value && 'client_code' in row.value)?.value ?? {};
  });

test('browse, search, get a code, and reach consent with the code verified', async ({ page }) => {
  await page.goto('/tailors');
  await expect(page.getByRole('heading', { name: en.directoryTitle })).toBeVisible();
  await expect(getCode(page, WANJIRU)).toBeVisible();
  await expect(getCode(page, OTIENO)).toBeVisible();
  await expect(page.getByText('Pending Tailors')).toHaveCount(0);
  // Otieno chose to show a phone. Wanjiru did not.
  await expect(page.getByRole('link', { name: /0700000002/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /0700000001/ })).toHaveCount(0);

  await page.getByLabel(en.directorySearch).fill('otieno');
  await expect(getCode(page, WANJIRU)).toHaveCount(0);
  await expect(getCode(page, OTIENO)).toBeVisible();

  await getCode(page, OTIENO).click();
  const shown = page.getByTestId('issued-code');
  await expect(shown).toHaveText(CODE);
  const code = (await shown.textContent())!;
  await expect(page.getByRole('heading', { name: new RegExp(OTIENO) })).toBeVisible();

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: en.directoryCopy }).click();
  await expect(page.getByRole('status')).toHaveText(en.directoryCopied);

  await page.getByRole('button', { name: en.continue, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/start\\?code=${code}`));
  await expect(page.getByText(OTIENO)).toBeVisible();
  await page.getByLabel(en.heightLabel).fill('170');
  await page.getByText(en.sexFemale, { exact: true }).click();
  await page.getByRole('button', { name: en.continue, exact: true }).click();
  await expect(page).toHaveURL(/\/consent/);
});

test('the code survives a reload, because it is saved before it is shown', async ({ page }) => {
  await page.goto('/tailors');
  await getCode(page, WANJIRU).click();
  const code = (await page.getByTestId('issued-code').textContent())!;
  await page.goto('/start');
  await expect(page.getByLabel(en.clientCodeLabel)).toHaveValue(code);
});

test('consent given for one tailor does not carry over to a new code', async ({ page }) => {
  await page.goto('/tailors');
  await getCode(page, WANJIRU).click();
  await page.getByRole('button', { name: en.continue, exact: true }).click();
  await page.getByLabel(en.heightLabel).fill('170');
  await page.getByText(en.sexFemale, { exact: true }).click();
  await page.getByRole('button', { name: en.continue, exact: true }).click();
  for (const box of [en.consentBox1, en.consentBox2, en.consentBox3]) {
    await page.getByText(box, { exact: true }).click();
  }
  await page.getByRole('button', { name: en.openCamera }).click();
  await expect(page).toHaveURL(/\/check/);
  expect(await storedDraft(page)).toHaveProperty('consent');
  await page.goto('/tailors');
  await getCode(page, OTIENO).click();
  const code = (await page.getByTestId('issued-code').textContent())!;
  const draft = await storedDraft(page);
  expect(draft.client_code).toBe(code);
  expect(draft).not.toHaveProperty('consent');
});

test('each tap gives a new code', async ({ page }) => {
  await page.goto('/tailors');
  await getCode(page, WANJIRU).click();
  const first = await page.getByTestId('issued-code').textContent();
  await page.getByRole('button', { name: en.directoryBack }).click();
  await getCode(page, WANJIRU).click();
  await expect(page.getByTestId('issued-code')).not.toHaveText(first!);
});

test('the Start screen offers the directory to someone with no code', async ({ page }) => {
  await page.goto('/start');
  await page.getByRole('button', { name: en.startNoCode }).click();
  await expect(page).toHaveURL(/\/tailors/);
});

test('a rate limit is explained and keeps the list', async ({ page }) => {
  await page.addInitScript(() => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) =>
      String(input).endsWith('/codes')
        ? Promise.resolve(
            new Response(JSON.stringify({ code: 'rate_limited' }), {
              status: 429,
              headers: { 'Content-Type': 'application/problem+json' },
            }),
          )
        : real(input, init);
  });
  await page.goto('/tailors');
  await getCode(page, WANJIRU).click();
  await expect(page.getByRole('alert')).toHaveText(en.directoryRateLimited);
  await expect(getCode(page, OTIENO)).toBeVisible();
});

test('it works in Kiswahili', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vt_language', 'sw'));
  await page.goto('/tailors');
  await expect(page.getByRole('heading', { name: sw.directoryTitle })).toBeVisible();
  await getCode(page, WANJIRU, sw.directoryGetCode).click();
  await expect(page.getByTestId('issued-code')).toHaveText(CODE);
});

for (const width of [360, 1280]) {
  test(`list and code screens pass axe and the 48 px rule at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/tailors');
    await expect(getCode(page, WANJIRU)).toBeVisible();
    await axe(page);
    expect(await smallTargets(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await getCode(page, WANJIRU).click();
    await expect(page.getByTestId('issued-code')).toHaveText(CODE);
    await axe(page);
    expect(await smallTargets(page)).toEqual([]);
  });
}

const goTo = (page: Page, path: string) =>
  page.evaluate((to) => {
    history.pushState({}, '', to);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);

test('a tailor opts out and the listing goes; they see and remove directory clients', async ({
  page,
}) => {
  await page.goto('/login');
  await page.locator('input[type=email]').fill('wanjiru@vt.test');
  await page.locator('input[type=password]').fill('vt-demo-2026');
  await page.locator('button[type=submit]').click();
  await page.waitForURL((url) => url.pathname !== '/login');
  const code = await page.evaluate(async (id) => {
    const reply = await fetch(`/api/v1/tailors/${id}/codes`, { method: 'POST' });
    return (await reply.json()).client_code as string;
  }, wanjiruListing.listing_id);
  await goTo(page, '/t/settings');

  const optIn = page.getByLabel(en.listingOptIn);
  await expect(optIn).toBeChecked();
  await optIn.uncheck();
  await page.getByRole('button', { name: en.listingSave }).click();
  await expect(page.getByRole('status')).toHaveText(en.listingSaved);
  const names = await page.evaluate(async () => {
    const reply = await (await fetch('/api/v1/tailors')).json();
    return reply.items.map((row: { business_name: string }) => row.business_name);
  });
  expect(names).toEqual([OTIENO]);

  await expect(page.getByText(code)).toBeVisible();
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    // The panels only: the prototype tailor layout around them moves to the contract in M9.
    await axe(page, 'section[aria-labelledby=listing-title]');
    await axe(page, 'section[aria-labelledby=directory-clients-title]');
  }
  await page.getByRole('button', { name: `${en.directoryClientRemove}: ${code}` }).click();
  await page
    .getByRole('button', { name: en.directoryClientConfirm.replace('{code}', code) })
    .click();
  await expect(page.getByText(code)).toHaveCount(0);
  await expect(page.getByText(en.directoryClientsEmpty)).toBeVisible();
});
