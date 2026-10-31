import React from 'react';
import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n/en';

export const ErrorPage: React.FC<{
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  onHome: () => void;
}> = ({ titleKey, bodyKey, onHome }) => {
  const { t } = useI18n();
  return (
    <main className="flex-1 p-6 max-w-xl mx-auto w-full text-center">
      <h1 className="text-2xl font-bold mt-8">{t(titleKey)}</h1>
      <p className="mt-2 text-[var(--vt-ink-muted)]">{t(bodyKey)}</p>
      <button
        type="button"
        onClick={onHome}
        className="mt-6 min-h-12 px-6 rounded-lg bg-[var(--vt-thread)] text-[var(--vt-thread-ink)] font-semibold"
      >
        {t('navHome')}
      </button>
    </main>
  );
};

export class ErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
