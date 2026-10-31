import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { RotateCcw, Send, Trash2 } from 'lucide-react';
import { captureSession } from '../../capture/session';
import { Button } from '../../components/ui/Button';
import { ProgressSteps } from '../../components/ui/data';
import { Banner, Dialog } from '../../components/ui/feedback';
import { vtStorage } from '../../db/storage';
import { useI18n } from '../../i18n';
import { MeasurementSummary, SITE_VIEW, useSiteName } from './MeasurementSummary';

export const ReviewView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const { t } = useI18n();
  const machine = useSyncExternalStore(captureSession.subscribe, captureSession.getMachine);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { profile } = captureSession;
  const usable = profile && ['review', 'error'].includes(machine.state.name);

  useEffect(() => {
    if (!usable) onNavigate('/');
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!usable || !profile) return null;

  const failedSave = machine.state.name === 'error';
  const worst = profile.measurements.find((m) => m.confidence_flag === 'fail') ??
    profile.measurements.find((m) => m.confidence_flag === 'check');
  const worstView = worst ? SITE_VIEW[worst.site_code] : 'both';
  const scaleView = machine.context.scaleDisagree;
  const highlight = scaleView ?? (worstView === 'both' ? null : worstView);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-5">
      <ProgressSteps current={5} />
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t('reviewTitle')}</h1>
      <p className="text-[var(--vt-ink-muted)]">{t('reviewSubtitle')}</p>
      {scaleView && (
        <Banner tone="warn">
          {t('scaleBanner', { view: t(scaleView === 'front' ? 'viewFront' : 'viewSide') })}
        </Banner>
      )}
      {failedSave && <Banner tone="warn">{t('saveFailed')}</Banner>}

      <MeasurementSummary profile={profile} />

      <RetakeRow
        highlight={highlight}
        reason={!scaleView && worst && highlight ? { site: worst.site_code } : null}
        onRetake={(view) => {
          captureSession.send({ type: 'RETAKE', view });
          captureSession.send({ type: 'BEGIN_RETAKE' });
          onNavigate(`/capture/${view}`);
        }}
      />

      <div className="flex flex-col sm:flex-row items-center gap-3">
        <Button
          size="xl"
          loading={saving}
          icon={<Send aria-hidden="true" className="w-5 h-5" />}
          className="w-full sm:flex-1"
          onClick={async () => {
            setSaving(true);
            if (failedSave) captureSession.send({ type: 'RETRY' });
            try {
              const version = await vtStorage.nextVersion(profile.client_code);
              // Written before "Saved" is shown (NFR-08).
              await vtStorage.saveProfile({ ...profile, version });
              captureSession.savedProfileId = profile.profile_id;
              captureSession.send({ type: 'SAVE' });
              const { syncNow } = await import('../../db/sync');
              void syncNow();
              onNavigate('/saved');
            } catch {
              captureSession.send({ type: 'SAVE_FAILED' });
            } finally {
              setSaving(false);
            }
          }}
        >
          {t('saveAndSend')}
        </Button>
        <Button variant="text" size="lg" icon={<Trash2 aria-hidden="true" className="w-4 h-4" />} onClick={() => setConfirm(true)}>
          {t('discard')}
        </Button>
      </div>
      <p className="text-sm text-center text-[var(--vt-ink-muted)]">{t('reviewFooter')}</p>

      <Dialog title={t('discard')} open={confirm} onClose={() => setConfirm(false)}>
        <p className="mb-4">{t('discardConfirm')}</p>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => setConfirm(false)}>
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => {
              captureSession.send({ type: 'DISCARD' });
              captureSession.clear();
              onNavigate('/');
            }}
          >
            {t('discard')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
};

const RetakeRow: React.FC<{
  highlight: 'front' | 'side' | null;
  reason: { site: Parameters<ReturnType<typeof useSiteName>>[0] } | null;
  onRetake: (view: 'front' | 'side') => void;
}> = ({ highlight, reason, onRetake }) => {
  const { t } = useI18n();
  const name = useSiteName(captureSession.profile!);
  return (
    <section className="p-4 rounded-2xl border border-[var(--vt-line)] bg-white flex flex-col gap-3">
      <p className="text-sm">{t('retakeHint')}</p>
      {reason && highlight && (
        <p data-testid="retake-reason" className="text-sm font-semibold">
          {t('retakeReason', { site: name(reason.site), view: t(highlight === 'front' ? 'viewFront' : 'viewSide') })}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        {(['front', 'side'] as const).map((view) => (
          <Button
            key={view}
            variant={highlight === view ? 'primary' : 'outline'}
            icon={<RotateCcw aria-hidden="true" className="w-4 h-4" />}
            onClick={() => onRetake(view)}
          >
            {t(view === 'front' ? 'retakeFront' : 'retakeSide')}
          </Button>
        ))}
      </div>
    </section>
  );
};
