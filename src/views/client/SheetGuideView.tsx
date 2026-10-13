import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../components/ui/Button';
import { Download, Check, AlertCircle, ArrowRight, Eye, ShieldCheck, CreditCard } from 'lucide-react';

interface SheetGuideViewProps {
  onNavigate: (path: string) => void;
}

export const SheetGuideView: React.FC<SheetGuideViewProps> = ({ onNavigate }) => {
  const { t } = useI18n();

  const [hasSheet, setHasSheet] = useState<boolean>(true);
  const [showPreviewModal, setShowPreviewModal] = useState<boolean>(false);
  const [printCheckConfirmed, setPrintCheckConfirmed] = useState<boolean | null>(null);

  const handleContinue = () => {
    onNavigate('/setup');
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-6 sm:py-8">
      {/* Header */}
      <div className="flex items-center justify-between text-xs font-semibold text-[var(--vt-ink-muted,#5C554C)] mb-6 uppercase tracking-wider">
        <span>Step 4 of 5 · Measuring Sheet</span>
        <span>ArUco Scale Target</span>
      </div>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight mb-2">
        {t('sheetTitle')}
      </h1>
      <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mb-6 leading-relaxed">
        {t('sheetIntro')}
      </p>

      {/* Sheet Acquisition Option Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        <button
          type="button"
          onClick={() => setHasSheet(true)}
          className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
            hasSheet
              ? 'border-[var(--vt-thread,#2E3A87)] bg-indigo-50/70 ring-2 ring-[var(--vt-thread,#2E3A87)]/15'
              : 'border-[var(--vt-line,#DDD5C8)] bg-white hover:bg-[#FAF8F5]'
          }`}
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center mb-2">
            <Check className="w-4 h-4 stroke-[2.5]" />
          </div>
          <span className="text-xs font-bold text-[var(--vt-ink,#1F1C18)] block">
            {t('sheetOptionTailor')}
          </span>
          <span className="text-[11px] text-[var(--vt-ink-muted,#5C554C)] block mt-0.5">
            Collected in person
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            alert('Downloading A4 PDF: In production, prints at 100% actual size.');
          }}
          className="p-4 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white hover:bg-[#FAF8F5] text-left transition-all cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-[var(--vt-thread,#2E3A87)] flex items-center justify-center mb-2">
            <Download className="w-4 h-4 stroke-[2.2]" />
          </div>
          <span className="text-xs font-bold text-[var(--vt-ink,#1F1C18)] block">
            {t('sheetOptionPrint')}
          </span>
          <span className="text-[11px] text-[var(--vt-ink-muted,#5C554C)] block mt-0.5">
            Cyber café / Home A4
          </span>
        </button>

        <button
          type="button"
          onClick={() => setShowPreviewModal(true)}
          className="p-4 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white hover:bg-[#FAF8F5] text-left transition-all cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center mb-2">
            <Eye className="w-4 h-4 stroke-[2.2]" />
          </div>
          <span className="text-xs font-bold text-[var(--vt-ink,#1F1C18)] block">
            {t('sheetOptionPreview')}
          </span>
          <span className="text-[11px] text-[var(--vt-ink-muted,#5C554C)] block mt-0.5">
            Inspect layout
          </span>
        </button>
      </div>

      {/* Mandatory Print Verification Test */}
      <div className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs mb-8">
        <div className="flex items-center gap-2 mb-2">
          <CreditCard className="w-5 h-5 text-[var(--vt-thread,#2E3A87)]" />
          <h2 className="text-base font-bold text-[var(--vt-ink,#1F1C18)]">
            {t('printCheckTitle')}
          </h2>
        </div>
        <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] leading-relaxed mb-4">
          {t('printCheckIntro')}
        </p>

        {/* 10 cm Visual Test Bar Simulation */}
        <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[var(--vt-line,#DDD5C8)] mb-4">
          <div className="flex items-center justify-between text-[11px] font-mono text-[var(--vt-ink-muted,#5C554C)] mb-1">
            <span>0 cm</span>
            <span className="font-bold text-[var(--vt-thread,#2E3A87)]">10.0 cm Test Bar</span>
            <span>10 cm</span>
          </div>
          <div className="h-4 w-full bg-slate-900 rounded-sm relative flex items-center justify-between px-1">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((t) => (
              <div key={t} className="w-[1px] h-2 bg-white/70" />
            ))}
          </div>
        </div>

        <p className="text-xs font-semibold text-[var(--vt-ink,#1F1C18)] mb-3">
          {t('printCheckPrompt')}
        </p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <button
            type="button"
            onClick={() => setPrintCheckConfirmed(true)}
            className={`py-2.5 px-3 rounded-xl border text-xs font-semibold text-center transition-all cursor-pointer ${
              printCheckConfirmed === true
                ? 'border-emerald-500 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-400'
                : 'border-[var(--vt-line,#DDD5C8)] hover:bg-[#FAF8F5]'
            }`}
          >
            {t('printCheckYes')}
          </button>

          <button
            type="button"
            onClick={() => setPrintCheckConfirmed(false)}
            className={`py-2.5 px-3 rounded-xl border text-xs font-semibold text-center transition-all cursor-pointer ${
              printCheckConfirmed === false
                ? 'border-rose-400 bg-rose-50 text-rose-900 ring-2 ring-rose-300'
                : 'border-[var(--vt-line,#DDD5C8)] hover:bg-[#FAF8F5]'
            }`}
          >
            {t('printCheckNo')}
          </button>
        </div>

        {printCheckConfirmed === false && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{t('printCheckFailedAlert')}</span>
          </div>
        )}
      </div>

      {/* Handling Tips */}
      <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-amber-900 mb-8 leading-relaxed">
        <strong>Important handling tips:</strong> {t('sheetTips')}
      </div>

      {/* Continue */}
      <Button
        onClick={handleContinue}
        disabled={printCheckConfirmed === false}
        size="xl"
        icon={<ArrowRight className="w-5 h-5" />}
        className="w-full"
      >
        {t('continue')}
      </Button>

      {/* Modal: Interactive Sheet Preview */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-[var(--vt-line,#DDD5C8)]">
            <h3 className="text-base font-bold text-[var(--vt-ink,#1F1C18)] mb-2">
              Virtual Tailor A4 Sheet
            </h3>
            <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] mb-4">
              Centered 150 mm ArUco marker (DICT_4X4_50 id 0) with 10 cm test line.
            </p>

            {/* Visual Sheet Simulation */}
            <div className="aspect-[1/1.414] border-2 border-slate-300 rounded-lg p-4 flex flex-col items-center justify-between bg-white shadow-inner mb-4">
              <span className="text-[9px] font-bold tracking-wider text-slate-400">
                VIRTUAL TAILOR · A4 MEASURING SHEET
              </span>

              {/* ArUco Marker Mock Box */}
              <div className="w-32 h-32 bg-black p-3 rounded-sm flex items-center justify-center">
                <div className="grid grid-cols-4 grid-rows-4 w-full h-full gap-1 bg-white p-1">
                  <div className="bg-black" />
                  <div className="bg-white" />
                  <div className="bg-black" />
                  <div className="bg-black" />
                  <div className="bg-white" />
                  <div className="bg-black" />
                  <div className="bg-white" />
                  <div className="bg-black" />
                  <div className="bg-black" />
                  <div className="bg-white" />
                  <div className="bg-black" />
                  <div className="bg-white" />
                  <div className="bg-white" />
                  <div className="bg-black" />
                  <div className="bg-white" />
                  <div className="bg-black" />
                </div>
              </div>

              <div className="w-full text-center">
                <div className="h-2 w-3/4 mx-auto bg-slate-800 rounded-xs mb-1" />
                <span className="text-[8px] font-mono text-slate-500">
                  100 mm (10 cm) Verification Bar
                </span>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPreviewModal(false)}
              className="w-full"
            >
              {t('close')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
