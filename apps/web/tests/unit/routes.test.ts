import { describe, expect, it } from 'vitest';
import { guard, homeFor, matchRoute, safeNext } from '../../src/router/routes';

const context = { studyMode: true, dev: false };
const tailor = { role: 'tailor' as const, status: 'active' };

describe('matchRoute', () => {
  it('prefers exact segments over params', () => {
    expect(matchRoute('/t/clients/new')?.route.pattern).toBe('/t/clients/new');
    expect(matchRoute('/t/orders/new')?.route.pattern).toBe('/t/orders/new');
  });
  it('reads params', () => {
    const match = matchRoute('/t/clients/abc/profiles/def');
    expect(match?.params).toEqual({ clientId: 'abc', profileId: 'def' });
  });
  it('returns null for unknown paths', () => {
    expect(matchRoute('/nope')).toBeNull();
    expect(matchRoute('/tailors')).toBeNull();
  });
});

describe('guard', () => {
  const at = (path: string) => matchRoute(path);
  it('sends a signed-out person to login', () => {
    expect(guard(at('/t/orders'), null, context)).toBe('login');
  });
  it('shows 403 for the wrong role and never a blank page', () => {
    expect(guard(at('/admin/accounts'), tailor, context)).toBe('forbidden');
    expect(guard(at('/study/reference'), tailor, context)).toBe('forbidden');
  });
  it('holds pending and disabled accounts', () => {
    expect(guard(at('/t/orders'), { role: 'tailor', status: 'pending' }, context)).toBe('pending');
    expect(guard(at('/t/orders'), { role: 'tailor', status: 'disabled' }, context)).toBe(
      'disabled',
    );
    expect(guard(at('/t/orders'), { role: 'tailor', status: 'rejected' }, context)).toBe(
      'disabled',
    );
  });
  it('hides study routes when study mode is off', () => {
    const measurer = { role: 'measurer' as const, status: 'active' };
    expect(guard(at('/study/reference'), measurer, context)).toBe('ok');
    expect(guard(at('/study/reference'), measurer, { ...context, studyMode: false })).toBe(
      'not-found',
    );
  });
  it('hides dev routes outside dev builds', () => {
    expect(guard(at('/dev/ui'), null, context)).toBe('not-found');
    expect(guard(at('/dev/ui'), null, { ...context, dev: true })).toBe('ok');
  });
  it('leaves client routes open', () => {
    expect(guard(at('/capture/front'), null, context)).toBe('ok');
  });
  it('routes each role home', () => {
    expect([homeFor('tailor'), homeFor('admin'), homeFor('measurer')]).toEqual([
      '/t/orders',
      '/admin/accounts',
      '/study/reference',
    ]);
  });
});

it('treats a malformed address as not found', () => {
  expect(matchRoute('/me/%E0%A4%A')).toBeNull();
});

it('blocks an unknown account status', () => {
  expect(guard(matchRoute('/t/orders'), { role: 'tailor', status: 'odd' }, context)).toBe(
    'disabled',
  );
});

describe('safeNext', () => {
  const origin = 'https://vt.test';
  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', '/x/..//evil.com', '', null])(
    'refuses %s',
    (next) => {
      expect(safeNext(next, origin)).toBeNull();
    },
  );
  it('keeps the query', () => {
    expect(safeNext('/t/orders/new?profileId=a', origin)).toBe('/t/orders/new?profileId=a');
  });
});
