// What only the real API can show: what the server stored and said about a phone's profile.
import { expect, Page, test } from '@playwright/test';
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

const profileIds = (page: Page): Promise<string[]> =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('virtual_tailor');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('profiles').objectStore('profiles').getAllKeys();
          all.onsuccess = () => resolve(all.result as string[]);
          all.onerror = () => reject(all.error);
        };
      }),
  );

test('offline, then online: the profile arrives once, and the server agrees with the phone', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(150_000);
  const code = await freshCode(request);
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
  // Back and forward wake the queue again; nothing further may arrive.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const ids = await profileIds(page);
  expect(ids).toHaveLength(1);

  const reply = await request.post('/api/v1/data-requests/access', {
    data: { client_code: code, profile_ids: ids },
  });
  expect(reply.status()).toBe(200);
  const data = await reply.json();
  expect(data.profiles).toHaveLength(1);
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
  const ids = await profileIds(page);
  await page.getByRole('button', { name: en.done, exact: true }).click();
  await page.getByTestId('profile-list').getByRole('button').first().click();
  await page.getByRole('button', { name: en.deleteMyData }).click();
  await page.getByRole('dialog').getByRole('button', { name: en.confirm }).click();
  await page.getByRole('button', { name: en.deleteYes }).click();
  await expect(page.getByText(en.noMeasurementsYet)).toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await request.post('/api/v1/data-requests/access', {
            data: { client_code: code, profile_ids: ids },
          })
        ).status(),
      { timeout: 45_000 },
    )
    .toBe(404);
});
