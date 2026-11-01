// A real build with VITE_FEATURE_DIRECTORY=false (D27): nothing of the directory can be reached.
import { expect, test } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../../src/i18n/en';
import { tailorEn } from '../../src/views/tailor/tailorText';
import { panelEn } from '../../src/views/tailor/directoryPanelText';

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
  await expect(page.getByRole('button', { name: tailorEn.saveSettings })).toBeVisible();
  await expect(page.getByText(panelEn.listingTitle)).toHaveCount(0);
});

test.describe('a production build with the flag unset', () => {
  const dist = join(import.meta.dirname, '../../dist-directory-default');
  const BASE = `http://localhost:${Number(process.env.VT_E2E_PORT ?? 4173) + 11}`;

  test('the built files hold none of the directory', () => {
    const assets = readdirSync(join(dist, 'assets'));
    expect(assets.some((name) => name.startsWith('WelcomeView-'))).toBe(true);
    expect(assets.filter((name) => /Directory/.test(name))).toEqual([]);
    expect(existsSync(join(dist, 'mockServiceWorker.js'))).toBe(false);
    for (const name of assets.filter((file) => file.endsWith('.js'))) {
      const code = readFileSync(join(dist, 'assets', name), 'utf8');
      expect(code.includes('/me/directory-clients'), name).toBe(false);
      expect(code.includes('/codes'), name).toBe(false);
    }
  });

  test('the running build has no route or link to it', async ({ page }) => {
    await page.goto(`${BASE}/tailors`);
    await expect(page.getByRole('heading', { name: en.errorNotFoundTitle })).toBeVisible();
    await page.goto(`${BASE}/start`);
    await expect(page.locator('#content')).toBeVisible();
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.getByRole('button', { name: en.startNoCode })).toHaveCount(0);
  });
});
