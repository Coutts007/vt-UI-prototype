import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../components/ui/Button';
import { vtStorage } from '../../db/storage';
import { Shield, Check, Lock, Camera, BookOpen } from 'lucide-react';

interface ConsentViewProps {
  onNavigate: (path: string) => void;
}

export const ConsentView: React.FC<ConsentViewProps> = ({ onNavigate }) => {
  const { locale, t } = useI18n();

  const [box1, setBox1] = useState(false);
  const [box2, setBox2] = useState(false);
  const [box3, setBox3] = useState(false);

  const allAgreed = box1 && box2 && box3;

  const handleAgree = () => {
    if (!allAgreed) return;

    vtStorage.saveDraft({
      ...vtStorage.getDraft(),
      consent: {
        consent_version: '1.0',
        language: locale,
        scope: ['measure', 'measurements_only', 'retention'],
        given_at: new Date().toISOString(),
      },
    });

    onNavigate('/check');
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-6 sm:py-8">
      {/* Step Indicator */}
      <div className="flex items-center justify-between text-xs font-semibold text-[var(--vt-ink-muted,#5C554C)] mb-6 uppercase tracking-wider">
        <span>Step 2 of 5 · Consent</span>
        <span>Version 1.0</span>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center justify-center">
          <Shield className="w-5 h-5 stroke-[2.2]" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
            {t('consentTitle')}
          </h1>
          <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] block">
            Kenya Data Protection Act, 2019 Notice
          </span>
        </div>
      </div>

      {/* Information Box */}
      <div className="p-4 sm:p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white mb-6 text-xs sm:text-sm text-[var(--vt-ink,#1F1C18)] leading-relaxed space-y-3 max-h-60 overflow-y-auto shadow-2xs">
        <p className="font-semibold text-[var(--vt-ink,#1F1C18)]">
          Virtual Tailor Privacy &amp; Data Invariant Agreement
        </p>
        <p>
          Virtual Tailor processes your body silhouette and camera stream exclusively on this device using local WebAssembly machine learning.
        </p>
        <p>
          <strong>No image ever leaves this phone.</strong> Your camera frames, full-resolution stills, and segmentation outlines are immediately wiped from device memory as soon as measurements are computed.
        </p>
        <p>
          Only eight numerical tailoring measurements (in millimetres) and their confidence indicators are transmitted to your tailor. Your tailor retains these measurements for the purpose of making your garments until you request their deletion.
        </p>
        <div className="pt-2 border-t border-[var(--vt-line,#DDD5C8)]/60 flex items-center justify-between text-xs text-[var(--vt-ink-muted,#5C554C)]">
          <span>{t('consentVersionLabel')}</span>
          <button
            type="button"
            onClick={() => onNavigate('/privacy')}
            className="text-[var(--vt-thread,#2E3A87)] font-medium hover:underline flex items-center gap-1 cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>{t('consentReadFull')}</span>
          </button>
        </div>
      </div>

      {/* Three Unticked Checkboxes */}
      <div className="flex flex-col gap-3.5 mb-8">
        <label className="flex items-start gap-3 p-4 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white cursor-pointer select-none hover:bg-[#FAF8F5] transition-colors shadow-2xs">
          <input
            type="checkbox"
            checked={box1}
            onChange={(e) => setBox1(e.target.checked)}
            className="w-5 h-5 rounded text-[var(--vt-thread,#2E3A87)] mt-0.5 shrink-0 focus:ring-[var(--vt-thread,#2E3A87)] cursor-pointer"
          />
          <span className="text-sm font-medium text-[var(--vt-ink,#1F1C18)] leading-snug">
            {t('consentBox1')}
          </span>
        </label>

        <label className="flex items-start gap-3 p-4 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white cursor-pointer select-none hover:bg-[#FAF8F5] transition-colors shadow-2xs">
          <input
            type="checkbox"
            checked={box2}
            onChange={(e) => setBox2(e.target.checked)}
            className="w-5 h-5 rounded text-[var(--vt-thread,#2E3A87)] mt-0.5 shrink-0 focus:ring-[var(--vt-thread,#2E3A87)] cursor-pointer"
          />
          <span className="text-sm font-medium text-[var(--vt-ink,#1F1C18)] leading-snug">
            {t('consentBox2')}
          </span>
        </label>

        <label className="flex items-start gap-3 p-4 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white cursor-pointer select-none hover:bg-[#FAF8F5] transition-colors shadow-2xs">
          <input
            type="checkbox"
            checked={box3}
            onChange={(e) => setBox3(e.target.checked)}
            className="w-5 h-5 rounded text-[var(--vt-thread,#2E3A87)] mt-0.5 shrink-0 focus:ring-[var(--vt-thread,#2E3A87)] cursor-pointer"
          />
          <span className="text-sm font-medium text-[var(--vt-ink,#1F1C18)] leading-snug">
            {t('consentBox3')}
          </span>
        </label>
      </div>

      {/* Buttons */}
      <div className="flex flex-col gap-3">
        <Button
          onClick={handleAgree}
          disabled={!allAgreed}
          size="xl"
          icon={<Camera className="w-5 h-5" />}
          className="w-full"
        >
          {t('openCamera')}
        </Button>

        {!allAgreed && (
          <span className="text-xs text-center text-amber-800 bg-amber-50 py-1.5 px-3 rounded-lg border border-amber-200">
            {t('consentError')}
          </span>
        )}

        <Button
          variant="text"
          onClick={() => onNavigate('/declined')}
          className="w-full text-xs text-[var(--vt-ink-muted,#5C554C)]"
        >
          {t('iDoNotAgree')}
        </Button>
      </div>
    </div>
  );
};
