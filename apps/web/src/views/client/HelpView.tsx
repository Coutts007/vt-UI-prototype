import React from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../components/ui/Button';
import { vtAudio } from '../../capture/audio';
import { BookOpen, Volume2, CheckCircle2, ArrowRight } from 'lucide-react';

interface HelpViewProps {
  onNavigate: (path: string) => void;
}

export const HelpView: React.FC<HelpViewProps> = ({ onNavigate }) => {
  const { locale, t } = useI18n();

  const handlePlayAudio = () => {
    const text =
      'Virtual Tailor measuring protocol: Prop your phone upright against a chair at navel height. Stand 2.5 metres away facing the camera, holding your printed measuring sheet flat against your chest. For the side view, turn ninety degrees to your right with the sheet on your hip.';
    vtAudio.speak(text, locale);
  };

  const steps = [
    {
      title: '1. Before You Start',
      text: 'Put on fitted clothing (like a T-shirt and leggings). Have your printed A4 measuring sheet ready. Make sure the room has good lighting and a clear wall.',
    },
    {
      title: '2. Set Up the Phone',
      text: 'Prop your phone upright on a chair against the backrest at navel height, camera facing the wall. Check that the level bubble turns green.',
    },
    {
      title: '3. Front View',
      text: 'Step back about 3 big steps (2 to 2.5 metres) until your body fits inside the dashed outline. Hold the measuring sheet flat on your chest with fingers off the black square. Hold your arms slightly away from your hips.',
    },
    {
      title: '4. Side View',
      text: 'Turn 90 degrees to your right so your right shoulder faces the phone. Hold the sheet flat on your right hip. Let your arms hang slightly forward.',
    },
    {
      title: '5. If a Check Stays Red',
      text: 'Follow the large message on screen. For example, "Step back" if your feet are cut off, or "Straighten the phone" if tilted.',
    },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
            {t('helpTitle')}
          </h1>
          <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mt-0.5">
            Appendix B illustrated client measurement protocol (works offline)
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handlePlayAudio}
          icon={<Volume2 className="w-4 h-4 text-emerald-600" />}
        >
          Play audio
        </Button>
      </div>

      <div className="space-y-4 mb-8">
        {steps.map((step, idx) => (
          <div
            key={idx}
            className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs"
          >
            <h2 className="text-base font-bold text-[var(--vt-thread,#2E3A87)] mb-1">
              {step.title}
            </h2>
            <p className="text-sm text-[var(--vt-ink,#1F1C18)] leading-relaxed">
              {step.text}
            </p>
          </div>
        ))}
      </div>

      <Button
        onClick={() => onNavigate('/start')}
        size="xl"
        icon={<ArrowRight className="w-5 h-5" />}
        className="w-full"
      >
        Start Measuring Now
      </Button>
    </div>
  );
};
