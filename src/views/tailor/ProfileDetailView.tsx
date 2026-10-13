import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n';
import { MeasurementProfile } from '../../types/api';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { FlagBadge } from '../../components/ui/FlagBadge';
import { Silhouette } from '../../components/ui/Silhouette';
import {
  ChevronLeft,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Info,
  Smartphone,
  Cpu,
} from 'lucide-react';

interface ProfileDetailViewProps {
  clientId: string;
  profileId: string;
  onNavigate: (path: string) => void;
}

export const ProfileDetailView: React.FC<ProfileDetailViewProps> = ({
  clientId,
  profileId,
  onNavigate,
}) => {
  const { t } = useI18n();

  const [profile, setProfile] = useState<MeasurementProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfile();
  }, [profileId]);

  const loadProfile = async () => {
    setLoading(true);
    try {
      const data = await api.getProfileById(profileId);
      setProfile(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  if (loading || !profile) {
    return <div className="p-8 text-center text-sm text-slate-400">Loading profile data…</div>;
  }

  const formatValue = (valMm: number | null) => {
    if (valMm === null) return '— (Fail: Not measured)';
    return `${(valMm / 10).toFixed(1)} cm`;
  };

  const hasFlags = profile.measurements.some((m) => m.confidence_flag !== 'pass');

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      <button
        onClick={() => onNavigate(`/t/clients/${clientId}`)}
        className="text-xs text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)] flex items-center gap-1 cursor-pointer font-medium"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Back to client {profile.client_code}</span>
      </button>

      {/* Header Summary */}
      <div className="p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono font-bold text-xl text-[var(--vt-thread,#2E3A87)]">
              {profile.client_code} · Version {profile.version}
            </span>
            <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-mono font-semibold">
              {profile.rules_version}
            </span>
          </div>

          <div className="text-xs text-[var(--vt-ink-muted,#5C554C)] flex flex-wrap items-center gap-2">
            <span>
              Captured {new Date(profile.captured_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
            <span>·</span>
            <span>Mode: {profile.session.capture_mode}</span>
            <span>·</span>
            <span>Device: {profile.session.device_model}</span>
          </div>
        </div>

        <Button
          onClick={() => onNavigate(`/t/orders/new?profileId=${profile.profile_id}`)}
          icon={<Plus className="w-4 h-4" />}
          size="md"
        >
          New order from profile
        </Button>
      </div>

      {/* Fitting Callout */}
      {hasFlags && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5 shadow-2xs">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <strong className="block text-sm mb-0.5">Fitting Confirmation Required</strong>
            <span>
              One or more body measurement sites carry a confidence flag. Confirm or override these values at the garment fitting.
            </span>
          </div>
        </div>
      )}

      {/* Anatomical Silhouette Visualizer */}
      <div className="mb-2">
        <Silhouette
          measurements={profile.measurements}
          sex={profile.covariates.sex}
          unit="cm"
        />
      </div>

      {/* Tailor Measurement Sheet Table */}
      <div className="rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white overflow-hidden shadow-2xs">
        <div className="p-4 bg-[#FAF8F5] border-b border-[var(--vt-line,#DDD5C8)] flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--vt-ink,#1F1C18)]">
            Body Measurement Data
          </h2>
          <span className="text-xs text-[var(--vt-ink-muted,#5C554C)]">
            Scale Disagreement: {profile.session.scale_disagreement_pct}%
          </span>
        </div>

        <div className="divide-y divide-[var(--vt-line,#DDD5C8)]/60">
          {profile.measurements.map((m) => (
            <div
              key={m.site_code}
              className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[#FDFBF7]"
            >
              <div>
                <span className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] capitalize block">
                  {m.site_code}
                </span>
                <span className="text-xs text-[var(--vt-ink-muted,#5C554C)]">
                  Method: {m.method === 'auto' ? 'Computed from Vision' : 'Manual Override'}
                </span>
              </div>

              <div className="flex items-center gap-4">
                <span className="text-base font-mono font-bold text-[var(--vt-thread,#2E3A87)]">
                  {formatValue(m.value_mm)}
                </span>
                <FlagBadge flag={m.confidence_flag} reasons={m.flag_reasons} showReasonText />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
