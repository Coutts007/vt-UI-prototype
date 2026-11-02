// The production headers from Caddy, and the app working under them (M12, frontend-spec 19).
// Runs only through Caddy (playwright.real-api.config.ts); the vision workers are covered by
// the real-vision-csp project of the same config.
import { expect, test } from '@playwright/test';
import { tailorEn as tx } from '../../src/views/tailor/tailorText';
import { API_CSP, expectSecurityHeaders, recordViolations } from './csp-support';

test('the page, its assets and the API carry the security headers', async ({ request }) => {
  const page = await request.get('/');
  expect(page.status()).toBe(200);
  expectSecurityHeaders(page);
  expect(page.headers()['cache-control']).toBe('no-cache');
  const asset = (await page.text()).match(/\/assets\/[^"]+\.js/)?.[0];
  expect(asset).toBeTruthy();
  expectSecurityHeaders(await request.get(asset!));
  const api = await request.get('/api/v1/health');
  expect(api.status()).toBe(200);
  expectSecurityHeaders(api, API_CSP);
  expect(api.headers()['cache-control']).toBe('no-store');
  expect((await request.get('/sw.js')).headers()['cache-control']).toBe('no-cache');
});

test('the client, tailor, admin and study screens run with nothing blocked', async ({ page }) => {
  const violations = await recordViolations(page);
  await page.goto('/');
  await expect(page.locator('#content')).toBeVisible();
  await page.goto('/login');
  await page.getByLabel(tx.emailLabel).fill('wanjiru@vt.test');
  await page.locator('input[type=password]').fill('vt-demo-2026');
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/t\//);
  await page.goto('/t/orders');
  await expect(page.locator('#content')).toBeVisible();
  await page.goto('/login');
  await page.getByLabel(tx.emailLabel).fill('admin@vt.test');
  await page.locator('input[type=password]').fill('vt-demo-2026');
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/admin\//);
  await page.goto('/admin/study/participants');
  await expect(page.locator('#content')).toBeVisible();
  expect(await violations()).toEqual([]);
});
