// The tailor directory and Get code (D27), on the mock.
import AxeBuilder from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../../src/i18n/en';
import { sw } from '../../src/i18n/sw';
import { panelEn, panelSw } from '../../src/views/tailor/directoryPanelText';
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

async function giveConsentThroughTheDirectory(page: Page) {
  await page.goto('/tailors');
  await getCode(page, WANJIRU).click();
  const code = (await page.getByTestId('issued-code').textContent())!;
  await page.getByRole('button', { name: en.continue, exact: true }).click();
  await page.getByLabel(en.heightLabel).fill('170');
  await page.getByText(en.sexFemale, { exact: true }).click();
  await page.getByRole('button', { name: en.continue, exact: true }).click();
  for (const box of [en.consentBox1, en.consentBox2, en.consentBox3]) {
    await page.getByText(box, { exact: true }).click();
  }
  await page.getByRole('button', { name: en.openCamera }).click();
  await expect(page).toHaveURL(/\/check/);
  return code;
}

test('typing a different code drops the consent, on disk before moving on', async ({ page }) => {
  await giveConsentThroughTheDirectory(page);
  await page.goto('/start');
  await page.getByLabel(en.clientCodeLabel).fill('AB1008');
  await page.getByRole('button', { name: en.continue, exact: true }).click();
  await expect(page).toHaveURL(/\/consent/);
  const draft = await storedDraft(page);
  expect(draft.client_code).toBe('AB1008');
  expect(draft).not.toHaveProperty('consent');
});

test('retyping the same code keeps the consent', async ({ page }) => {
  const code = await giveConsentThroughTheDirectory(page);
  await page.goto('/start');
  const input = page.getByLabel(en.clientCodeLabel);
  await expect(input).toHaveValue(code);
  await input.fill(code.slice(0, 3));
  await input.fill(code);
  await page.getByRole('button', { name: en.continue, exact: true }).click();
  await expect(page).toHaveURL(/\/consent/);
  expect(await storedDraft(page)).toHaveProperty('consent');
});

test('a link with a different code drops the consent too', async ({ page }) => {
  await giveConsentThroughTheDirectory(page);
  await page.goto('/start?code=AB1008');
  await expect(page.getByLabel(en.clientCodeLabel)).toHaveValue('AB1008');
  await expect.poll(async () => (await storedDraft(page)).client_code).toBe('AB1008');
  expect(await storedDraft(page)).not.toHaveProperty('consent');
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

  const optIn = page.getByLabel(panelEn.listingOptIn);
  await expect(optIn).toBeChecked();
  await optIn.uncheck();
  await page.getByRole('button', { name: panelEn.listingSave }).click();
  await expect(
    page.getByRole('region', { name: panelEn.listingTitle }).getByRole('status'),
  ).toHaveText(panelEn.listingSaved);
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
  await page.getByRole('button', { name: `${panelEn.directoryClientRemove}: ${code}` }).click();
  await page
    .getByRole('button', { name: panelEn.directoryClientConfirm.replace('{code}', code) })
    .click();
  await expect(page.getByText(code)).toHaveCount(0);
  await expect(page.getByText(panelEn.directoryClientsEmpty)).toBeVisible();
});

