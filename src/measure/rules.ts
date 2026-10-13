import { SiteCode } from '../types/api';

export const RULES_VERSION = '0.1-uncalibrated';
export const ACROMION_OFFSET_MM = 0; // Calibration offset

export const CHEST_LEVEL: Record<'female' | 'male' | 'unspecified', number> = {
  female: 0.28,
  male: 0.25,
  unspecified: 0.26,
};

export const WAIST_LEVEL_FRACTION = 0.60;

// Plausible ranges in mm
export const PLAUSIBLE_RANGES_MM: Record<SiteCode, { min: number; max: number }> = {
  stature: { min: 1200, max: 2200 },
  shoulder: { min: 280, max: 620 },
  chest: { min: 650, max: 1750 },
  waist: { min: 450, max: 1800 },
  hip: { min: 700, max: 1900 },
  sleeve: { min: 400, max: 950 },
  outleg: { min: 700, max: 1400 },
  inleg: { min: 550, max: 1100 },
  neck: { min: 280, max: 580 },
};

export const CORRECTION_FACTORS: Record<string, number> = {
  chest: 1.0,
  waist: 1.0,
  hip: 1.0,
  neck: 1.0,
};

/**
 * Ramanujan approximation for ellipse perimeter:
 * P = π [ 3(a + b) - √((3a + b)(a + 3b)) ]
 * where a = half-width, b = half-depth
 */
export function ramanujanEllipsePerimeter(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  const term1 = 3 * (a + b);
  const term2 = Math.sqrt((3 * a + b) * (a + 3 * b));
  return Math.PI * (term1 - term2);
}
