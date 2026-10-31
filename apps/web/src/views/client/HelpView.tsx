import React from 'react';
import { Volume2 } from 'lucide-react';
import { voiceGuide } from '../../capture/audio';
import { HELP_CLIPS } from '../../capture/messages';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n';

const STEPS = [
  ['helpBeforeTitle', 'helpBeforeBody'],
  ['helpSetupTitle', 'helpSetupBody'],
  ['helpFrontTitle', 'helpFrontBody'],
  ['helpSideTitle', 'helpSideBody'],
  ['helpRedTitle', 'helpRedBody'],
] as const;

export const HelpView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const { locale, t } = useI18n();
  voiceGuide.setLocaleSource(() => locale);
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t('helpTitle')}</h1>
        <Button
          variant="outline"
          size="sm"
          icon={<Volume2 aria-hidden="true" className="w-4 h-4" />}
          onClick={() => {
            voiceGuide.unlock();
            voiceGuide.sayAll(HELP_CLIPS);
          }}
        >
          {t('playInstructions')}
        </Button>
      </div>
      <p className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 font-semibold text-emerald-900">{t('helpListen')}</p>
      <ol className="flex flex-col gap-4">
        {STEPS.map(([title, body], index) => (
          <li key={title} className="p-5 rounded-2xl border border-[var(--vt-line)] bg-white">
            <h2 className="font-bold text-[var(--vt-thread)] mb-1">
              {index + 1}. {t(title)}
            </h2>
            <p className="leading-relaxed">{t(body)}</p>
          </li>
        ))}
      </ol>
      <Button onClick={() => onNavigate('/start')} size="xl" className="w-full">
        {t('measureNow')}
      </Button>
    </div>
  );
};
