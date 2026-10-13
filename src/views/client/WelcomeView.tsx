import React from 'react';
import { useI18n, Locale } from '../../i18n';
import { Button } from '../../components/ui/Button';
import { ShieldCheck, Ruler, ArrowRight, BookOpen, Layers } from 'lucide-react';

interface WelcomeViewProps {
  onNavigate: (path: string) => void;
  initialCode?: string;
}

export const WelcomeView: React.FC<WelcomeViewProps> = ({ onNavigate, initialCode }) => {
  const { locale, setLocale, t } = useI18n();

  const handleLanguageSelect = (lang: Locale) => {
    setLocale(lang);
    const target = initialCode ? `/start?code=${initialCode}` : '/start';
    onNavigate(target);
  };

  return (
    <div className="min-h-[85vh] flex flex-col items-center justify-center px-4 py-8 max-w-xl mx-auto text-center">
      {/* Brand Icon & Heading */}
      <div className="w-16 h-16 rounded-2xl bg-[var(--vt-thread,#2E3A87)] text-white flex items-center justify-center shadow-md mb-6">
        <Ruler className="w-8 h-8 stroke-[2.2]" />
      </div>

      <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[var(--vt-ink,#1F1C18)] mb-3 text-balance">
        {t('welcomeTitle')}
      </h1>

      <p className="text-base text-[var(--vt-ink-muted,#5C554C)] mb-8 leading-relaxed max-w-md mx-auto">
        {t('welcomeSubtitle')}
      </p>

      {/* Kenya DPA Privacy Pill Note */}
      <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800 mb-8">
        <ShieldCheck className="w-4 h-4 text-emerald-600" />
        <span>{t('privacyTagline')}</span>
      </div>

      {/* Language Selection Big Cards */}
      <div className="w-full mb-8">
        <h2 className="text-xs uppercase font-bold tracking-wider text-[var(--vt-ink-muted,#5C554C)] mb-3">
          {t('chooseLanguage')}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <button
            onClick={() => handleLanguageSelect('en')}
            className={`p-5 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between h-28 ${
              locale === 'en'
                ? 'border-[var(--vt-thread,#2E3A87)] bg-white shadow-sm ring-2 ring-[var(--vt-thread,#2E3A87)]/15'
                : 'border-[var(--vt-line,#DDD5C8)] bg-white/70 hover:border-[var(--vt-thread,#2E3A87)]'
            }`}
          >
            <div>
              <span className="text-xl font-bold text-[var(--vt-ink,#1F1C18)] block">English</span>
              <span className="text-xs text-[var(--vt-ink-muted,#5C554C)]">Measure in English</span>
            </div>
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--vt-thread,#2E3A87)]">
              <span>Get started</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </button>

          <button
            onClick={() => handleLanguageSelect('sw')}
            className={`p-5 rounded-2xl border-2 text-left transition-all cursor-pointer flex flex-col justify-between h-28 ${
              locale === 'sw'
                ? 'border-[var(--vt-thread,#2E3A87)] bg-white shadow-sm ring-2 ring-[var(--vt-thread,#2E3A87)]/15'
                : 'border-[var(--vt-line,#DDD5C8)] bg-white/70 hover:border-[var(--vt-thread,#2E3A87)]'
            }`}
          >
            <div>
              <span className="text-xl font-bold text-[var(--vt-ink,#1F1C18)] block">Kiswahili</span>
              <span className="text-xs text-[var(--vt-ink-muted,#5C554C)]">Pima kwa Kiswahili</span>
            </div>
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--vt-thread,#2E3A87)]">
              <span>Anza sasa</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </button>
        </div>
      </div>

      {/* Secondary Actions */}
      <div className="flex flex-col sm:flex-row items-center gap-3 text-sm">
        <button
          onClick={() => onNavigate('/me')}
          className="text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)] flex items-center gap-1.5 py-2 px-3 rounded-lg hover:bg-black/5 cursor-pointer font-medium"
        >
          <Layers className="w-4 h-4" />
          <span>{t('iHaveMeasurements')}</span>
        </button>

        <span className="hidden sm:inline text-[var(--vt-line,#DDD5C8)]">·</span>

        <button
          onClick={() => onNavigate('/help')}
          className="text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)] flex items-center gap-1.5 py-2 px-3 rounded-lg hover:bg-black/5 cursor-pointer font-medium"
        >
          <BookOpen className="w-4 h-4" />
          <span>{t('howItWorks')}</span>
        </button>
      </div>
    </div>
  );
};
