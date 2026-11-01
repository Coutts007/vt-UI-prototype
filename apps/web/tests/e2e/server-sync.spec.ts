// What only the real API can show: what the server stored and said about a phone's profile.
import { APIRequestContext, devices, expect, Page, test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../../src/i18n/en';
import { freshCode } from './real-api';

test.use({ actionTimeout: 15_000 });

const ASSETS = join(import.meta.dirname, '../../dist-real-api/assets');

async function toReview(page: Page, code: string) {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'vt_fake_vision',
      JSON.stringify({ scenario: 'good', recover: false, speed: 0.1 }),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: en.welcomeEnGo }).click();
  await page.getByLabel(en.clientCodeLabel).fill(code);
  await page.getByLabel(en.heightLabel).fill('170');
  await page.getByText(en.sexFemale, { exact: true }).click();
  await page.getByRole('button', { name: en.continue, exact: true }).click();
  for (const box of [en.consentBox1, en.consentBox2, en.consentBox3]) {
    await page.getByText(box, { exact: true }).click();
  }
  await page.getByRole('button', { name: en.openCamera }).click();
  await page.getByRole('button', { name: en.continue, exact: true }).click({ timeout: 15_000 });
  await page.getByText(en.sheetOptionTailor, { exact: true }).click();
  await page.getByRole('button', { name: en.printCheckYes }).click();
  await page.getByRole('button', { name: en.continue, exact: true }).click();
  await page.getByRole('button', { name: en.downloadLater }).click();
  await page.getByRole('button', { name: en.continue, exact: true }).click();
  await page.getByRole('button', { name: en.allowCamera }).click();
  const motion = page.getByRole('button', { name: en.allowMotion });
  const place = page.getByRole('heading', { name: en.placePhoneTitle });
  await motion.or(place).first().waitFor();
  if (await motion.isVisible()) await motion.click();
  await place.waitFor();
  await page.getByRole('button', { name: en.volumePlay }).click();
  await page.getByRole('button', { name: en.volumeYes }).click();
  const start = page.getByRole('button', { name: en.readyStart });
  await expect(start).toBeEnabled({ timeout: 10_000 });
  await start.click();
  await expect(page).toHaveURL(/\/review/, { timeout: 120_000 });
}

async function save(page: Page) {
  await page.getByRole('button', { name: en.saveAndSend }).click();
  await expect(page).toHaveURL(/\/saved/);
}

const readTable = (page: Page, table: string): Promise<Record<string, string>[]> =>
  page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('virtual_tailor');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction(name).objectStore(name).getAll();
          all.onsuccess = () => resolve(all.result as Record<string, string>[]);
          all.onerror = () => reject(all.error);
        };
      }),
    table,
  );

const secretOf = async (page: Page, code: string) =>
  (await readTable(page, 'client_secrets')).find((row) => row.client_code === code)?.secret ?? '';

const askAccess = (request: APIRequestContext, code: string, secret: string) =>
  request.post('/api/v1/data-requests/access', {
    data: { client_code: code },
    headers: { 'X-Client-Secret': secret },
  });

test('offline, then online: the profile arrives once, and the server agrees with the phone', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(150_000);
  const code = await freshCode(request);
  const sends: string[] = [];
  page.on('request', (sent) => {
    if (sent.method() === 'POST' && new URL(sent.url()).pathname === '/api/v1/profiles') {
      sends.push(sent.url());
    }
  });
  await toReview(page, code);
  const names = readdirSync(ASSETS).filter((n) =>
    /^(SavedView|MyMeasurementsView|sync)-.*\.js$/.test(n),
  );
  await page.evaluate(async (list) => {
    await Promise.all(list.map((name) => import(/* @vite-ignore */ `/assets/${name}`)));
  }, names);
  await context.setOffline(true);
  await save(page);
  await expect(page.getByRole('heading', { name: en.savedTitlePending })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole('heading', { name: en.savedTitleSynced })).toBeVisible({
    timeout: 30_000,
  });
  // Every trigger the app has, then long enough for any send they start to show.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.reload();
  await page.waitForTimeout(3_000);
  expect(await readTable(page, 'pending_sync')).toEqual([]);

  const reply = await askAccess(request, code, await secretOf(page, code));
  expect(reply.status()).toBe(200);
  const data = await reply.json();
  expect(data.profiles).toHaveLength(1);
  expect(sends.length).toBeLessThanOrEqual(2); // One lost to going offline at most, one that arrived.
  expect(data.profiles[0].status).toBe('final');
  expect(data.profiles[0].measurements).toHaveLength(9);
  const kinds = data.profiles[0].server_checks.map((c: { kind: string }) => c.kind);
  expect(kinds).not.toContain('client_server_mismatch');
  expect(kinds).not.toContain('rules_version_unknown');
});

test('delete my data removes the profile from the server', async ({ page, request }) => {
  test.setTimeout(120_000);
  const code = await freshCode(request);
  await toReview(page, code);
  await save(page);
  await expect(page.getByRole('heading', { name: en.savedTitleSynced })).toBeVisible({
    timeout: 15_000,
  });
  const secret = await secretOf(page, code);
  await page.getByRole('button', { name: en.done, exact: true }).click();
  await page.getByTestId('profile-list').getByRole('button').first().click();
  await page.getByRole('button', { name: en.deleteMyData }).click();
  await page.getByRole('dialog').getByRole('button', { name: en.confirm }).click();
  await page.getByRole('button', { name: en.deleteYes }).click();
  await expect(page.getByText(en.noMeasurementsYet)).toBeVisible();
  // The secret survives, so the phone can still prove who asks, and now there is nothing to read.
  await expect
    .poll(async () => (await (await askAccess(request, code, secret)).json()).profiles?.length, {
      timeout: 45_000,
    })
    .toBe(0);
});

test('a second phone is refused, stores nothing, and is told to ask the tailor', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const code = await freshCode(request);
  await toReview(page, code);
  await save(page);
  await expect(page.getByRole('heading', { name: en.savedTitleSynced })).toBeVisible({
    timeout: 15_000,
  });
  const secret = await secretOf(page, code);

  const other = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
  const second = await other.newPage();
  await toReview(second, code);
  await save(second);
  await expect(second.getByRole('alert').filter({ hasText: en.syncSecretRefused })).toBeVisible({
    timeout: 15_000,
  });
  const data = await (await askAccess(request, code, secret)).json();
  expect(data.profiles).toHaveLength(1);
  expect((await askAccess(request, code, await secretOf(second, code))).status()).toBe(403);
  await other.close();
});
