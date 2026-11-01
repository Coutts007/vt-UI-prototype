// The order form's rules, apart from its screen. Finished is always body plus ease (backend-spec 11.6).
import type { EaseSuggestion, OrderItemInput, Profile, SiteCode } from './common';

export type Measured = Profile['measurements'][number];
export const DEFAULT_EASE_MM = 0;

export function finishedMm(item: Pick<OrderItemInput, 'body_mm' | 'ease_mm'>): number | null {
  return item.body_mm === null ? null : item.body_mm + item.ease_mm;
}

export function buildItems(
  sites: SiteCode[],
  measurements: Measured[],
  suggested: EaseSuggestion[],
  kept: OrderItemInput[] = [],
): OrderItemInput[] {
  const present = sites.filter((site) => measurements.some((row) => row.site_code === site));
  return present.map((site) => {
    const earlier = kept.find((item) => item.site_code === site);
    if (earlier) return earlier;
    const row = measurements.find((m) => m.site_code === site)!;
    return {
      site_code: site,
      body_mm: row.value_mm,
      ease_mm: suggested.find((s) => s.site_code === site)?.ease_mm ?? DEFAULT_EASE_MM,
      overridden: false,
      flag_confirmed: false,
      pending_fitting: false,
    };
  });
}

/** The rows the tailor still has to answer: the same rule as the server's. */
export function unanswered(items: OrderItemInput[], measurements: Measured[]): SiteCode[] {
  return items
    .filter((item) => {
      const flag = measurements.find((m) => m.site_code === item.site_code)?.confidence_flag;
      if (flag === 'check') return !item.flag_confirmed && !item.overridden;
      if (flag === 'fail') return !item.overridden && !item.pending_fitting;
      return item.body_mm === null && !item.pending_fitting;
    })
    .map((item) => item.site_code);
}
