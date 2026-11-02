import { describe, expect, it } from 'vitest';
import { defaultProfileId } from '../../src/views/tailor/common';

const row = (profile_id: string, claim_round: number) => ({ profile_id, claim_round });

describe('defaultProfileId', () => {
  it('takes the newest row of a single claim', () => {
    expect(defaultProfileId([row('a', 0), row('b', 0)], '')).toBe('a');
  });
  it('leaves the choice to the tailor across claims', () => {
    expect(defaultProfileId([row('a', 1), row('b', 0)], '')).toBe('');
  });
  it('keeps a row already chosen', () => {
    expect(defaultProfileId([row('a', 1), row('b', 0)], 'b')).toBe('b');
  });
  it('has nothing to offer on an empty list', () => {
    expect(defaultProfileId([], '')).toBe('');
  });
});
