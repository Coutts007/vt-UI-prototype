import React, { useState } from 'react';
import { Shield, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { vtStorage } from '../../db/storage';
import { useI18n } from '../../i18n';

export const DeclinedView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const { t } = useI18n();
  const [cleared, setCleared] = useState(false);
  const [unsent, setUnsent] = useState<number | null>(null);

  return (
    <div className="max-w-md mx-auto px-4 py-12 text-center min-h-[70vh] flex flex-col items-center justify-center">
      <div className="w-16 h-16 rounded-2xl bg-amber-100 text-amber-900 flex items-center justify-center mb-6">
        <Shield aria-hidden="true" className="w-8 h-8" />
      </div>
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-3">{t('declinedTitle')}</h1>
      <p className="text-[var(--vt-ink-muted)] mb-8 leading-relaxed">{t('declinedBody')}</p>
      <div className="flex flex-col gap-3 w-full">
        <Button onClick={() => onNavigate('/')} size="lg" className="w-full">
          {t('backHome')}
        </Button>
        {cleared ? (
          <p role="status" className="font-medium text-emerald-900">
            {t('detailsCleared')}
            {unsent ? ` ${t('declinedUnsent', { n: unsent })}` : ''}
          </p>
        ) : (
          <Button
            variant="outline"
            size="md"
            icon={<Trash2 aria-hidden="true" className="w-4 h-4" />}
            className="w-full"
            onClick={() =>
              void vtStorage.clearClientDetails().then(({ keptUnsent }) => {
                setUnsent(keptUnsent);
                setCleared(true);
              })
            }
          >
            {t('clearEnteredDetails')}
          </Button>
        )}
      </div>
    </div>
  );
};
