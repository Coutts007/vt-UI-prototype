import { describe, expect, it } from 'vitest';
import fixture from '../../../../packages/contracts/share-text.json';
import { buildShareText, formatLength, type ShareInput } from '../../mocks/shareText';

describe('share text (backend-spec 13)', () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))('matches the shared fixture: %s', (_, c) => {
    expect(buildShareText(c.input as ShareInput)).toBe(c.expected);
  });

  it.each([
    [0, 'cm', '0.0 cm'],
    [985, 'cm', '98.5 cm'],
    [3, 'in', '1/8 in'],
    [6, 'in', '1/4 in'],
    [13, 'in', '1/2 in'],
    [251, 'in', '9 7/8 in'],
    [256, 'in', '10 1/8 in'],
    [1016, 'in', '40 in'],
  ] as const)('formats %i mm in %s as %s', (mm, unit, text) => {
    expect(formatLength(mm, unit)).toBe(text);
  });

  it('agrees with the API rounding for every length up to 3 m', () => {
    for (let mm = 0; mm <= 3000; mm += 1) {
      const eighths = Math.round((mm * 8) / 25.4);
      const whole = Math.floor(eighths / 8);
      expect(formatLength(mm, 'in').startsWith(eighths % 8 === 0 ? `${whole} in` : whole === 0 ? '' : `${whole} `)).toBe(true);
    }
  });

  it('stays under the WhatsApp link limit', () => {
    const items = fixture.sites.map((site_code) => ({ site_code, body_mm: 9999, flag: 'check' as const, pending_fitting: false }));
    for (const locale of ['en', 'sw'] as const) {
      const text = buildShareText({ ...(fixture.cases[0].input as ShareInput), locale, name: 'N'.repeat(64), items });
      expect(text.length).toBeLessThanOrEqual(fixture.max_length);
    }
  });
});
