// A real build with VITE_FEATURE_DIRECTORY=false (D27): nothing of the directory can be reached.
import { expect, test } from '@playwright/test';
import { en } from '../../src/i18n/en';

test('no link anywhere a client goes', async ({ page }) => {
  for (const path of ['/', '/start', '/help']) {
    await page.goto(path);
    await expect(page.locator('#content')).toBeVisible();
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.getByText(new RegExp(`${en.navFindTailor}|Browse`, 'i'))).toHaveCount(0);
  }
  await page.goto('/');
  await page.getByRole('heading').first().waitFor();
  await page.locator('header button').last().click();
  await expect(page.getByText(en.navFindTailor)).toHaveCount(0);
});

test('the route is a 404', async ({ page }) => {
  await page.goto('/tailors');
  await expect(page.getByRole('heading', { name: en.errorNotFoundTitle })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(en.directoryGetCode) })).toHaveCount(0);
});

test('privacy text and tailor settings say nothing about it', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: en.privacyTitle })).toBeVisible();
  await expect(page.getByText(en.privacyListedTitle)).toHaveCount(0);
  await page.goto('/login');
  await page.locator('input[type=email]').fill('wanjiru@vt.test');
  await page.locator('input[type=password]').fill('vt-demo-2026');
  await page.locator('button[type=submit]').click();
  await page.waitForURL((url) => url.pathname !== '/login');
  await page.evaluate(() => {
    history.pushState({}, '', '/t/settings');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('button', { name: /Save Workshop/ })).toBeVisible();
  await expect(page.getByText(en.listingTitle)).toHaveCount(0);
});
