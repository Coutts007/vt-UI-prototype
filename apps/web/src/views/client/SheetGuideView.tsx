import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, CreditCard, Download, Eye } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ProgressSteps } from '../../components/ui/data';
import { Dialog } from '../../components/ui/feedback';
import { vtStorage } from '../../db/storage';
import { useI18n } from '../../i18n';
import { ArucoMarker } from './ArucoMarker';

const CARD = 'p-4 rounded-xl border border-[var(--vt-line)] bg-white text-left flex items-start gap-3 min-h-12 cursor-pointer font-semibold';

export const SheetGuideView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const { t } = useI18n();
  const [preview, setPreview] = useState(false);
  const [printed, setPrinted] = useState(false);
  const [checked, setChecked] = useState<boolean | null>(null);
  const [remembered, setRemembered] = useState(false);

  useEffect(() => {
    void vtStorage.loadDraft().then((draft) => {
      if (draft.print_check_ok) setRemembered(true);
    });
  }, []);

  const answer = (ok: boolean) => {
    setChecked(ok);
    vtStorage.saveDraft({ ...vtStorage.getDraft(), print_check_ok: ok });
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-6 flex flex-col gap-5">
      <ProgressSteps current={2} />
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t('sheetTitle')}</h1>
      <p className="text-[var(--vt-ink-muted)]">{t('sheetIntro')}</p>

      <div className="grid grid-cols-1 gap-3">
        <div className={CARD}>
          <Check aria-hidden="true" className="w-5 h-5 shrink-0" />
          <span>{t('sheetOptionTailor')}</span>
        </div>
        <a href="/vt-measuring-sheet-A4.pdf" download onClick={() => setPrinted(true)} className={CARD}>
          <Download aria-hidden="true" className="w-5 h-5 shrink-0" />
          <span>{t('sheetOptionPrint')}</span>
        </a>
        {printed && <p className="text-sm">{t('sheetPrintHint')}</p>}
        <button type="button" onClick={() => setPreview(true)} className={CARD}>
          <Eye aria-hidden="true" className="w-5 h-5 shrink-0" />
          <span>{t('sheetOptionPreview')}</span>
        </button>
      </div>

      {!remembered && (
        <section className="p-5 rounded-2xl border border-[var(--vt-line)] bg-white">
          <h2 className="font-bold flex items-center gap-2 mb-2">
            <CreditCard aria-hidden="true" className="w-5 h-5" />
            {t('printCheckTitle')}
          </h2>
          <p className="text-sm mb-3">{t('printCheckIntro')}</p>
          <p className="font-semibold mb-3">{t('printCheckPrompt')}</p>
          <div className="grid grid-cols-2 gap-3">
            <Button variant={checked === true ? 'primary' : 'outline'} aria-pressed={checked === true} onClick={() => answer(true)}>
              {t('printCheckYes')}
            </Button>
            <Button variant={checked === false ? 'danger' : 'outline'} aria-pressed={checked === false} onClick={() => answer(false)}>
              {t('printCheckNo')}
            </Button>
          </div>
          {checked === false && (
            <p role="alert" className="mt-3 flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-900">
              <AlertCircle aria-hidden="true" className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{t('printCheckFailedAlert')}</span>
            </p>
          )}
        </section>
      )}

      <p className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">{t('sheetTips')}</p>

      <Button onClick={() => onNavigate('/setup')} disabled={!remembered && checked !== true} size="xl" className="w-full">
        {t('continue')}
      </Button>

      <Dialog title={t('sheetOptionPreview')} open={preview} onClose={() => setPreview(false)}>
        <div className="border border-[var(--vt-line)] rounded-lg p-4 flex flex-col items-center gap-3 bg-white aspect-[1/1.414]">
          <p className="text-xs font-bold text-center">{t('sheetWords')}</p>
          <ArucoMarker label={t('sheetMarkerLabel')} size={180} />
          <div className="w-3/4 h-1 bg-black" />
          <p className="text-xs">{t('sheetLineLabel')}</p>
          <div className="w-32 h-20 border-2 border-dashed border-black flex items-center justify-center text-xs text-center">
            {t('sheetCardLabel')}
          </div>
        </div>
      </Dialog>
    </div>
  );
};
