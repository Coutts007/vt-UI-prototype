// The accessibility pass of frontend-spec 17 (M16): axe on every route in both languages at
// 360 px and 1280 px with no serious or critical violation, one h1 per screen, the skip link
// first in the tab order, reduced motion honoured on the capture and processing screens, and
// the dashboard readable at 200 % zoom, and touch targets of 48 px on a phone. On the mock, with the seed's accounts.
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

// Routes that need no capture state. /capture/front, /capture/side, /processing, /review and
// /me/:profileId need a capture, and /consent and /setup need the earlier steps (they send a
// cold visit back to /start), so all of them are checked below during the walk-through.
const CLIENT_ROUTES = [
  '/',
  '/start',
  '/check',
  '/sheet',
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

// An error page also has one h1, a skip link and no axe finding, so it must not pass as a route.
const ERROR_TITLES = (
  ['errorNotFoundTitle', 'errorForbiddenTitle', 'errorGenericTitle', 'errorDisabledTitle'] as const
).flatMap((k) => [en[k], sw[k]]);

async function noErrorPage(page: Page, label: string) {
  for (const title of ERROR_TITLES) {
    await expect(page.getByRole('heading', { name: title, exact: true }), label).toHaveCount(0);
  }
}

// The screen-level checks shared by every route: axe, one h1, the page's language.
async function checkScreen(page: Page, label: string, locale: string) {
  await expect(page.locator('html'), `${label}: lang`).toHaveAttribute('lang', locale);
  await noErrorPage(page, label);
  expect(await seriousViolations(page), label).toEqual([]);
  expect(await page.locator('h1').count(), `${label}: one h1`).toBe(1);
}

async function checkRoute(page: Page, path: string, locale: string, width: number) {
  const label = `${path} ${locale} ${width}`;
  await page.setViewportSize({ width, height: 800 });
  await page.evaluate((l) => localStorage.setItem('vt_language', l), locale);
  await page.goto(path);
  await settle(page);
  // A silent redirect (to /login after a lost session, say) is not this route.
  expect(new URL(page.url()).pathname, `${label}: stayed on the route`).toBe(path);
  await expect(page.locator('#content'), label).not.toBeEmpty();
  await checkScreen(page, label, locale);
  // The skip link comes first in the tab order and points at the content landmark.
  await page.locator('body').focus();
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => {
    const el = document.activeElement as HTMLAnchorElement | null;
    return el ? { tag: el.tagName, href: el.getAttribute('href') } : null;
  });
  expect(first, `${label}: skip link first`).toEqual({ tag: 'A', href: '#content' });
  // Focus is visible: the skip link comes on screen and carries the 3 px focus ring.
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const box = el.getBoundingClientRect();
    return { x: box.x, outline: getComputedStyle(el).outlineWidth };
  });
  expect(focused.x, `${label}: skip link visible on focus`).toBeGreaterThanOrEqual(0);
  expect(focused.outline, `${label}: focus ring`).toBe('3px');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, `${label}: scrolls sideways`).toBe(false);
  // Touch targets of 48 px or more on a phone (frontend-spec 17). A control inside a label counts
  // the label; a link inside running text and a visually hidden input are exempt.
  if (width === 360) expect(await smallTargets(page), `${label}: touch targets`).toEqual([]);
}

async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const small: string[] = [];
    const controls = document.querySelectorAll<HTMLElement>(
      'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab]',
    );
    for (const el of controls) {
      const box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1 || box.x < 0) continue;
      if (el.tagName === 'A' && el.closest('p')) continue;
      const label = el.closest('label')?.getBoundingClientRect();
      const w = Math.max(box.width, label?.width ?? 0);
      const h = Math.max(box.height, label?.height ?? 0);
      if (w < 47.5 || h < 47.5) {
        small.push(`${Math.round(w)}x${Math.round(h)} ${el.outerHTML.slice(0, 100)}`);
      }
    }
    return small;
  });
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

