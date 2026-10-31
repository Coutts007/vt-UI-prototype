import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { visionAvailable } from '../../vision/client';
import { CAPTURE_CONFIG } from '../../capture/config';
import {
  PreflightItem,
  Verdict,
  deviceSummary,
  gatherFacts,
  overallVerdict,
  runPreflight,
} from '../../capture/preflight';
import { Button } from '../../components/ui/Button';
import { ProgressSteps } from '../../components/ui/data';
import { Skeleton } from '../../components/ui/feedback';
import { vtStorage } from '../../db/storage';
import { useI18n } from '../../i18n';

const ICONS = {
  pass: <CheckCircle2 aria-hidden="true" className="w-5 h-5 text-emerald-700 shrink-0" />,
  caution: <AlertTriangle aria-hidden="true" className="w-5 h-5 text-amber-700 shrink-0" />,
  fail: <XCircle aria-hidden="true" className="w-5 h-5 text-rose-700 shrink-0" />,
};

export const PhoneCheckView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const { t } = useI18n();
  const [items, setItems] = useState<PreflightItem[] | null>(null);
  const [verdict, setVerdict] = useState<Verdict>('ready');
  const [showLink, setShowLink] = useState(false);

  const run = async () => {
    setItems(null);
    const facts = await gatherFacts(CAPTURE_CONFIG.timing.motionWaitMs);
    const results = runPreflight(facts);
    setItems(results);
    setVerdict(overallVerdict(results));
    await vtStorage.loadDraft();
    vtStorage.saveDraft({ ...vtStorage.getDraft(), preflight: deviceSummary(facts) });
  };

  useEffect(() => {
    void run();
  }, []);

  const status = (item: PreflightItem) =>
    t(item.status === 'pass' ? 'pfPass' : item.status === 'caution' ? 'pfCaution' : 'pfFail');

  return (
    <div className="max-w-xl mx-auto px-4 py-6 flex flex-col gap-5">
      <ProgressSteps current={2} />
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t('checkTitle')}</h1>
      {!items ? (
        <Skeleton />
      ) : (
        <>
          <div
            role="status"
            className={`p-4 rounded-2xl border flex items-center gap-3 font-bold text-lg ${
              verdict === 'ready'
                ? 'bg-emerald-50 border-emerald-200'
                : verdict === 'caution'
                  ? 'bg-amber-50 border-amber-200'
                  : 'bg-rose-50 border-rose-200'
            }`}
          >
            {ICONS[verdict === 'ready' ? 'pass' : verdict]}
            <span>{t(!visionAvailable() ? 'captureUnavailable' : verdict === 'ready' ? 'checkReady' : verdict === 'caution' ? 'checkCaution' : 'checkFail')}</span>
          </div>
          <ul className="rounded-2xl border border-[var(--vt-line)] bg-white divide-y divide-[var(--vt-line)]">
            {items.map((item) => (
              <li key={item.id} className="p-3.5 flex items-start gap-3">
                {ICONS[item.status]}
                <span className="flex-1">
                  <span className="font-semibold block">{t(item.label)}</span>
                  <span className="text-sm text-[var(--vt-ink-muted)]">
                    {item.id === 'models'
                      ? t('willDownloadMB', { mb: 15 })
                      : item.message
                        ? t(item.message)
                        : status(item)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-3">
            <Button onClick={() => onNavigate('/sheet')} disabled={verdict === 'fail'} size="xl" className="w-full">
              {t('continue')}
            </Button>
            {verdict === 'fail' && visionAvailable() && (
              <>
                <Button variant="outline" onClick={() => onNavigate('/help')} className="w-full">
                  {t('askTailorInPerson')}
                </Button>
                <Button variant="outline" onClick={() => setShowLink(true)} className="w-full">
                  {t('tryAnotherPhone')}
                </Button>
                {showLink && <p className="text-sm break-all text-center">{window.location.origin}</p>}
              </>
            )}
            <Button variant="text" onClick={() => void run()} className="w-full">
              {t('checkAgain')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
