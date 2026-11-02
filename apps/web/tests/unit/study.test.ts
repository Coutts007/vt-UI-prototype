// The study screens' small rules (M11): tape parsing, plausible ranges, the next participant code,
// and that both dictionaries hold every admin and study word.
import { describe, expect, it } from 'vitest';
import { nextParticipantCode } from '../../src/views/admin/AdminStudyParticipantsView';
import { TAPE_SITES } from '../../src/views/admin/adminCommon';
import { adminEn, adminSw } from '../../src/views/admin/adminText';
import { TAPE_RANGE, tapeMm } from '../../src/views/study/StudyReferenceTapeView';

describe('tape entry', () => {
  it('takes centimetres to 0.1 cm and returns millimetres', () => {
    expect(tapeMm('86.4')).toBe(864);
    expect(tapeMm('170')).toBe(1700);
    expect(tapeMm(' 38,9 ')).toBe(389);
  });

  it('refuses anything that is not a tape reading', () => {
    for (const bad of ['', '8', '86.45', 'abc', '-80', '1700.0', '86.'])
      expect(tapeMm(bad)).toBeNull();
  });

  it('has a range and both instructions for each of the nine Appendix C sites', () => {
    expect(TAPE_SITES).toHaveLength(9);
    for (const site of TAPE_SITES) {
      const [low, high] = TAPE_RANGE[site];
      expect(low).toBeLessThan(high);
      expect(adminEn[`how_${site}`]).toBeTruthy();
      expect(adminSw[`site_${site}`]).toBeTruthy();
    }
  });
});

describe('enrolment', () => {
  it('suggests the code after the highest one used', () => {
    expect(nextParticipantCode([])).toBe('P001');
    expect(nextParticipantCode([{ participant_code: 'P003' }, { participant_code: 'P010' }])).toBe(
      'P011',
    );
    expect(nextParticipantCode([{ participant_code: 'P999' }])).toBe('P999');
  });
});

describe('admin dictionary', () => {
  it('has a Kiswahili draft for every English key', () => {
    expect(Object.keys(adminSw).sort()).toEqual(Object.keys(adminEn).sort());
    for (const [key, text] of Object.entries(adminSw)) expect(text, key).not.toBe('');
  });

  it('keeps the same placeholders in both languages', () => {
    const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(adminEn) as (keyof typeof adminEn)[]) {
      expect(holes(adminSw[key]), key).toEqual(holes(adminEn[key]));
    }
  });
});
