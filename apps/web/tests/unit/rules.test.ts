import { describe, expect, it } from 'vitest';
import { ramanujanEllipsePerimeter } from '../../src/measure/rules.ts';

describe('ramanujanEllipsePerimeter', () => {
  it('equals the circumference for a circle', () => {
    expect(ramanujanEllipsePerimeter(100, 100)).toBeCloseTo(2 * Math.PI * 100, 6);
  });

  it('is zero for a degenerate axis', () => {
    expect(ramanujanEllipsePerimeter(0, 100)).toBe(0);
  });
});
