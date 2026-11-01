import { expect, it } from 'vitest';
import { en } from '../../src/i18n/en';
import { sw } from '../../src/i18n/sw';
import { panelEn, PanelKey, panelSw } from '../../src/views/tailor/directoryPanelText';

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

it('the tailor panel has both languages, with matching placeholders', () => {
  const slots = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
  expect(Object.keys(panelSw).sort()).toEqual(Object.keys(panelEn).sort());
  for (const key of Object.keys(panelEn) as PanelKey[]) {
    expect(panelSw[key], key).not.toBe('');
    expect(slots(panelSw[key]), key).toEqual(slots(panelEn[key]));
  }
});

it('a measured client gets its own warning in both languages', () => {
  expect(panelEn.directoryClientMeasuredConfirm).not.toBe(panelEn.directoryClientConfirm);
  expect(panelSw.directoryClientMeasuredConfirm).not.toBe(panelSw.directoryClientConfirm);
});
