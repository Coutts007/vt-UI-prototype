import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, CloudOff } from 'lucide-react';
import { ApiError } from '../../api/http';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { CodeInput } from '../../components/ui/CodeInput';
import { NumberInput } from '../../components/ui/NumberInput';
import { ProgressSteps } from '../../components/ui/data';
import { Field, RadioCards } from '../../components/ui/forms';
import { vtStorage } from '../../db/storage';
import { useI18n } from '../../i18n';

const CODE = /^[A-Z]{2}[0-9]{4}$/;
type Sex = 'female' | 'male' | 'unspecified';
type Fit = 'fitted' | 'loose';
type CodeState = 'idle' | 'checking' | 'verified' | 'unverified' | 'unknown';

export const validHeight = (cm: number) => Number.isInteger(cm) && cm >= 120 && cm <= 220;

export const StartView: React.FC<{ onNavigate: (path: string) => void; initialCode?: string }> = ({
  onNavigate,
  initialCode,
}) => {
  const { t } = useI18n();
  const [code, setCode] = useState(initialCode ?? '');
  const [codeState, setCodeState] = useState<CodeState>('idle');
  const [tailor, setTailor] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [height, setHeight] = useState(0);
  const [heightByTailor, setHeightByTailor] = useState(false);
  const [heightError, setHeightError] = useState<string | null>(null);
  const [sex, setSex] = useState<Sex | ''>('');
  const [sexError, setSexError] = useState<string | null>(null);
  const [fit, setFit] = useState<Fit>('fitted');
  const asked = useRef('');

  const verify = async (candidate: string) => {
    if (!CODE.test(candidate) || asked.current === candidate) return;
    asked.current = candidate;
    setCodeError(null);
    if (!navigator.onLine) {
      setCodeState('unverified');
      setTailor(null);
      return;
    }
    setCodeState('checking');
    try {
      const reply = await apiClient.get('/client-codes/{code}', { path: { code: candidate } });
      if (asked.current !== candidate) return;
      setCodeState('verified');
      setTailor(reply.tailor_business_name);
      if (reply.height_mm) {
        setHeight(Math.round(reply.height_mm / 10));
        setHeightByTailor(true);
      }
    } catch (error) {
      if (asked.current !== candidate) return;
      setTailor(null);
      if (error instanceof ApiError && error.status === 404) {
        setCodeState('unknown');
        setCodeError(t('clientCodeError'));
      } else {
        // Offline or rate limited: accepted for now and checked at sync (D8).
        setCodeState('unverified');
      }
    }
  };

  useEffect(() => {
    let live = true;
    void vtStorage.loadDraft().then((draft) => {
      if (!live) return;
      const saved = initialCode || draft.client_code || '';
      if (saved) {
        setCode(saved);
        void verify(saved);
      }
      if (draft.height_mm) setHeight(Math.round(draft.height_mm / 10));
      if (draft.sex) setSex(draft.sex);
      if (draft.clothing_fit) setFit(draft.clothing_fit);
      setRestored(true);
    });
    return () => {
      live = false;
    };
    // Only on arrival: typing is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  // What is typed survives a reload (9.2). A code is only kept once it is complete.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!restored) return;
    vtStorage.saveDraft({
      ...vtStorage.getDraft(),
      client_code: CODE.test(code) ? code : undefined,
      height_mm: height > 0 ? height * 10 : undefined,
      sex: sex || undefined,
      clothing_fit: fit,
    });
  }, [restored, code, height, sex, fit]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    let ok = true;
    if (!CODE.test(code) || codeState === 'unknown') {
      setCodeError(t('clientCodeError'));
      ok = false;
    }
    if (!validHeight(height)) {
      setHeightError(t('heightError'));
      ok = false;
    }
    if (!sex) {
      setSexError(t('sexRequired'));
      ok = false;
    }
    if (!ok || !sex) return;
    vtStorage.saveDraft({
      ...vtStorage.getDraft(),
      client_code: code,
      code_verified: codeState === 'verified',
      height_mm: height * 10,
      sex,
      clothing_fit: fit,
    });
    onNavigate('/consent');
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-6 flex flex-col gap-5">
      <ProgressSteps current={0} />
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t('detailsTitle')}</h1>
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <div>
          <p className="font-semibold">{t('clientCodeLabel')}</p>
          <p className="text-sm text-[var(--vt-ink-muted)] mb-2">{t('clientCodeHint')}</p>
          <CodeInput
            value={code}
            onChange={(next) => {
              setCode(next);
              setCodeError(null);
              setCodeState('idle');
              setTailor(null);
              asked.current = '';
              if (next.length === 6) {
                if (CODE.test(next)) void verify(next);
                else setCodeError(t('clientCodeError'));
              }
            }}
            onBlur={() => void verify(code)}
            error={codeError ?? undefined}
          />
          {codeState === 'checking' && <p className="text-sm mt-2">{t('codeChecking')}</p>}
          {codeState === 'verified' && tailor && (
            <p className="mt-2 flex items-center gap-2 text-sm font-medium text-emerald-900">
              <CheckCircle2 aria-hidden="true" className="w-4 h-4 shrink-0" />
              <span>
                {t('codeFromTailor')}: <strong>{tailor}</strong>
              </span>
            </p>
          )}
          {codeState === 'unverified' && (
            <p className="mt-2 flex items-center gap-2 text-sm">
              <CloudOff aria-hidden="true" className="w-4 h-4 shrink-0" />
              <span>{t('offlineCodeNotice')}</span>
            </p>
          )}
        </div>

        <Field label={t('heightLabel')} hint={t('heightHint')} error={heightError ?? undefined}>
          {(field) => (
            <>
              <NumberInput
                {...field}
                value={height}
                onChange={(next) => {
                  setHeight(next);
                  setHeightError(null);
                  setHeightByTailor(false);
                }}
                min={120}
                max={220}
                unit="cm"
                onOfferConvert={setHeight}
              />
              {heightByTailor && (
                <p className="text-sm font-medium text-emerald-900 mt-1">{t('heightMeasuredByTailor')}</p>
              )}
            </>
          )}
        </Field>

        <div>
          <RadioCards<Sex | ''>
            legend={t('sexLabel')}
            value={sex}
            onChange={(next) => {
              setSex(next);
              setSexError(null);
            }}
            options={[
              { value: 'female', label: t('sexFemale') },
              { value: 'male', label: t('sexMale') },
              { value: 'unspecified', label: t('sexUnspecified') },
            ]}
          />
          <p className="text-sm text-[var(--vt-ink-muted)] mt-1">{t('sexHint')}</p>
          {sexError && (
            <p role="alert" className="text-sm font-medium text-[var(--vt-fail)] mt-1">
              {sexError}
            </p>
          )}
        </div>

        <div>
          <RadioCards<Fit>
            legend={t('clothingLabel')}
            value={fit}
            onChange={setFit}
            options={[
              { value: 'fitted', label: t('clothingFitted') },
              { value: 'loose', label: t('clothingLoose') },
            ]}
          />
          {fit === 'loose' && (
            <p className="mt-2 flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
              <AlertCircle aria-hidden="true" className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{t('clothingLooseWarning')}</span>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Button type="submit" size="xl" className="w-full">
            {t('continue')}
          </Button>
          <p className="text-sm text-center text-[var(--vt-ink-muted)]">{t('consentNextNotice')}</p>
        </div>
      </form>
    </div>
  );
};
