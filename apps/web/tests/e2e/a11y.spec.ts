// The accessibility pass of frontend-spec 17 (M16): axe on every route in both languages at
// 360 px and 1280 px with no serious or critical violation, one h1 per screen, the skip link
// first in the tab order, reduced motion honoured on the capture and processing screens, and
// the dashboard readable at 200 % zoom. On the mock, with the seed's accounts.
import AxeBuilder from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../../src/i18n/en';
import { sw } from '../../src/i18n/sw';

type Dict = typeof en;
const seed = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../packages/seed/seed.json'), 'utf8'),
);
const CLIENT = seed.clients.find((c: { client_code: string }) => c.client_code === 'AB1001');
const PROFILE = seed.profiles.find((p: { client_id: string }) => p.client_id === CLIENT.client_id);
const ORDER = seed.orders.find((o: { client_code: string }) => o.client_code === 'AB1001');

// Routes that need no capture state. /capture and /processing are checked below with the fake
// vision worker; /review needs a finished capture and is covered by client.spec.
const CLIENT_ROUTES = [
  '/',
  '/start',
  '/consent',
  '/check',
  '/sheet',
  '/setup',
  '/saved',
  '/me',
  '/help',
  '/privacy',
  '/declined',
  '/tailors',
  '/login',
  '/register',
  '/register/pending',
];
const TAILOR_ROUTES = [
  '/t/clients',
  '/t/clients/new',
  `/t/clients/${CLIENT.client_id}`,
  `/t/clients/${CLIENT.client_id}/profiles/${PROFILE.profile_id}`,
  '/t/orders',
  '/t/orders/new',
  `/t/orders/${ORDER.order_id}`,
  `/t/orders/${ORDER.order_id}/sheet`,
  '/t/conflicts',
  '/t/audit',
  '/t/settings',
];
const ADMIN_ROUTES = [
  '/admin/accounts',
  '/admin/audit',
  '/admin/settings',
  '/admin/capture-modes',
  '/admin/study/participants',
  '/admin/study/measurers',
  '/admin/study/export',
  '/study/capture',
];
const MEASURER_ROUTES = ['/study/reference'];
const DASHBOARD = [...TAILOR_ROUTES, ...ADMIN_ROUTES, ...MEASURER_ROUTES];

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill('vt-demo-2026');
  await page.locator('button[type=submit]').click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  // A skeleton or a colour transition would be measured half-way.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running'),
  );
}

async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 120)}`));
}

async function checkRoute(page: Page, path: string, locale: string, width: number) {
  const label = `${path} ${locale} ${width}`;
  await page.setViewportSize({ width, height: 800 });
  await page.evaluate((l) => localStorage.setItem('vt_language', l), locale);
  await page.goto(path);
  await settle(page);
  await expect(page.locator('#content'), label).not.toBeEmpty();
  await expect(page.getByRole('heading', { name: /not found|haukupatikana/i }), label).toHaveCount(
    0,
  );
  expect(await seriousViolations(page), label).toEqual([]);
  // One h1 per screen (frontend-spec 17).
  expect(await page.locator('h1').count(), `${label}: one h1`).toBe(1);
  // The skip link comes first in the tab order and points at the content landmark.
  await page.locator('body').focus();
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => {
    const el = document.activeElement as HTMLAnchorElement | null;
    return el ? { tag: el.tagName, href: el.getAttribute('href') } : null;
  });
  expect(first, `${label}: skip link first`).toEqual({ tag: 'A', href: '#content' });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow, `${label}: scrolls sideways`).toBe(false);
}

for (const locale of ['en', 'sw']) {
  for (const width of [360, 1280]) {
    test(`client and sign-in routes pass axe ${locale} ${width}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.goto('/');
      for (const path of CLIENT_ROUTES) await checkRoute(page, path, locale, width);
    });
    test(`tailor routes pass axe ${locale} ${width}`, async ({ page }) => {
      test.setTimeout(180_000);
      await signIn(page, 'wanjiru@vt.test');
      for (const path of TAILOR_ROUTES) await checkRoute(page, path, locale, width);
    });
    test(`admin and study routes pass axe ${locale} ${width}`, async ({ page }) => {
      test.setTimeout(180_000);
      await signIn(page, 'admin@vt.test');
      for (const path of ADMIN_ROUTES) await checkRoute(page, path, locale, width);
      await signIn(page, 'measurer-a@vt.test');
      for (const path of MEASURER_ROUTES) await checkRoute(page, path, locale, width);
    });
  }
}

