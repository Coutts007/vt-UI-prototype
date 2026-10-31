import React, { useEffect, useState } from 'react';
import { Camera } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ProgressSteps } from '../../components/ui/data';
import { BottomSheet } from '../../components/ui/feedback';
import { Checkbox } from '../../components/ui/forms';
import { vtStorage } from '../../db/storage';
import { useI18n } from '../../i18n';
import { CONSENT, CONSENT_VERSION } from '../../i18n/consent';

export const ConsentFullText: React.FC = () => {
  const { locale } = useI18n();
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {CONSENT[locale].full.map((part) => (
        <section key={part.heading}>
          <h3 className="font-bold">{part.heading}</h3>
          <p>{part.body}</p>
        </section>
      ))}
    </div>
  );
};

export const ConsentView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const { locale, t } = useI18n();
  const [boxes, setBoxes] = useState([false, false, false]);
  const [full, setFull] = useState(false);
  const allAgreed = boxes.every(Boolean);

  useEffect(() => {
    void vtStorage.loadDraft().then((draft) => {
      if (!draft.client_code) onNavigate('/start');
    });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agree = () => {
    if (!allAgreed) return;
    vtStorage.saveDraft({
      ...vtStorage.getDraft(),
      consent: {
        consent_version: CONSENT_VERSION,
        language: locale,
        scope: ['measure', 'measurements_only', 'retention'],
        given_at: new Date().toISOString(),
      },
    });
    onNavigate('/check');
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-6 flex flex-col gap-5">
      <ProgressSteps current={1} />
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t('consentTitle')}</h1>
      <div
        tabIndex={0}
        role="region"
        aria-label={t('consentTitle')}
        className="max-h-[300px] overflow-y-auto p-4 rounded-2xl border border-[var(--vt-line)] bg-white text-sm leading-relaxed space-y-3"
      >
        {CONSENT[locale].opening.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </div>
      <button type="button" onClick={() => setFull(true)} className="min-h-12 text-left font-semibold underline cursor-pointer">
        {t('consentReadFull')}
      </button>
      <div>
        {(['consentBox1', 'consentBox2', 'consentBox3'] as const).map((key, index) => (
          <Checkbox
            key={key}
            label={t(key)}
            checked={boxes[index]}
            onChange={(checked) => setBoxes(boxes.map((box, i) => (i === index ? checked : box)))}
          />
        ))}
      </div>
      <p className="text-sm text-[var(--vt-ink-muted)]">{t('consentVersionLabel')}</p>
      <div className="flex flex-col gap-3">
        <Button onClick={agree} disabled={!allAgreed} size="xl" icon={<Camera aria-hidden="true" className="w-5 h-5" />} className="w-full">
          {t('openCamera')}
        </Button>
        {!allAgreed && <p className="text-sm text-center">{t('consentError')}</p>}
        <Button variant="text" onClick={() => onNavigate('/declined')} className="w-full">
          {t('iDoNotAgree')}
        </Button>
      </div>
      <BottomSheet title={t('consentReadFull')} open={full} onClose={() => setFull(false)}>
        <ConsentFullText />
      </BottomSheet>
    </div>
  );
};
