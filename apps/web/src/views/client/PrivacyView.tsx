import React from 'react';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n';
import { CONSENT_VERSION } from '../../i18n/consent';
import { ConsentFullText } from './ConsentView';

const BOX = 'p-4 rounded-xl border border-[var(--vt-line)] bg-white';

export const PrivacyView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const { t } = useI18n();
  const phone = ['privacyPhone1', 'privacyPhone2', 'privacyPhone3', 'privacyPhone4'] as const;
  const tailor = ['privacyTailor1', 'privacyTailor2', 'privacyTailor3', 'privacyTailor4'] as const;
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-5">
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t('privacyTitle')}</h1>
      <p className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">{t('dpaKenyaNotice')}</p>
      <section className={BOX}>
        <h2 className="font-bold mb-2">{t('privacyConsentHeading', { version: CONSENT_VERSION })}</h2>
        <ConsentFullText />
      </section>
      <section className="rounded-2xl border border-[var(--vt-line)] bg-white grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-[var(--vt-line)]">
        <div className="p-4">
          <h2 className="font-bold mb-2">{t('privacyOnPhone')}</h2>
          <ul className="list-disc ps-4 text-sm space-y-1">
            {phone.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </div>
        <div className="p-4">
          <h2 className="font-bold mb-2">{t('privacySent')}</h2>
          <ul className="list-disc ps-4 text-sm space-y-1">
            {tailor.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </div>
      </section>
      {(
        [
          ['privacyRetentionTitle', 'privacyRetentionBody'],
          ['privacyS26Title', 'privacyS26Body'],
          ['privacyS32Title', 'privacyS32Body'],
          ['privacyOdpcTitle', 'privacyOdpcBody'],
          ['privacyContactTitle', 'privacyContactBody'],
        ] as const
      ).map(([title, body]) => (
        <section key={title} className={BOX}>
          <h2 className="font-bold mb-1">{t(title)}</h2>
          <p className="text-sm leading-relaxed">{t(body)}</p>
        </section>
      ))}
      <Button onClick={() => onNavigate('/')} size="lg" className="w-full">
        {t('backHome')}
      </Button>
    </div>
  );
};
