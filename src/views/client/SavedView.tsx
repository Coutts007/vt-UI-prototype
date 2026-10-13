import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../components/ui/Button';
import { vtStorage } from '../../db/storage';
import { CheckCircle2, Cloud, AlertCircle, Share2, Trash2, ArrowRight, Layers } from 'lucide-react';

interface SavedViewProps {
  synced: boolean;
  clientCode: string;
  onNavigate: (path: string) => void;
}

export const SavedView: React.FC<SavedViewProps> = ({
  synced,
  clientCode,
  onNavigate,
}) => {
  const { t } = useI18n();
  const [clearedNotice, setClearedNotice] = useState(false);

  const handleShareWhatsApp = () => {
    const text = `Hello! I have sent my Virtual Tailor measurements for my order. My code is ${clientCode}.`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleClearSharedPhone = async () => {
    if (confirm('Clear your details and measurement draft from this phone?')) {
      await vtStorage.clearAllLocalData();
      setClearedNotice(true);
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-8 text-center min-h-[75vh] flex flex-col items-center justify-center">
      {/* Big Status Badge */}
      <div
        className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 shadow-md ${
          synced
            ? 'bg-emerald-100 text-emerald-700 ring-8 ring-emerald-50'
            : 'bg-sky-100 text-sky-700 ring-8 ring-sky-50'
        }`}
      >
        {synced ? (
          <CheckCircle2 className="w-10 h-10 stroke-[2.5]" />
        ) : (
          <Cloud className="w-10 h-10 stroke-[2.2]" />
        )}
      </div>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight mb-2">
        {synced ? t('savedTitleSynced') : t('savedTitlePending')}
      </h1>

      <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mb-6 max-w-sm">
        {t('tailorWillContact')}
      </p>

      {/* Code & Timestamp Card */}
      <div className="w-full p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs mb-8 text-left">
        <div className="flex items-center justify-between border-b border-[var(--vt-line,#DDD5C8)]/60 pb-3 mb-3">
          <span className="text-xs text-[var(--vt-ink-muted,#5C554C)]">{t('yourCode')}</span>
          <span className="text-xl font-mono font-bold text-[var(--vt-thread,#2E3A87)]">
            {clientCode}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs text-[var(--vt-ink-muted,#5C554C)]">
          <span>{t('measuredAt')}</span>
          <span className="font-medium text-[var(--vt-ink,#1F1C18)]">
            {new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-3 w-full mb-8">
        <Button
          variant="outline"
          size="lg"
          onClick={handleShareWhatsApp}
          icon={<Share2 className="w-4 h-4 text-emerald-600" />}
          className="w-full"
        >
          {t('tellTailorWhatsApp')}
        </Button>

        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="primary"
            size="md"
            onClick={() => onNavigate('/me')}
            icon={<Layers className="w-4 h-4" />}
          >
            My profiles
          </Button>

          <Button
            variant="secondary"
            size="md"
            onClick={() => onNavigate('/start')}
          >
            {t('measureAgain')}
          </Button>
        </div>
      </div>

      {/* Shared Phone Cleanup */}
      <div className="pt-4 border-t border-[var(--vt-line,#DDD5C8)] w-full">
        {clearedNotice ? (
          <span className="text-xs text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 block">
            Details cleared from this device.
          </span>
        ) : (
          <button
            type="button"
            onClick={handleClearSharedPhone}
            className="text-xs text-[var(--vt-ink-muted,#5C554C)] hover:text-rose-600 flex items-center justify-center gap-1.5 mx-auto cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t('sharedPhonePrompt')}</span>
          </button>
        )}
      </div>
    </div>
  );
};
