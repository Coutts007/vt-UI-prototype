// The stack as deployed: production build, production Caddyfile, rate limits on (M12).
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { API_CSP, expectSecurityHeaders, recordViolations } from '../e2e/csp-support';

test('the production build carries the headers and runs with nothing blocked', async ({
  page,
  request,
}) => {
  expectSecurityHeaders(await request.get('/'));
  expectSecurityHeaders(await request.get('/api/v1/health'), API_CSP);
  const violations = await recordViolations(page);
  await page.goto('/');
  await expect(page.locator('#content')).toBeVisible();
  await page.goto('/login');
  await expect(page.locator('input[type=password]')).toBeVisible();
  expect(await violations()).toEqual([]);
  // No development screen ships.
  await page.goto('/dev/capture-tuning');
  await expect(page.getByTestId('real-switch')).toHaveCount(0);
});

test('sign-in is limited per address behind Caddy, and a forged X-Forwarded-For does not reset it', async ({
  request,
}) => {
  const statuses: number[] = [];
  let retryAfter: string | undefined;
  for (let i = 0; i < 22; i++) {
    // A new address claimed each time, and a new email so the per-account lock plays no part.
    const reply = await request.post('/api/v1/auth/login', {
      headers: { 'X-Forwarded-For': `203.0.113.${i + 1}` },
      data: { email: `nobody-${randomUUID()}@example.org`, password: 'not-the-password-1' },
    });
    statuses.push(reply.status());
    if (reply.status() === 429) retryAfter ??= reply.headers()['retry-after'];
  }
  expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true);
  expect(statuses.slice(20)).toEqual([429, 429]);
  expect(Number(retryAfter)).toBeGreaterThan(0);
});

test('the API refuses an image body at the edge of the stack too', async ({ request }) => {
  const reply = await request.post('/api/v1/deletion-requests', {
    data: { client_code: 'AB1001', reason: 'delete', note: 'data:image/png;base64,iVBORw0KGgo=' },
  });
  expect(reply.status()).toBe(422);
  expect((await reply.json()).code).toBe('image_content_rejected');
});
