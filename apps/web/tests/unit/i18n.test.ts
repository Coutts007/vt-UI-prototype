import { expect, it } from 'vitest';
import { en } from '../../src/i18n/en';
import { sw } from '../../src/i18n/sw';

it('both languages have the same keys', () => {
  expect(Object.keys(sw).sort()).toEqual(Object.keys(en).sort());
});

it('no string is empty', () => {
  for (const [key, value] of [...Object.entries(en), ...Object.entries(sw)]) {
    expect(value, key).not.toBe('');
  }
});

it('placeholders match between languages', () => {
  const slots = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    expect(slots(sw[key]), key).toEqual(slots(en[key]));
  }
});
