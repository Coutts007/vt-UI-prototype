import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import { MeasurementProfile, SiteCode } from '../../types/api';
import { Silhouette } from '../../components/ui/Silhouette';
import { Button } from '../../components/ui/Button';
import { FlagBadge } from '../../components/ui/FlagBadge';
import { vtStorage } from '../../db/storage';
import { api } from '../../api/client';
import {
  Ruler,
  RotateCcw,
  Send,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Info,
  ChevronDown,
} from 'lucide-react';

interface ReviewViewProps {
  profile: MeasurementProfile;
  onRetake: (view: 'front' | 'side') => void;
  onSaved: (synced: boolean) => void;
  onDiscard: () => void;
}

export const ReviewView: React.FC<ReviewViewProps> = ({
  profile,
  onRetake,
  onSaved,
  onDiscard,
}) => {
  const { t } = useI18n();

  const [isSaving, setIsSaving] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [selectedSiteDetail, setSelectedSiteDetail] = useState<SiteCode | null>(null);

  const enteredHeightCm = (profile.covariates.height_mm_entered / 10).toFixed(1);
  const estimatedHeight = profile.measurements.find((m) => m.site_code === 'stature');
  const estimatedHeightCm = estimatedHeight?.value_mm
    ? (estimatedHeight.value_mm / 10).toFixed(1)
    : '—';

  const scaleDisagreed = profile.session.scale_disagreement_pct > 4.0;

  // Handle Save & Send
  const handleSaveAndSend = async () => {
    setIsSaving(true);
    let synced = false;

    try {
      // 1. Save locally in IndexedDB first (guarantees offline safety NFR-08)
      await vtStorage.saveProfile(profile);

      // 2. Attempt sync against API
      try {
        await api.submitProfile(profile);
        await vtStorage.updateProfileSyncStatus(profile.profile_id, 'synced');
        synced = true;
      } catch {
        // If offline or network error, remains 'pending'
        await vtStorage.updateProfileSyncStatus(profile.profile_id, 'pending');
        synced = false;
      }
    } catch {
      // ignore
    } finally {
      setIsSaving(false);
      onSaved(synced);
    }
  };

  const nonPassMeasurements = profile.measurements.filter(
    (m) => m.confidence_flag !== 'pass' && m.site_code !== 'stature'
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
            {t('reviewTitle')}
          </h1>
          <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mt-0.5">
            Client {profile.client_code} · Measured on this phone
          </p>
        </div>

        {/* Height Verification Strip */}
        <div className="flex items-center gap-2 p-3 rounded-xl bg-white border border-[var(--vt-line,#DDD5C8)] text-xs text-[var(--vt-ink,#1F1C18)] shadow-2xs">
          <Ruler className="w-4 h-4 text-[var(--vt-thread,#2E3A87)] shrink-0" />
          <span>
            Height entered: <strong>{enteredHeightCm} cm</strong> · Estimated:{' '}
            <strong>{estimatedHeightCm} cm</strong>
          </span>
          {scaleDisagreed ? (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          )}
        </div>
      </div>

      {/* Flag Warning Strip if non-pass flags exist */}
      {nonPassMeasurements.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 mb-6 flex flex-col gap-1.5 shadow-2xs">
          <div className="flex items-center gap-2 font-bold text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Measurements requiring fitting confirmation:</span>
          </div>
          {nonPassMeasurements.map((m) => (
            <div key={m.site_code} className="ml-6 list-item">
              <strong className="capitalize">{m.site_code}</strong>:{' '}
              {m.flag_reasons.join(', ') || 'Scale check notice'}. Your tailor will verify this during fitting.
            </div>
          ))}
        </div>
      )}

      {/* Interactive Silhouette with 8 leader lines */}
      <div className="mb-8">
        <Silhouette
          measurements={profile.measurements}
          sex={profile.covariates.sex}
          unit="cm"
          onSelectSite={(site) => setSelectedSiteDetail(site)}
        />
      </div>

      {/* Retake Views Row */}
      <div className="p-4 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white mb-8 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-2xs">
        <div>
          <span className="text-xs font-bold text-[var(--vt-ink,#1F1C18)] uppercase tracking-wider block">
            Retake an angle if needed
          </span>
          <span className="text-xs text-[var(--vt-ink-muted,#5C554C)]">
            A retake replaces only that photo and recalculates automatically.
          </span>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRetake('front')}
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            className="flex-1 sm:flex-initial"
          >
            {t('retakeFront')}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onRetake('side')}
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            className="flex-1 sm:flex-initial"
          >
            {t('retakeSide')}
          </Button>
        </div>
      </div>

      {/* Primary Actions: Save & Send / Discard */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <Button
          onClick={handleSaveAndSend}
          loading={isSaving}
          size="xl"
          icon={<Send className="w-5 h-5" />}
          className="w-full sm:flex-1"
        >
          {t('saveAndSend')}
        </Button>

        <Button
          variant="text"
          size="lg"
          onClick={() => setShowDiscardConfirm(true)}
          icon={<Trash2 className="w-4 h-4 text-rose-600" />}
          className="text-xs text-rose-700"
        >
          {t('discard')}
        </Button>
      </div>

      {/* Discard Confirmation Modal */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-[var(--vt-line,#DDD5C8)]">
            <h3 className="text-base font-bold text-[var(--vt-ink,#1F1C18)] mb-2">
              Discard measurements?
            </h3>
            <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] mb-6 leading-relaxed">
              {t('discardConfirm')}
            </p>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDiscardConfirm(false)}
                className="flex-1"
              >
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setShowDiscardConfirm(false);
                  onDiscard();
                }}
                className="flex-1"
              >
                {t('discard')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
