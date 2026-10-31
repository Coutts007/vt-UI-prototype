import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ROUTES } from '../../src/router/routes';

it('every route has a screen', () => {
  const source = readFileSync('src/router/views.tsx', 'utf8');
  for (const route of ROUTES)
    expect(source, route.pattern).toContain(
      route.pattern.startsWith('/dev') ? `VIEWS['${route.pattern}']` : `'${route.pattern}':`,
    );
});