// 200 % browser zoom on a 1280 px window leaves 640 CSS pixels: the dashboard must still fit.
test('the dashboard has no sideways scroll at 200 % zoom', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'wanjiru@vt.test');
  const check = async (path: string) => {
    await page.setViewportSize({ width: 640, height: 400 });
    await page.goto(path);
    await settle(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow, `${path} scrolls sideways at 200 % zoom`).toBe(false);
  };
  for (const path of TAILOR_ROUTES) await check(path);
  await signIn(page, 'admin@vt.test');
  for (const path of ADMIN_ROUTES) await check(path);
  await signIn(page, 'measurer-a@vt.test');
  for (const path of MEASURER_ROUTES) await check(path);
  expect(DASHBOARD.length).toBeGreaterThan(0);
});

// The capture flow on the fake vision worker (as client.spec.ts), at the normal pace so the
// processing screen stays long enough to be looked at.
async function toCapture(page: Page, d: Dict) {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'vt_fake_vision',
      JSON.stringify({ scenario: 'good', recover: false, speed: 1 }),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: d === sw ? sw.welcomeSwGo : en.welcomeEnGo }).click();
  await expect(page).toHaveURL(/\/start/);
  await page.getByLabel(d.clientCodeLabel).fill('AB1008');
  await page.getByLabel(d.heightLabel).fill('170');
  await page.getByText(d.sexFemale, { exact: true }).click();
  await page.getByRole('button', { name: d.continue, exact: true }).click();
  await expect(page).toHaveURL(/\/consent/);
  for (const box of [d.consentBox1, d.consentBox2, d.consentBox3]) {
    await page.getByText(box, { exact: true }).click();
  }
  await page.getByRole('button', { name: d.openCamera }).click();
  await expect(page).toHaveURL(/\/check/);
  await page.getByRole('button', { name: d.continue, exact: true }).click({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/sheet/);
  await page.getByText(d.sheetOptionTailor, { exact: true }).click();
  await page.getByRole('button', { name: d.printCheckYes }).click();
  await page.getByRole('button', { name: d.continue, exact: true }).click();
  await expect(page).toHaveURL(/\/setup/);
  await page.getByRole('button', { name: d.downloadLater }).click();
  await page.getByRole('button', { name: d.continue, exact: true }).click();
  await page.getByRole('button', { name: d.allowCamera }).click();
  const motion = page.getByRole('button', { name: d.allowMotion });
  const place = page.getByRole('heading', { name: d.placePhoneTitle });
  await motion.or(place).first().waitFor();
  if (await motion.isVisible()) await motion.click();
  await place.waitFor();
  await page.getByRole('button', { name: d.volumePlay }).click();
  await page.getByRole('button', { name: d.volumeYes }).click();
  const start = page.getByRole('button', { name: d.readyStart });
  await expect(start).toBeEnabled({ timeout: 10_000 });
  await start.click();
  await expect(page).toHaveURL(/\/capture\/front/);
}

// Every animation and transition still on the page is as good as instant.
const longestAnimationMs = (page: Page) =>
  page.evaluate(() =>
    Math.max(
      0,
      ...document.getAnimations().map((a) => {
        const duration = a.effect?.getComputedTiming().duration;
        return typeof duration === 'number' ? duration : 0;
      }),
    ),
  );

test('reduced motion is honoured on the capture and processing screens', async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toCapture(page, en);
  await expect(page.getByTestId('instruction')).not.toBeEmpty({ timeout: 20_000 });
  expect(await longestAnimationMs(page), 'capture').toBeLessThanOrEqual(1);
  await expect(page.getByText(en.sideViewTitle)).toBeVisible({
    timeout: 60_000,
  });
  expect(await longestAnimationMs(page), 'side view').toBeLessThanOrEqual(1);
  await page.waitForURL(/\/processing/, { timeout: 60_000 });
  expect(await longestAnimationMs(page), 'processing').toBeLessThanOrEqual(1);
  await expect(page).toHaveURL(/\/review/, { timeout: 60_000 });
});
