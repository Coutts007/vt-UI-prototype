import React from 'react';
import { ArrowRight, BookOpen, Layers, Ruler, ShieldCheck } from 'lucide-react';
import { useI18n, Locale } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';

interface WelcomeViewProps {
  onNavigate: (path: string) => void;
  initialCode?: string;
}

const LANGUAGES: { id: Locale; name: TranslationKey; hint: TranslationKey; go: TranslationKey }[] = [
  { id: 'en', name: 'english', hint: 'welcomeEnHint', go: 'welcomeEnGo' },
  { id: 'sw', name: 'kiswahili', hint: 'welcomeSwHint', go: 'welcomeSwGo' },
];

export const WelcomeView: React.FC<WelcomeViewProps> = ({ onNavigate, initialCode }) => {
  const { locale, setLocale, t } = useI18n();

  const choose = (language: Locale) => {
    setLocale(language);
    onNavigate(initialCode ? `/start?code=${initialCode}` : '/start');
  };

  return (
    <div className="min-h-[85vh] flex flex-col items-center justify-center px-4 py-8 max-w-xl mx-auto text-center">
      <div className="w-16 h-16 rounded-2xl bg-[var(--vt-thread)] text-white flex items-center justify-center shadow-md mb-6">
        <Ruler aria-hidden="true" className="w-8 h-8" />
      </div>
      <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-3 text-balance">{t('welcomeTitle')}</h1>
      <p className="text-base text-[var(--vt-ink-muted)] mb-6 leading-relaxed">{t('welcomeSubtitle')}</p>
      <p className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-sm font-medium text-emerald-900 mb-8">
        <ShieldCheck aria-hidden="true" className="w-4 h-4 shrink-0" />
        <span>{t('privacyTagline')}</span>
      </p>
      <h2 className="text-sm font-bold text-[var(--vt-ink-muted)] mb-3">{t('chooseLanguage')}</h2>
      <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-8">
        {LANGUAGES.map((language) => (
          <button
            key={language.id}
            type="button"
            onClick={() => choose(language.id)}
            className={`p-5 rounded-2xl border-2 text-left bg-white flex flex-col justify-between min-h-28 cursor-pointer ${
              locale === language.id ? 'border-[var(--vt-thread)] shadow-sm' : 'border-[var(--vt-line)]'
            }`}
          >
            <span>
              <span className="text-xl font-bold block">{t(language.name)}</span>
              <span className="text-sm text-[var(--vt-ink-muted)]">{t(language.hint)}</span>
            </span>
            <span className="flex items-center justify-between text-sm font-semibold text-[var(--vt-thread)]">
              <span>{t(language.go)}</span>
              <ArrowRight aria-hidden="true" className="w-4 h-4" />
            </span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 text-sm font-medium">
        <button type="button" onClick={() => onNavigate('/me')} className="flex items-center gap-1.5 min-h-12 px-3 cursor-pointer">
          <Layers aria-hidden="true" className="w-4 h-4" />
          <span>{t('iHaveMeasurements')}</span>
        </button>
        <button type="button" onClick={() => onNavigate('/help')} className="flex items-center gap-1.5 min-h-12 px-3 cursor-pointer">
          <BookOpen aria-hidden="true" className="w-4 h-4" />
          <span>{t('howItWorks')}</span>
        </button>
      </div>
    </div>
  );
};
