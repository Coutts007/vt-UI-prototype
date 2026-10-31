import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Settings, Shield, Beaker, Check } from 'lucide-react';

interface AdminSettingsViewProps {
  onNavigate: (path: string) => void;
}

export const AdminSettingsView: React.FC<AdminSettingsViewProps> = ({ onNavigate }) => {
  const { t } = useI18n();
  const [retentionMonths, setRetentionMonths] = useState<number>(24);
  const [studyMode, setStudyMode] = useState<boolean>(true);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSave = async () => {
    await api.setStudyMode(studyMode);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
          System Governance Settings
        </h1>
        <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mt-0.5">
          Data retention enforcement, MKU validation study mode, and privacy controls
        </p>
      </div>

      {savedNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>Settings updated successfully.</span>
        </div>
      )}

      {/* Retention Period Card */}
      <div className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-[var(--vt-thread,#2E3A87)]" />
          <h2 className="text-base font-bold text-[var(--vt-ink,#1F1C18)]">
            Data Retention Limit (Months)
          </h2>
        </div>
        <p className="text-xs text-[var(--vt-ink-muted,#5C554C)]">
          Profiles inactive longer than this period past the last completed order will be flagged for automatic scheduled purging under Section 39 of the DPA.
        </p>
        <div className="flex items-center gap-3">
          <input
            aria-label={t('retentionMonthsLabel')}
            type="number"
            value={retentionMonths}
            onChange={(e) => setRetentionMonths(parseInt(e.target.value) || 24)}
            min={1}
            max={60}
            className="w-28 h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm font-bold font-mono"
          />
          <span className="text-sm text-[var(--vt-ink-muted,#5C554C)]">months</span>
        </div>
      </div>

      {/* Study Mode Switch Card */}
      <div className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs space-y-3">
        <div className="flex items-center gap-2">
          <Beaker className="w-5 h-5 text-indigo-600" />
          <h2 className="text-base font-bold text-[var(--vt-ink,#1F1C18)]">
            Validation Study Mode (MKU IERC)
          </h2>
        </div>
        <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] leading-relaxed">
          Enables researcher-run capture screens with study covariates (lighting, distance, clothing fit), participant enrollment (P001–P090), and blind reference tape data entry.
        </p>

        <label className="flex items-center gap-3 cursor-pointer pt-2">
          <input
            type="checkbox"
            checked={studyMode}
            onChange={(e) => setStudyMode(e.target.checked)}
            className="w-5 h-5 rounded text-[var(--vt-thread,#2E3A87)] focus:ring-[var(--vt-thread,#2E3A87)]"
          />
          <span className="text-sm font-bold text-[var(--vt-ink,#1F1C18)]">
            Study Mode Active
          </span>
        </label>
      </div>

      <Button onClick={handleSave} size="lg" className="w-full sm:w-auto">
        Save Governance Settings
      </Button>
    </div>
  );
};