// 200 % zoom without loss (frontend-spec 17), in both languages because Kiswahili labels are
// longer: page zoom (a 1280 px window at 200 % leaves 640 CSS pixels) and text zoom (root font
// size doubled at 1280 px). Neither may scroll sideways or clip a heading or a button.
async function fitsAtZoom(page: Page, label: string) {
  const loss = await page.evaluate(() => {
    const sideways = document.documentElement.scrollWidth > document.documentElement.clientWidth;
    const clipped = [...document.querySelectorAll<HTMLElement>('h1, button')]
      .filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.outerHTML.slice(0, 80));
    return { sideways, clipped };
  });
  expect(loss, label).toEqual({ sideways: false, clipped: [] });
}

for (const locale of ['en', 'sw']) {
  for (const mode of ['page', 'text'] as const) {
    test(`the dashboard keeps everything at 200 % ${mode} zoom ${locale}`, async ({ page }) => {
      test.setTimeout(240_000);
      const check = async (path: string) => {
        await page.setViewportSize({ width: mode === 'page' ? 640 : 1280, height: 800 });
        await page.evaluate((l) => localStorage.setItem('vt_language', l), locale);
        await page.goto(path);
        await settle(page);
        if (mode === 'text') {
          await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
          await settle(page);
        }
        await fitsAtZoom(page, `${path} ${locale} ${mode} zoom`);
      };
      await signIn(page, 'wanjiru@vt.test');
      for (const path of TAILOR_ROUTES) await check(path);
      await signIn(page, 'admin@vt.test');
      for (const path of ADMIN_ROUTES) await check(path);
      await signIn(page, 'measurer-a@vt.test');
      for (const path of MEASURER_ROUTES) await check(path);
      expect(DASHBOARD.length).toBeGreaterThan(0);
    });
  }
}

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
  const locale = d === sw ? 'sw' : 'en';
  await settle(page);
  await checkScreen(page, `/consent ${locale}`, locale);
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
  await settle(page);
  await checkScreen(page, `/setup ${locale}`, locale);
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

// The capture screens, review and a saved profile: axe and one h1 in both languages, with
// reduced motion checked on the way (every animation as good as instant).
for (const locale of ['en', 'sw']) {
  test(`capture, processing, review and a saved profile pass axe ${locale}`, async ({ page }) => {
    // The fake vision runs at the normal pace, and the full suite shares the CPU with it.
    test.setTimeout(480_000);
    const d = locale === 'sw' ? sw : en;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.addInitScript((l) => localStorage.setItem('vt_language', l), locale);
    await toCapture(page, d);
    await expect(page.getByTestId('instruction')).not.toBeEmpty({ timeout: 20_000 });
    expect(await longestAnimationMs(page), 'front').toBeLessThanOrEqual(1);
    await checkScreen(page, `/capture/front ${locale}`, locale);
    await page.waitForURL(/\/capture\/side/, { timeout: 60_000 });
    await expect(page.getByText(d.sideViewTitle)).toBeVisible({ timeout: 60_000 });
    expect(await longestAnimationMs(page), 'side').toBeLessThanOrEqual(1);
    await checkScreen(page, `/capture/side ${locale}`, locale);
    await page.waitForURL(/\/processing/, { timeout: 60_000 });
    expect(await longestAnimationMs(page), 'processing').toBeLessThanOrEqual(1);
    await checkScreen(page, `/processing ${locale}`, locale);
    await page.waitForURL(/\/review/, { timeout: 60_000 });
    await settle(page);
    await checkScreen(page, `/review ${locale}`, locale);
    await page.getByRole('button', { name: d.saveAndSend }).click();
    await expect(page).toHaveURL(/\/saved/);
    await page.goto('/me');
    await settle(page);
    await page.getByTestId('profile-list').getByRole('button').first().click();
    await expect(page).toHaveURL(/\/me\/[0-9a-f-]{36}$/);
    await settle(page);
    await checkScreen(page, `/me/:profileId ${locale}`, locale);
  });
}

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
