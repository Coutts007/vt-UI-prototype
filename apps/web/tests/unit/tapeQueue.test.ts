// Review of PR #14: a queued reading is dropped on reading_locked only if it is exactly the saved one.
import { describe, expect, it, vi } from 'vitest';

const saved = vi.hoisted(() => ({
  rows: [] as { reading_no: number; site_code: string; value_mm: number }[],
}));
vi.mock('../../src/api/instance', () => ({
  apiClient: { get: vi.fn(async () => saved.rows) },
}));

import { sameAsSaved } from '../../src/views/study/StudyReferenceTapeView';
import { TAPE_SITES } from '../../src/views/admin/adminCommon';

const values = Object.fromEntries(TAPE_SITES.map((site, i) => [site, 400 + i])) as never;
const queued = {
  participant_code: 'P001',
  reading_no: 1 as const,
  values,
  taken_at: '',
  measurer_code: 'A',
};

describe('a locked reading in the queue', () => {
  it('is the same as the saved one only on an exact match of all nine sites', async () => {
    saved.rows = TAPE_SITES.map((site, i) => ({
      reading_no: 1,
      site_code: site,
      value_mm: 400 + i,
    }));
    expect(await sameAsSaved(queued)).toBe(true);
    saved.rows = saved.rows.map((row, i) =>
      i === 3 ? { ...row, value_mm: row.value_mm + 1 } : row,
    );
    expect(await sameAsSaved(queued)).toBe(false);
  });

  it('is kept when the saved reading is another number or incomplete', async () => {
    saved.rows = TAPE_SITES.map((site, i) => ({
      reading_no: 2,
      site_code: site,
      value_mm: 400 + i,
    }));
    expect(await sameAsSaved(queued)).toBe(false);
    saved.rows = [];
    expect(await sameAsSaved(queued)).toBe(false);
  });
});
