// The rules artifact the app is built with (A2). Never hand-copy a value from it.
import rulesFile from '../../../../packages/rules/rules-0.1-uncalibrated.json';
import type { SiteCode } from '../types/api';

export const RULES_VERSION = rulesFile.rules_version;

export const PLAUSIBLE_RANGES_MM = Object.fromEntries(
  Object.entries(rulesFile.plausible_mm).map(([site, [min, max]]) => [site, { min, max }]),
) as Record<SiteCode, { min: number; max: number }>;
