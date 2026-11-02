import React from 'react';
import { Plus } from 'lucide-react';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { FlagBadge } from '../../components/ui/FlagBadge';
import { Banner } from '../../components/ui/feedback';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';
import { BackLink, Card, currentUnit, formatLength, hintClass, Loading, Title, useDates, useLoad } from './common';
import { useTailorText } from './tailorText';

export const ProfileDetailView: React.FC<{
  clientId: string;
  profileId: string;
  onNavigate: (path: string) => void;
}> = ({ clientId, profileId, onNavigate }) => {
  const tx = useTailorText();
  const { t } = useI18n();
  const { time } = useDates();
  const unit = currentUnit();
  // Each opening is recorded by the server, as backend-spec 8 asks.
  const { data, failed, reload } = useLoad(
    () => apiClient.get('/profiles/{profile_id}', { path: { profile_id: profileId } }),
    [profileId],
  );
  if (!data) return <Loading failed={failed} onRetry={reload} />;
  const flagged = data.measurements.some((row) => row.confidence_flag !== 'pass');
  const session = data.session;
  const checks = [
    [tx('checkFront'), session.front_checks],
    [tx('checkSide'), session.side_checks],
  ] as const;

  return (
    <div className="flex flex-col gap-4 max-w-4xl mx-auto">
      <BackLink onClick={() => onNavigate(`/t/clients/${clientId}`)} label={tx('back')} />
      <Title>{tx('profileTitle')}</Title>
      <p className={hintClass}>
        {tx('profileSummary', {
          date: time(data.captured_at),
          version: data.version,
          mode: tx(session.capture_mode === 'self' ? 'modeSelf' : 'modeAssisted'),
        })}
        <br />
        {tx('profileDevice', { device: session.device_model, model: session.model_variant, rules: data.rules_version })}
      </p>
      {flagged && <Banner tone="warn">{tx('confirmAtFitting')}</Banner>}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th scope="col" className="py-2 pr-2">{tx('siteColumn')}</th>
                <th scope="col" className="py-2 pr-2">{tx('valueColumn')}</th>
                <th scope="col" className="py-2 pr-2">{tx('flagColumn')}</th>
                <th scope="col" className="py-2">{tx('methodColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {data.measurements.map((row) => (
                <tr key={row.site_code} className="border-t border-[var(--vt-line)]">
                  <td className="py-2 pr-2">
                    {t(`site_${row.site_code}` as TranslationKey)}
                    <span className={`block ${hintClass}`}>{t(`iso_${row.site_code}` as TranslationKey)}</span>
                  </td>
                  <td className="py-2 pr-2 font-semibold whitespace-nowrap">
                    {row.value_mm === null ? tx('notMeasured') : formatLength(row.value_mm, unit)}
                  </td>
                  <td className="py-2 pr-2">
                    <FlagBadge flag={row.confidence_flag} reasons={row.flag_reasons} showReasonText />
                  </td>
                  <td className="py-2">{tx(row.method === 'auto' ? 'methodAuto' : 'methodOverride')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {data.server_checks.length > 0 && (
        <Card title={tx('serverChecks')}>
          <ul className="text-sm list-disc pl-5">
            {data.server_checks.map((row, index) => (
              <li key={`${row.kind}-${row.site_code ?? index}`}>
                {row.kind.replaceAll('_', ' ')}
                {row.site_code ? `: ${t(`site_${row.site_code}` as TranslationKey)}` : ''}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title={tx('captureChecks')}>
        {checks.map(([label, values]) => (
          <p key={label} className="text-sm">
            <strong>{label}: </strong>
            {Object.entries(values)
              .map(([name, state]) => `${name} ${state}`)
              .join(' · ')}
          </p>
        ))}
        <p className={hintClass}>
          {tx('scaleDisagreement', { value: session.scale_disagreement_pct })} · {tx('retakes', { count: session.retake_count })}
        </p>
      </Card>
      <Button icon={<Plus aria-hidden="true" className="w-4 h-4" />} onClick={() => onNavigate(`/t/orders/new?profileId=${profileId}`)}>
        {tx('newOrderFromThis')}
      </Button>
    </div>
  );
};
