import { expect, it } from 'vitest';
import { strategyFor } from '../../src/sw/strategy';

const origin = 'https://vt.test';

it.each([
  ['GET', `${origin}/api/v1/clients`, 'cors'],
  ['GET', `${origin}/api/v1/me`, 'navigate'],
  ['POST', `${origin}/api/v1/profiles`, 'cors'],
  ['POST', `${origin}/assets/a.js`, 'cors'],
  ['GET', 'https://elsewhere.test/assets/a.js', 'cors'],
])('never caches %s %s', (method, url, mode) => {
  expect(strategyFor({ method, url, mode }, origin)).toBe('network-only');
});

it('caches built assets and falls back to the shell for pages', () => {
  expect(strategyFor({ method: 'GET', url: `${origin}/assets/a.js`, mode: 'cors' }, origin)).toBe(
    'cache-first',
  );
  expect(strategyFor({ method: 'GET', url: `${origin}/t/orders`, mode: 'navigate' }, origin)).toBe(
    'network-first-shell',
  );
});
