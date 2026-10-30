import React from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../components/ui/Button';
import { ShieldCheck, Lock, CheckCircle2, ArrowRight } from 'lucide-react';

interface PrivacyViewProps {
  onNavigate: (path: string) => void;
}

export const PrivacyView: React.FC<PrivacyViewProps> = ({ onNavigate }) => {
  const { t } = useI18n();

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
          <ShieldCheck className="w-6 h-6 stroke-[2.2]" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
            {t('privacyTitle')}
          </h1>
          <span className="text-xs text-[var(--vt-ink-muted,#5C554C)]">
            Kenya Data Protection Act, 2019 Compliance
          </span>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 mb-8 leading-relaxed">
        {t('dpaKenyaNotice')}
      </div>

      {/* Two-Column Privacy Separation Table */}
      <div className="rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white overflow-hidden shadow-2xs mb-8">
        <div className="p-4 border-b border-[var(--vt-line,#DDD5C8)] bg-[#FAF8F5]">
          <h2 className="text-sm font-bold text-[var(--vt-ink,#1F1C18)]">
            Data Separation Architecture
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[var(--vt-line,#DDD5C8)]">
          {/* Column 1: On This Phone Only */}
          <div className="p-5 flex flex-col gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 px-2 py-1 rounded inline-block w-fit">
              Kept on this phone only (Wiped immediately)
            </span>
            <ul className="text-xs text-[var(--vt-ink,#1F1C18)] space-y-2 list-disc list-inside">
              <li>Raw camera frames and live video stream</li>
              <li>Full-resolution photographs and burst stills</li>
              <li>Body segmentation silhouettes and masks</li>
              <li>Temporary image memory buffers (released right after computation)</li>
            </ul>
          </div>

          {/* Column 2: Sent to Your Tailor */}
          <div className="p-5 flex flex-col gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--vt-thread,#2E3A87)] bg-indigo-50 px-2 py-1 rounded inline-block w-fit">
              Sent to your tailor
            </span>
            <ul className="text-xs text-[var(--vt-ink,#1F1C18)] space-y-2 list-disc list-inside">
              <li>Eight tailoring measurements in millimetres</li>
              <li>Confidence indicator flags (Good / Check / Not measured)</li>
              <li>Pseudonymous 6-character client code (e.g. AB1234)</li>
              <li>Capture timestamp and consent record</li>
              <li><strong>Never</strong> photos, weight, BMI, or phone numbers</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Rights Sections */}
      <div className="space-y-4 mb-8 text-xs text-[var(--vt-ink,#1F1C18)] leading-relaxed">
        <div className="p-4 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white">
          <h3 className="font-bold text-sm text-[var(--vt-ink,#1F1C18)] mb-1">
            Section 26: Right to Be Forgotten
          </h3>
          <p>
            You may delete your local measurement profile or request server-side deletion at any time using the "Delete my data" button under My Measurements.
          </p>
        </div>

        <div className="p-4 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white">
          <h3 className="font-bold text-sm text-[var(--vt-ink,#1F1C18)] mb-1">
            Section 32: Right to Withdraw Consent
          </h3>
          <p>
            You can withdraw consent at any time without affecting tailoring services already performed.
          </p>
        </div>
      </div>

      <Button onClick={() => onNavigate('/')} size="lg" className="w-full">
        Back to Home
      </Button>
    </div>
  );
};