async function signInAtSettings(page: Page) {
  await page.goto('/login');
  await page.locator('input[type=email]').fill('wanjiru@vt.test');
  await page.locator('input[type=password]').fill('vt-demo-2026');
  await page.locator('button[type=submit]').click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

const issueCodes = (page: Page, count: number) =>
  page.evaluate(
    async ([id, times]) => {
      for (let i = 0; i < Number(times); i += 1) {
        await fetch(`/api/v1/tailors/${id}/codes`, { method: 'POST' });
      }
    },
    [wanjiruListing.listing_id, count],
  );

// The mock answers inside a service worker, which page.route cannot see, so fetch is wrapped instead.
async function listDirectoryClientsAs(page: Page, rows: Record<string, unknown>[]) {
  await page.addInitScript((all) => {
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input), location.href);
      const reply = await real(input, init);
      if (!url.pathname.endsWith('/me/directory-clients')) return reply;
      const body = await reply.json();
      const wanted = Number(url.searchParams.get('page'));
      const size = Number(url.searchParams.get('page_size'));
      return new Response(
        JSON.stringify({
          ...body,
          items: all.slice((wanted - 1) * size, wanted * size),
          page: wanted,
          page_size: size,
          total: all.length,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    };
  }, rows);
}

const row = (code: string, hasProfile: boolean, id = 1) => ({
  client_id: `33333333-3333-4333-8333-${String(id).padStart(12, '0')}`,
  client_code: code,
  created_at: '2026-10-31T08:00:00Z',
  has_profile: hasProfile,
});

test('a measured client gets a stronger warning than an unused one, in both languages', async ({
  page,
}) => {
  await listDirectoryClientsAs(page, [row('ZZ1111', true, 1), row('ZZ2222', false, 2)]);
  await signInAtSettings(page);
  await goTo(page, '/t/settings');
  const panel = page.getByRole('region', { name: panelEn.directoryClientsTitle });
  await panel.getByRole('button', { name: `${panelEn.directoryClientRemove}: ZZ2222` }).click();
  await expect(
    panel.getByRole('button', { name: panelEn.directoryClientConfirm.replace('{code}', 'ZZ2222') }),
  ).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await panel.getByRole('button', { name: en.cancel, exact: true }).click();

  await panel.getByRole('button', { name: `${panelEn.directoryClientRemove}: ZZ1111` }).click();
  await expect(panel.getByRole('alert')).toHaveText(
    panelEn.directoryClientMeasuredWarning.replace('{code}', 'ZZ1111'),
  );
  await expect(
    panel.getByRole('button', {
      name: panelEn.directoryClientMeasuredConfirm.replace('{code}', 'ZZ1111'),
    }),
  ).toBeVisible();
  await axe(page, 'section[aria-labelledby=directory-clients-title]');

  await page.getByRole('button', { name: en.hdrSwitchLang }).click();
  await expect(page.getByRole('alert').first()).toHaveText(
    panelSw.directoryClientMeasuredWarning.replace('{code}', 'ZZ1111'),
  );
});

test('a refused removal says why', async ({ page }) => {
  await page.addInitScript(() => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) =>
      init?.method === 'DELETE' || (input instanceof Request && input.method === 'DELETE')
        ? Promise.resolve(
            new Response(JSON.stringify({ code: 'client_records_retained' }), {
              status: 409,
              headers: { 'Content-Type': 'application/problem+json' },
            }),
          )
        : real(input, init);
  });
  await signInAtSettings(page);
  await issueCodes(page, 1);
  await goTo(page, '/t/settings');
  const panel = page.getByRole('region', { name: panelEn.directoryClientsTitle });
  await panel
    .getByRole('button', { name: new RegExp(`^${panelEn.directoryClientRemove}: `) })
    .click();
  await panel.getByRole('button', { name: /^Yes, remove/ }).click();
  await expect(panel.getByRole('alert')).toHaveText(panelEn.directoryClientRetained);
});

test('the tailor pages through directory clients and removes the unused ones', async ({ page }) => {
  // More rows than the mock's hourly limit can issue, with the real unused count underneath.
  await listDirectoryClientsAs(
    page,
    Array.from({ length: 30 }, (_, i) => row(`ZZ${1000 + i}`, true, i)),
  );
  await signInAtSettings(page);
  await issueCodes(page, 2);
  await goTo(page, '/t/settings');
  const panel = page.getByRole('region', { name: panelEn.directoryClientsTitle });
  const button = (name: string) => panel.getByRole('button', { name });
  await expect(panel.getByText('ZZ1000')).toBeVisible();
  await expect(panel.getByText('ZZ1025')).toHaveCount(0);
  await expect(panel.getByText('Page 1 of 2')).toBeVisible();
  await expect(button(panelEn.directoryClientsPrevious)).toBeDisabled();

  await button(panelEn.directoryClientsNext).click();
  await expect(panel.getByText('ZZ1025')).toBeVisible();
  await expect(panel.getByText('ZZ1000')).toHaveCount(0);
  await expect(button(panelEn.directoryClientsNext)).toBeDisabled();

  await button(panelEn.directoryClientsRemoveUnused.replace('{count}', '2')).click();
  await expect(panel.getByRole('alert')).toContainText(panelEn.directoryClientsRemoveUnusedWarning);
  await button(panelEn.directoryClientsRemoveUnusedConfirm.replace('{count}', '2')).click();
  await expect(panel.getByRole('status')).toHaveText(
    panelEn.directoryClientsRemovedUnused.replace('{count}', '2'),
  );
  await expect(button(panelEn.directoryClientsRemoveUnused.replace('{count}', '2'))).toHaveCount(0);
  await expect(panel.getByText('Page 2 of 2')).toBeVisible();
});
