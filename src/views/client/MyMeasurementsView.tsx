import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n';
import { MeasurementProfile } from '../../types/api';
import { vtStorage } from '../../db/storage';
import { Silhouette } from '../../components/ui/Silhouette';
import { Button } from '../../components/ui/Button';
import { SyncBadge } from '../../components/ui/SyncBadge';
import { FlagBadge } from '../../components/ui/FlagBadge';
import {
  Layers,
  Ruler,
  Trash2,
  AlertTriangle,
  ArrowRight,
  ShieldAlert,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';

interface MyMeasurementsViewProps {
  onNavigate: (path: string) => void;
  selectedProfileId?: string;
}

export const MyMeasurementsView: React.FC<MyMeasurementsViewProps> = ({
  onNavigate,
  selectedProfileId,
}) => {
  const { t } = useI18n();

  const [profiles, setProfiles] = useState<MeasurementProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<MeasurementProfile | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    const list = await vtStorage.getProfiles();
    setProfiles(list);
    if (selectedProfileId) {
      const found = list.find((p) => p.profile_id === selectedProfileId);
      if (found) setActiveProfile(found);
    } else if (list.length > 0 && !activeProfile) {
      setActiveProfile(list[0]);
    }
  };

  const handleDeleteProfile = async () => {
    if (!activeProfile) return;
    await vtStorage.deleteProfile(activeProfile.profile_id);
    setShowDeleteModal(false);
    setActionNotice('Profile deleted from this phone and queued for server removal.');
    setActiveProfile(null);
    loadProfiles();
  };

  const handleWithdrawConsent = async () => {
    if (!activeProfile) return;
    activeProfile.consent.withdrawn_at = new Date().toISOString();
    await vtStorage.saveProfile(activeProfile);
    await vtStorage.deleteProfile(activeProfile.profile_id);
    setShowWithdrawModal(false);
    setActionNotice(t('withdrawnSuccess'));
    setActiveProfile(null);
    loadProfiles();
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      {/* Back button if viewing specific profile */}
      {activeProfile && (
        <button
          onClick={() => setActiveProfile(null)}
          className="text-xs text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)] flex items-center gap-1 mb-4 cursor-pointer font-medium"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>All profiles</span>
        </button>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
            {t('myMeasurementsTitle')}
          </h1>
          <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mt-0.5">
            Profiles stored securely on this phone under your client code
          </p>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={() => onNavigate('/start')}
          icon={<Ruler className="w-4 h-4" />}
        >
          {t('measureNow')}
        </Button>
      </div>

      {actionNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium mb-6">
          {actionNotice}
        </div>
      )}

      {profiles.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white">
          <Layers className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h2 className="text-base font-bold text-[var(--vt-ink,#1F1C18)] mb-1">
            {t('noMeasurementsYet')}
          </h2>
          <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] mb-6 max-w-sm mx-auto">
            You have not measured your tailoring dimensions on this device yet.
          </p>
          <Button onClick={() => onNavigate('/start')} size="md">
            {t('measureNow')}
          </Button>
        </div>
      ) : !activeProfile ? (
        /* Profiles List */
        <div className="grid grid-cols-1 gap-3.5">
          {profiles.map((p) => {
            const passCount = p.measurements.filter((m) => m.confidence_flag === 'pass').length;
            const checkCount = p.measurements.filter((m) => m.confidence_flag === 'check').length;

            return (
              <div
                key={p.profile_id}
                onClick={() => setActiveProfile(p)}
                className="p-4 sm:p-5 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white hover:border-[var(--vt-thread,#2E3A87)] transition-all cursor-pointer flex items-center justify-between shadow-2xs group"
              >
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-mono font-bold text-base text-[var(--vt-thread,#2E3A87)]">
                      Code: {p.client_code}
                    </span>
                    <SyncBadge status={p.sync_status} />
                  </div>

                  <div className="text-xs text-[var(--vt-ink-muted,#5C554C)] flex items-center gap-2">
                    <span>
                      {new Date(p.captured_at).toLocaleDateString('en-KE', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span>·</span>
                    <span>
                      {passCount} good{checkCount > 0 ? ` · ${checkCount} check` : ''}
                    </span>
                  </div>
                </div>

                <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-[var(--vt-thread,#2E3A87)] transition-colors" />
              </div>
            );
          })}
        </div>
      ) : (
        /* Single Profile Inspection */
        <div className="flex flex-col gap-6">
          <div className="p-4 rounded-xl bg-white border border-[var(--vt-line,#DDD5C8)] flex items-center justify-between">
            <div>
              <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] block">Client Code</span>
              <span className="font-mono font-bold text-lg text-[var(--vt-thread,#2E3A87)]">
                {activeProfile.client_code}
              </span>
            </div>
            <SyncBadge status={activeProfile.sync_status} />
          </div>

          <Silhouette
            measurements={activeProfile.measurements}
            sex={activeProfile.covariates.sex}
            unit="cm"
          />

          {/* DPA Section 26 & 32 Actions */}
          <div className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-[#FAF8F5] flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] mb-0.5">
                Data Protection Rights
              </h3>
              <p className="text-xs text-[var(--vt-ink-muted,#5C554C)]">
                You can delete your measurements or withdraw consent at any time.
              </p>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowWithdrawModal(true)}
                className="text-xs"
              >
                {t('withdrawConsent')}
              </Button>

              <Button
                variant="danger"
                size="sm"
                onClick={() => setShowDeleteModal(true)}
                icon={<Trash2 className="w-3.5 h-3.5" />}
                className="text-xs"
              >
                {t('deleteMyData')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-[var(--vt-line,#DDD5C8)]">
            <h3 className="text-base font-bold text-[var(--vt-ink,#1F1C18)] mb-2">
              {t('deleteMyData')}?
            </h3>
            <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] mb-6 leading-relaxed">
              {t('deleteMyDataConfirm')}
            </p>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowDeleteModal(false)} className="flex-1">
                {t('cancel')}
              </Button>
              <Button variant="danger" size="sm" onClick={handleDeleteProfile} className="flex-1">
                {t('delete')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Withdraw Consent Modal */}
      {showWithdrawModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-[var(--vt-line,#DDD5C8)]">
            <h3 className="text-base font-bold text-[var(--vt-ink,#1F1C18)] mb-2">
              {t('withdrawConsent')}?
            </h3>
            <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] mb-6 leading-relaxed">
              Withdrawing consent terminates measurement processing for this profile. All records will be removed from your phone and tailor.
            </p>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowWithdrawModal(false)} className="flex-1">
                {t('cancel')}
              </Button>
              <Button variant="danger" size="sm" onClick={handleWithdrawConsent} className="flex-1">
                {t('confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
