import React from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../components/ui/Button';
import { vtStorage } from '../../db/storage';
import { Shield, ArrowRight, Trash2 } from 'lucide-react';

interface DeclinedViewProps {
  onNavigate: (path: string) => void;
}

export const DeclinedView: React.FC<DeclinedViewProps> = ({ onNavigate }) => {
  const { t } = useI18n();

  const handleClear = async () => {
    await vtStorage.clearAllLocalData();
    alert('Entered details cleared.');
    onNavigate('/');
  };

  return (
    <div className="max-w-md mx-auto px-4 py-12 text-center min-h-[70vh] flex flex-col items-center justify-center">
      <div className="w-16 h-16 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center mb-6">
        <Shield className="w-8 h-8 stroke-[2.2]" />
      </div>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight mb-3">
        {t('declinedTitle')}
      </h1>

      <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mb-8 leading-relaxed">
        {t('declinedBody')}
      </p>

      <div className="flex flex-col gap-3 w-full">
        <Button onClick={() => onNavigate('/')} size="lg" className="w-full">
          Return to Home
        </Button>

        <Button
          variant="outline"
          onClick={handleClear}
          size="md"
          icon={<Trash2 className="w-4 h-4 text-rose-600" />}
          className="w-full text-xs"
        >
          {t('clearEnteredDetails')}
        </Button>
      </div>
    </div>
  );
};
