// What Caddy must send (M12, frontend-spec 19), and a recorder for anything the CSP blocks.
import { expect, type APIResponse, type Page } from '@playwright/test';

export const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

/** The API's own policy: it serves JSON and files only, so nothing may load from it. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

export function expectSecurityHeaders(reply: APIResponse, csp = CSP): void {
  const headers = reply.headers();
  expect(headers['content-security-policy']).toBe(csp);
  expect(headers['strict-transport-security']).toBe('max-age=31536000');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['permissions-policy']).toContain('camera=(self)');
  expect(headers['permissions-policy']).toContain('microphone=()');
  expect(headers.server).toBeUndefined();
}

/** Collects CSP violations in the page and CSP errors on the console; call before navigating. */
export async function recordViolations(page: Page): Promise<() => Promise<string[]>> {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  return async () => [
    ...consoleErrors,
    ...(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])),
  ];
}
