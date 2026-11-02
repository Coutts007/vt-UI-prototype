// The admin and study screens, on the mock and on the real API (M11). Enrolment, the A9 banner,
// blind tape entry, and the proof that the measurer's screen never holds a system value.
import AxeBuilder from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../../src/i18n/en';
import { adminEn as ax } from '../../src/views/admin/adminText';
import { tailorEn as tx } from '../../src/views/tailor/tailorText';

const seed = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../packages/seed/seed.json'), 'utf8'),
);
const SITES = [
  'stature',
  'shoulder',
  'chest',
  'waist',
  'hip',
  'sleeve',
  'outleg',
  'inleg',
  'neck',
] as const;
// What the measurer types: chosen so none of them is one of the seed's system values below.
const TYPED: Record<(typeof SITES)[number], string> = {
  stature: '171.3',
  shoulder: '43.7',
  chest: '97.1',
  waist: '81.9',
  hip: '99.3',
  sleeve: '61.7',
  outleg: '103.9',
  inleg: '77.3',
  neck: '38.9',
};

test.use({ viewport: { width: 360, height: 780 } });

async function go(page: Page, path: string) {
  await page.evaluate((to) => {
    history.pushState(null, '', to);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

// In the app, so the mock's data (which lives in the page) survives a change of account.
async function signInAs(page: Page, email: string, home: RegExp) {
  await go(page, '/login');
  await page.getByLabel(tx.emailLabel).fill(email);
  await page.locator('input[type=password]').fill('vt-demo-2026');
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(home);
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: en.hdrSignOut }).first().click();
  await expect(page).toHaveURL(/\/login/);
}

async function clean(page: Page) {
  const found = await new AxeBuilder({ page }).analyze();
  expect(found.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
}

async function typeReadings(page: Page, code: string, readingNo: 1 | 2) {
  await page.getByLabel(ax.participantCode).fill(code);
  await page.getByRole('button', { name: String(readingNo), exact: true }).click();
  for (const site of SITES) {
    await page.getByLabel(`${ax[`site_${site}`]} (cm)`).fill(TYPED[site]);
  }
}

test('the admin enrols a participant and a measurer enters readings blind', async ({ page }) => {
  await page.goto('/login');
  await signInAs(page, 'admin@vt.test', /\/admin\/accounts/);
  await expect(page.getByRole('heading', { name: ax.accountsTitle })).toBeVisible();
  await clean(page);

  await go(page, '/admin/settings');
  await expect(page.getByRole('heading', { name: ax.approvalsTitle })).toBeVisible();
  await expect(page.getByRole('heading', { name: ax.deletionsTitle })).toBeVisible();
  await clean(page);

  await go(page, '/admin/study/participants');
  // Dev and staging hold synthetic data only, and the A9 banner says what production still needs.
  await expect(page.getByRole('alert').filter({ hasText: 'ierc_ref' })).toBeVisible();
  await expect(page.getByText('P005', { exact: true })).toBeVisible();
  const code = await page.getByLabel(ax.participantCode).getAttribute('placeholder');
  expect(code).toMatch(/^P\d{3}$/);
  await page.getByLabel(ax.venue).fill('Synthetic venue');
  await page.getByRole('button', { name: ax.enrol }).click();
  await expect(page.getByRole('status').filter({ hasText: code! })).toBeVisible();
  await expect(page.getByText(code!, { exact: true })).toBeVisible();
  await clean(page);

  // The researcher sets the participant's first set, then the client flow takes over.
  await page.getByRole('button', { name: ax.startCapture }).last().click();
  await expect(page).toHaveURL(new RegExp(`/study/capture\\?participant=${code}`));
  await page.getByLabel(ax.statureCm).fill('171.3');
  await page.getByLabel(ax.paperConsent.replace('{code}', code!)).check();
  await clean(page);
  await page.getByRole('button', { name: ax.startStudyCapture }).click();
  await expect(page).toHaveURL(/\/check$/);
  await signOut(page);

  await signInAs(page, 'measurer-a@vt.test', /\/study\/reference/);
  await expect(page.getByRole('heading', { name: ax.tapeTitle })).toBeVisible();
  await clean(page);
  await typeReadings(page, code!, 1);
  await page.getByRole('button', { name: ax.submitReadings }).click();
  await expect(page.getByRole('status')).toContainText(`${code}, reading 1, measurer A`);
  await page.getByRole('button', { name: ax.enterAnother }).click();
  // A saved reading is locked: the same one again is refused.
  await typeReadings(page, code!, 1);
  await page.getByRole('button', { name: ax.submitReadings }).click();
  await expect(page.getByRole('alert')).toHaveText(ax.readingLocked);
});

test('the measurer screen never holds a system value', async ({ page }) => {
  // P001 has three capture sets in the seed. None of their values may reach this screen.
  const person = seed.participants.find(
    (p: { participant_code: string }) => p.participant_code === 'P001',
  );
  const client = seed.clients.find(
    (c: { client_code: string }) => c.client_code === person.client_code,
  );
  const system = new Set<string>();
  for (const profile of seed.profiles.filter(
    (p: { client_id: string }) => p.client_id === client.client_id,
  )) {
    for (const m of profile.measurements) {
      system.add((m.value_mm / 10).toFixed(1));
      system.add(String(m.value_mm));
    }
  }
  expect(system.size).toBeGreaterThan(0);
  for (const value of Object.values(TYPED)) expect(system.has(value)).toBe(false);

  const asked: string[] = [];
  page.on('request', (request) => asked.push(new URL(request.url()).pathname));
  await page.goto('/login');
  await signInAs(page, 'measurer-a@vt.test', /\/study\/reference/);
  await typeReadings(page, 'P001', 2);
  await page.getByRole('button', { name: ax.submitReadings }).click();
  // Measurer A entered both P001 readings in the seed, so this one is locked too.
  await expect(page.getByRole('alert')).toHaveText(ax.readingLocked);
  for (const site of SITES)
    await page
      .getByRole('button', { name: ax.showHow.replace('{site}', ax[`site_${site}`]) })
      .click();

  const shown = await page.evaluate(() => {
    const attributes = [...document.querySelectorAll('*')].flatMap((el) =>
      [...el.attributes].filter((a) => a.name !== 'value').map((a) => a.value),
    );
    return { text: document.body.innerText, attributes };
  });
  // Whole numbers only: a digit run inside an id or hash (".1c450ab") is not a value on screen.
  const whole = /(?<![\w.])\d+(?:\.\d)?(?![\w])/g;
  const numbers = [...`${shown.text} ${shown.attributes.join(' ')}`.matchAll(whole)].map(
    (m) => m[0],
  );
  expect(numbers.filter((n) => system.has(n))).toEqual([]);
  // The typed values are the only measurements in the inputs.
  for (const site of SITES)
    await expect(page.getByLabel(`${ax[`site_${site}`]} (cm)`)).toHaveValue(TYPED[site]);
  // And the page never asked for a profile, a client or the admin's readings.
  expect(
    asked.filter((path) => /\/api\/v1\/(profiles|clients|admin|study\/export)/.test(path)),
  ).toEqual([]);
});
