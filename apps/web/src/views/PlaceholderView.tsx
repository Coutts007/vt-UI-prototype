import React from 'react';
import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n/en';

const PlaceholderView: React.FC<{ titleKey: TranslationKey }> = ({ titleKey }) => {
  const { t } = useI18n();
  return (
    <main className="flex-1 p-6 max-w-2xl mx-auto w-full">
      <h1 className="text-2xl font-bold">{t(titleKey)}</h1>
      <p className="mt-2 text-[var(--vt-ink-muted)]">{t('comingSoon')}</p>
    </main>
  );
};

export default PlaceholderView;
