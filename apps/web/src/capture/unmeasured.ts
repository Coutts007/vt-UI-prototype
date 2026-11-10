// Which view, if any, measured nothing (D52). Kept apart from compute.ts so the review screen can
// ask without loading the rules and the derivation.
import type { LocalProfile } from '../db/storage';
import type { View } from '../vision/types';

type SiteCode = LocalProfile['measurements'][number]['site_code'];

/** Sites only the front view gives, and sites that need both views (derive.ts FRONT_SITES, SIDE_SITES). */
const FRONT_ONLY: SiteCode[] = ['stature', 'shoulder', 'sleeve', 'inleg'];
const BOTH_VIEWS: SiteCode[] = ['neck', 'chest', 'waist', 'hip'];

/**
 * The view whose capture measured nothing: every value that depends on it is empty. Null means both
 * views gave at least one value, so the client reviews what was measured and retakes by choice.
 */
export function unmeasuredView(profile: Pick<LocalProfile, 'measurements'>): View | null {
  const value = (site: SiteCode) => profile.measurements.find((m) => m.site_code === site)?.value_mm ?? null;
  if (FRONT_ONLY.every((site) => value(site) === null)) return 'front';
  if (value('outleg') === null && BOTH_VIEWS.every((site) => value(site) === null)) return 'side';
  return null;
}
