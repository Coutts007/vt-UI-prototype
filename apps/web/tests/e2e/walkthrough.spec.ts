// The steps of the backend-spec 15.6 walk-through that no other suite covers: a tailor registers
// and is approved, a code is sent as a deep link, and the audit log shows the day (M12).
// Runs through Caddy on the real API; `make walkthrough` keeps the screenshots for the report.
import { randomUUID } from 'node:crypto';
import { expect, Page, test } from '@playwright/test';
import { en } from '../../src/i18n/en';
import { adminEn as ax } from '../../src/views/admin/adminText';
import { tailorEn as tx } from '../../src/views/tailor/tailorText';
import { shot } from './shots';

test.use({ viewport: { width: 412, height: 915 } });

async function signIn(page: Page, email: string, password: string, home: RegExp) {
  await page.goto('/login');
  await page.getByLabel(tx.emailLabel).fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(home);
}

test('a tailor registers, is approved, sends a code and the audit log shows it', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const email = `walk-${randomUUID().slice(0, 8)}@vt.test`;
  const business = `Synthetic Tailors ${email.slice(5, 9)}`;
  const password = 'synthetic-pass-2026';

  // 1. Register, wait for approval, be approved.
  await page.goto('/register');
  await page.locator('#reg-business').fill(business);
  await page.locator('#reg-phone').fill('0700000000');
  await page.locator('#reg-area').fill('Synthetic area');
  await page.locator('#reg-email').fill(email);
  await page.locator('#reg-password').fill(password);
  await shot(page, '01a-register');
  await page.getByRole('button', { name: tx.registerSubmit }).click();
  await expect(page).toHaveURL(/\/register\/pending/);
  await shot(page, '01b-pending');
  await signIn(page, 'admin@vt.test', 'vt-demo-2026', /\/admin\/accounts/);
  const row = page.getByRole('listitem').filter({ hasText: business });
  await expect(row).toBeVisible();
  await shot(page, '01c-admin-approves');
  await row.getByRole('button', { name: ax.approve, exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: en.hdrSignOut }).first().click();
  await expect(page).toHaveURL(/\/login/);

  // 2. Issue a code; the deep link opens the client app on that code.
  await signIn(page, email, password, /\/t\//);
  await page.goto('/t/clients/new');
  const issued = page.waitForResponse(
    (reply) => reply.request().method() === 'POST' && reply.url().endsWith('/api/v1/clients'),
  );
  await page.getByRole('button', { name: tx.codeSubmit }).click();
  const { client_code: code, deep_link: link } = await (await issued).json();
  await expect(page.getByTestId('issued-code')).toHaveText(code);
  await shot(page, '02a-code-and-whatsapp');

  // 5. The tailor's audit log names each step.
  await page.goto('/t/audit');
  await expect(page.getByRole('heading', { name: tx.auditTitle })).toBeVisible();
  await expect(page.locator('#content')).toContainText(code);
  await shot(page, '05a-tailor-audit');

  await page.goto(link);
  await expect(page.locator('#content')).toContainText(code);
  await shot(page, '02b-deep-link-opens');

  // 5 and 7: the administrator's audit log and deletion requests.
  await signIn(page, 'admin@vt.test', 'vt-demo-2026', /\/admin\/accounts/);
  await page.goto('/admin/audit');
  await expect(page.getByRole('heading', { name: ax.auditTitle })).toBeVisible();
  await shot(page, '05b-admin-audit');
  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: ax.deletionsTitle })).toBeVisible();
  await shot(page, '07-deletion-requests');
});
