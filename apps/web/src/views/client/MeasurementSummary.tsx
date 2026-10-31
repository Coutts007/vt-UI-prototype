// The measurements as a client sees them, on Review and in My measurements. Read-only (9.10).
import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { components } from '@vt/contracts';
import { CAPTURE_CONFIG } from '../../capture/config';
import { FlagBadge } from '../../components/ui/FlagBadge';
import { Silhouette } from '../../components/ui/Silhouette';
import { BottomSheet } from '../../components/ui/feedback';
import type { LocalProfile } from '../../db/storage';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';

type SiteCode = components['schemas']['SiteCode'];

/** Which view each site comes from, so a retake can be aimed at the right one. */
export const SITE_VIEW: Record<SiteCode, 'front' | 'side' | 'both'> = {
  stature: 'front',
  shoulder: 'front',
  sleeve: 'front',
  inleg: 'front',
  outleg: 'side',
  neck: 'both',
  chest: 'both',
  waist: 'both',
  hip: 'both',
};
const ORDER: SiteCode[] = ['neck', 'chest', 'waist', 'hip', 'shoulder', 'sleeve', 'outleg', 'inleg'];

export const useSiteName = (profile: LocalProfile) => {
  const { t } = useI18n();
  return (code: SiteCode) =>
    t((code === 'chest' && profile.covariates.sex === 'female' ? 'site_bust' : `site_${code}`) as TranslationKey);
};

const cm = (mm: number) => `${(mm / 10).toFixed(1)} cm`;

export const MeasurementSummary: React.FC<{ profile: LocalProfile }> = ({ profile }) => {
  const { t } = useI18n();
  const name = useSiteName(profile);
  const [site, setSite] = useState<SiteCode | null>(null);
  const rows = ORDER.map((code) => profile.measurements.find((m) => m.site_code === code)).filter(
    (m): m is NonNullable<typeof m> => Boolean(m),
  );
  const flagged = rows.filter((m) => m.confidence_flag !== 'pass');
  const selected = site ? profile.measurements.find((m) => m.site_code === site) : null;
  const stature = profile.measurements.find((m) => m.site_code === 'stature');
  const entered = profile.covariates.height_mm_entered;
  const heightOff =
    !stature?.value_mm || (Math.abs(stature.value_mm - entered) / entered) * 100 > CAPTURE_CONFIG.scale.disagreePct;

  return (
    <div className="flex flex-col gap-5">
      <p data-testid="height-line" className="flex items-center gap-2 p-3 rounded-xl bg-white border border-[var(--vt-line)] text-sm">
        <span>
          {t('statureEnteredVsEst', {
            entered: (entered / 10).toFixed(0),
            est: stature?.value_mm ? (stature.value_mm / 10).toFixed(1) : '—',
          })}
        </span>
        {heightOff ? (
          <AlertTriangle aria-label={t('flagCheck')} className="w-4 h-4 text-amber-700 shrink-0" />
        ) : (
          <CheckCircle2 aria-label={t('flagPass')} className="w-4 h-4 text-emerald-700 shrink-0" />
        )}
      </p>

      {flagged.length > 0 && (
        <ul data-testid="flag-strip" className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-950 space-y-1">
          {flagged.map((m) => (
            <li key={m.site_code}>
              <strong>{name(m.site_code)}</strong>
              {' — '}
              {t(m.confidence_flag === 'fail' ? 'flagFail' : 'flagCheck')}
              {': '}
              {m.flag_reasons.map((r) => t(`reasonLong_${r}` as TranslationKey)).join(' ')}
            </li>
          ))}
        </ul>
      )}

      <Silhouette measurements={profile.measurements} sex={profile.covariates.sex} unit="cm" onSelectSite={setSite} />

      <section>
        <h2 className="font-bold mb-2">{t('reviewListTitle')}</h2>
        <ul data-testid="site-list" className="rounded-2xl border border-[var(--vt-line)] bg-white divide-y divide-[var(--vt-line)]">
          {rows.map((m) => (
            <li key={m.site_code}>
              <button type="button" onClick={() => setSite(m.site_code)} className="w-full p-3 flex items-center justify-between gap-3 text-left min-h-12 cursor-pointer">
                <span className="font-medium">{name(m.site_code)}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums font-semibold">{m.value_mm === null ? '—' : cm(m.value_mm)}</span>
                  <FlagBadge flag={m.confidence_flag} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <BottomSheet title={site ? name(site) : ''} open={Boolean(site && selected)} onClose={() => setSite(null)}>
        {site && selected && (
          <div className="space-y-2 text-sm">
            <p className="text-lg font-bold tabular-nums">{selected.value_mm === null ? t('flagFail') : cm(selected.value_mm)}</p>
            <p>{t(`siteHow_${site}` as TranslationKey)}</p>
            <p>{t(`siteFrom_${SITE_VIEW[site]}` as TranslationKey)}</p>
            {selected.flag_reasons.map((r) => (
              <p key={r} className="font-medium">
                {t(`reasonLong_${r}` as TranslationKey)}
              </p>
            ))}
          </div>
        )}
      </BottomSheet>
    </div>
  );
};
