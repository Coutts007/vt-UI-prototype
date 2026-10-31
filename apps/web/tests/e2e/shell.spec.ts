import AxeBuilder from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';

const PUBLIC = [
  '/',
  '/start',
  '/consent',
  '/check',
  '/sheet',
  '/setup',
  '/saved',
  '/me',
  '/me/x',
  '/help',
  '/privacy',
  '/declined',
  '/login',
  '/register',
  '/register/pending',
];
const TAILOR = [
  '/t/clients',
  '/t/clients/new',
  '/t/orders',
  '/t/orders/new',
  '/t/conflicts',
  '/t/audit',
  '/t/settings',
];
const ADMIN = [
  '/admin/accounts',
  '/admin/audit',
  '/admin/settings',
  '/admin/study/participants',
  '/admin/study/measurers',
  '/admin/study/export',
];

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill('vt-demo-2026');
  await page.locator('button[type=submit]').click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

async function checkRoute(page: Page, path: string, locale: string, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.evaluate((l) => localStorage.setItem('vt_language', l), locale);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByRole('heading', { name: /not found|haukupatikana/i })).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect.soft(overflow, `${path} scrolls sideways at ${width}`).toBe(false);
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect
    .soft(
      serious.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`)),
      `${path} ${locale} ${width}`,
    )
    .toEqual([]);
}

for (const locale of ['en', 'sw']) {
  for (const width of [360, 1280]) {
    test(`public routes ${locale} ${width}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.goto('/');
      for (const path of PUBLIC) await checkRoute(page, path, locale, width);
    });
    test(`tailor routes ${locale} ${width}`, async ({ page }) => {
      test.setTimeout(120_000);
      await signIn(page, 'wanjiru@vt.test');
      for (const path of TAILOR) await checkRoute(page, path, locale, width);
    });
    test(`admin routes ${locale} ${width}`, async ({ page }) => {
      test.setTimeout(120_000);
      await signIn(page, 'admin@vt.test');
      for (const path of ADMIN) await checkRoute(page, path, locale, width);
    });
  }
}

test('signed-out people go to login and come back', async ({ page }) => {
  await page.goto('/t/orders');
  await expect(page).toHaveURL(/\/login\?next=%2Ft%2Forders/);
});

test('the wrong role sees 403, and unknown paths see 404', async ({ page }) => {
  await signIn(page, 'wanjiru@vt.test');
  await page.goto('/admin/accounts');
  await expect(page.getByRole('heading', { name: /cannot open/i })).toBeVisible();
  await page.goto('/nope');
  await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible();
});

test('the client flow downloads no tailor, admin or study code', async ({ page }) => {
  const loaded: string[] = [];
  page.on('response', (response) => loaded.push(response.url()));
  await page.goto('/');
  await page.goto('/consent');
  await page.waitForLoadState('networkidle');
  expect(
    loaded.filter((url) => /Tailor(?!.*Layout)|Admin|Study|OrderQueue|ClientList/.test(url)),
  ).toEqual([]);
});

test('no request leaves the site', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (request) => {
    if (
      !request.url().startsWith(`http://localhost:${process.env.VT_E2E_PORT ?? 4173}`) &&
      !request.url().startsWith('data:')
    ) {
      outside.push(request.url());
    }
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(outside).toEqual([]);
});

test('the offline banner appears', async ({ page, context }) => {
  await page.goto('/help');
  await expect(page.locator('#content')).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/You are offline|Huna mtandao/)).toBeVisible();
  await context.setOffline(false);
});

test('a new order starts from the profile that was chosen', async ({ page }) => {
  await signIn(page, 'wanjiru@vt.test');
  await page.goto('/t/orders/new?profileId=p-02');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#neworderview-2')).toHaveValue('p-02');
});
