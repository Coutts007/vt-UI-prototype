// The order form's rules and the small helpers behind the tailor screens (M9).
import { describe, expect, it } from 'vitest';
import { addDays, formatLength, nairobiToday, toMm, toUnit } from '../../src/views/tailor/common';
import { buildItems, finishedMm, Measured, unanswered } from '../../src/views/tailor/orderForm';
import { passwordStrength } from '../../src/views/auth/RegisterView';

const row = (site_code: string, confidence_flag: string, value_mm = 900) =>
  ({ site_code, confidence_flag, value_mm, flag_reasons: [] }) as unknown as Measured;

describe('finished size', () => {
  it('is body plus ease', () => expect(finishedMm({ body_mm: 900, ease_mm: 60 })).toBe(960));
  it('is unknown while the body is unknown', () =>
    expect(finishedMm({ body_mm: null, ease_mm: 60 })).toBeNull());
});

describe('building the rows', () => {
  const measured = [row('chest', 'pass'), row('waist', 'check')];
  it('uses the suggested ease, and leaves out a site with no measurement', () => {
    const items = buildItems(['chest', 'waist', 'hip'], measured, [
      { site_code: 'chest', ease_mm: 80, source: 'history', n: 3 },
    ] as never);
    expect(items.map((i) => [i.site_code, i.ease_mm])).toEqual([
      ['chest', 80],
      ['waist', 0],
    ]);
  });
  it('keeps what the tailor already typed', () => {
    const [first] = buildItems(['chest'], measured, []);
    const edited = { ...first!, ease_mm: 25, overridden: true };
    expect(buildItems(['chest'], measured, [], [edited])[0]).toBe(edited);
  });
});

describe('rows still to answer', () => {
  const base = { ease_mm: 0, overridden: false, flag_confirmed: false, pending_fitting: false };
  const measured = [row('chest', 'pass'), row('waist', 'check'), row('hip', 'fail')];
  const items = (patch = {}) =>
    (['chest', 'waist', 'hip'] as const).map((site_code) => ({
      ...base,
      site_code,
      body_mm: 900,
      ...patch,
    }));
  it('names a check and a fail, never a pass', () =>
    expect(unanswered(items(), measured)).toEqual(['waist', 'hip']));
  it('a confirmation answers a check, not a fail', () =>
    expect(unanswered(items({ flag_confirmed: true }), measured)).toEqual(['hip']));
  it('measuring at the fitting answers a fail, not a check', () =>
    expect(unanswered(items({ pending_fitting: true }), measured)).toEqual(['waist']));
  it('an override answers both', () =>
    expect(unanswered(items({ overridden: true }), measured)).toEqual([]));
});

describe('units and dates', () => {
  it('round trips centimetres and inches', () => {
    expect(toMm(toUnit(905, 'cm'), 'cm')).toBe(905);
    expect(Math.abs(toMm(toUnit(905, 'in'), 'in') - 905)).toBeLessThanOrEqual(2);
  });
  it('shows no number for a missing length', () => {
    expect(formatLength(null, 'cm')).not.toMatch(/\d/);
  });
  it('today is the day in Nairobi, not on the phone clock', () => {
    expect(nairobiToday(new Date('2026-11-02T21:30:00Z'))).toBe('2026-11-03');
    expect(nairobiToday(new Date('2026-11-02T20:59:00Z'))).toBe('2026-11-02');
  });
  it('adds days across a month', () => expect(addDays('2026-11-30', 1)).toBe('2026-12-01'));
});

describe('password strength', () => {
  it.each([
    ['short', 'passwordWeak'],
    ['ten-letters', 'passwordFair'],
    ['a-rather-long-phrase', 'passwordStrong'],
  ])('%s', (text, want) => expect(passwordStrength(text)).toBe(want));
});
