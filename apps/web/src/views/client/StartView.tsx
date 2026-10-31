import React, { useState, useEffect } from 'react';
import { FEATURE_DIRECTORY } from '../../config/features';
import { useI18n } from '../../i18n';
import { Button } from '../../components/ui/Button';
import { CodeInput } from '../../components/ui/CodeInput';
import { NumberInput } from '../../components/ui/NumberInput';
import { api } from '../../api/client';
import { vtStorage } from '../../db/storage';
import { ShieldCheck, AlertCircle, CheckCircle2, User, Sparkles } from 'lucide-react';

interface StartViewProps {
  onNavigate: (path: string) => void;
  initialCode?: string;
}

export const StartView: React.FC<StartViewProps> = ({ onNavigate, initialCode }) => {
  const { t } = useI18n();

  const [code, setCode] = useState(initialCode || '');
  const [codeVerified, setCodeVerified] = useState(false);
  const [tailorName, setTailorName] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);

  const [height, setHeight] = useState<number>(170);
  const [heightPreFilled, setHeightPreFilled] = useState(false);
  const [heightError, setHeightError] = useState<string | null>(null);

  const [sex, setSex] = useState<'female' | 'male' | 'unspecified'>('female');
  const [clothingFit, setClothingFit] = useState<'fitted' | 'loose'>('fitted');

  // Load existing draft
  useEffect(() => {
    const draft = vtStorage.getDraft();
    if (draft.client_code && !initialCode) setCode(draft.client_code);
    if (draft.height_mm) setHeight(draft.height_mm / 10);
    if (draft.sex) setSex(draft.sex);
    if (draft.clothing_fit) setClothingFit(draft.clothing_fit);
  }, [initialCode]);

  // Code verification
  const handleVerifyCode = async (codeToVerify: string) => {
    if (!codeToVerify || codeToVerify.length < 6) {
      setCodeVerified(false);
      setTailorName(null);
      return;
    }
    const formatRegex = /^[A-Z]{2}[0-9]{4}$/;
    if (!formatRegex.test(codeToVerify)) {
      setCodeError(t('clientCodeError'));
      setCodeVerified(false);
      return;
    }

    setCodeError(null);
    setIsVerifyingCode(true);

    try {
      const res = await api.verifyClientCode(codeToVerify);
      setCodeVerified(true);
      setTailorName(res.tailor_business_name);
      if (res.height_mm) {
        setHeight(res.height_mm / 10);
        setHeightPreFilled(true);
      }
    } catch {
      // Offline fallback: accept valid format if network is unreachable
      if (formatRegex.test(codeToVerify)) {
        setCodeVerified(true);
        setTailorName('Tailor Code (Offline check)');
      } else {
        setCodeError(t('clientCodeError'));
      }
    } finally {
      setIsVerifyingCode(false);
    }
  };

  useEffect(() => {
    if (initialCode) {
      setCode(initialCode);
      if (initialCode.length === 6) {
        handleVerifyCode(initialCode);
      }
    }
  }, [initialCode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate Code
    const cleanCode = code.trim().toUpperCase();
    if (!/^[A-Z]{2}[0-9]{4}$/.test(cleanCode)) {
      setCodeError(t('clientCodeError'));
      return;
    }

    // Validate Height (120 to 220 cm)
    if (height < 120 || height > 220) {
      setHeightError(t('heightError'));
      return;
    }

    // Save draft to storage
    vtStorage.saveDraft({
      client_code: cleanCode,
      height_mm: Math.round(height * 10),
      sex,
      clothing_fit: clothingFit,
    });

    onNavigate('/consent');
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-6 sm:py-8">
      {/* Progress step header */}
      <div className="flex items-center justify-between text-xs font-semibold text-[var(--vt-ink-muted,#5C554C)] mb-6 uppercase tracking-wider">
        <span>Step 1 of 5 · Details</span>
        <span>Consent is next</span>
      </div>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight mb-2">
        {t('detailsTitle')}
      </h1>
      <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mb-8">
        Enter the code your tailor gave you and your height. Photos never leave your phone.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {/* 1. Client Code */}
        <div className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs">
          <label className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] block mb-1">
            {t('clientCodeLabel')}
          </label>
          <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] block mb-3">
            {t('clientCodeHint')}
          </span>

          <CodeInput
            value={code}
            onChange={(val) => {
              setCode(val);
              if (codeError) setCodeError(null);
              if (val.length === 6) handleVerifyCode(val);
            }}
            onBlur={() => handleVerifyCode(code)}
            error={codeError || undefined}
          />

          {isVerifyingCode && (
            <span className="text-xs text-sky-600 mt-2 block animate-pulse">
              Checking code with tailor...
            </span>
          )}

          {codeVerified && tailorName && (
            <div className="mt-3 flex items-center justify-between p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-medium">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  {t('codeFromTailor')}: <strong>{tailorName}</strong>
                </span>
              </div>
              {FEATURE_DIRECTORY && (
<button
                type="button"
                onClick={() => onNavigate('/tailors')}
                className="text-[11px] text-emerald-700 hover:text-emerald-900 underline font-semibold ml-2 shrink-0 cursor-pointer"
              >
                Change Tailor
              </button>
)}
            </div>
          )}

          {/* Directory helper link */}
          <div className="mt-3 pt-3 border-t border-[var(--vt-line,#DDD5C8)]/60 flex items-center justify-between text-xs">
            {FEATURE_DIRECTORY && (
              <span className="text-[var(--vt-ink-muted,#5C554C)]">Don't have a tailor code yet?</span>
            )}
            {FEATURE_DIRECTORY && (
<button
              type="button"
              onClick={() => onNavigate('/tailors')}
              className="text-[var(--vt-thread,#2E3A87)] font-bold hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Browse tailors &amp; get code</span>
            </button>
)}
          </div>
        </div>

        {/* 2. Height */}
        <div className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs">
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="start-height" className="text-sm font-bold text-[var(--vt-ink,#1F1C18)]">
              {t('heightLabel')}
            </label>
            {heightPreFilled && (
              <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-medium">
                {t('heightMeasuredByTailor')}
              </span>
            )}
          </div>
          <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] block mb-3">
            {t('heightHint')}
          </span>

          <NumberInput
            id="start-height"
            value={height}
            onChange={(val) => {
              setHeight(val);
              if (heightError) setHeightError(null);
            }}
            min={120}
            max={220}
            unit="cm"
            error={heightError || undefined}
            onOfferConvert={(cm) => setHeight(cm)}
          />
        </div>

        {/* 3. Sex */}
        <div className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs">
          <label className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] block mb-1">
            {t('sexLabel')}
          </label>
          <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] block mb-3">
            {t('sexHint')}
          </span>

          <div className="grid grid-cols-3 gap-2.5">
            {[
              { id: 'female', label: t('sexFemale') },
              { id: 'male', label: t('sexMale') },
              { id: 'unspecified', label: t('sexUnspecified') },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSex(opt.id as any)}
                className={`py-3 px-2 rounded-xl border text-xs font-semibold text-center transition-all cursor-pointer ${
                  sex === opt.id
                    ? 'border-[var(--vt-thread,#2E3A87)] bg-indigo-50/70 text-[var(--vt-thread,#2E3A87)] ring-2 ring-[var(--vt-thread,#2E3A87)]/15'
                    : 'border-[var(--vt-line,#DDD5C8)] text-[var(--vt-ink,#1F1C18)] hover:bg-[#FAF8F5]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 4. What are you wearing? */}
        <div className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs">
          <label className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] block mb-3">
            {t('clothingLabel')}
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <button
              type="button"
              onClick={() => setClothingFit('fitted')}
              className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                clothingFit === 'fitted'
                  ? 'border-[var(--vt-thread,#2E3A87)] bg-indigo-50/70 ring-2 ring-[var(--vt-thread,#2E3A87)]/15'
                  : 'border-[var(--vt-line,#DDD5C8)] hover:bg-[#FAF8F5]'
              }`}
            >
              <span className="text-xs font-bold block text-[var(--vt-ink,#1F1C18)]">
                Fitted Clothes (Recommended)
              </span>
              <span className="text-[11px] text-[var(--vt-ink-muted,#5C554C)] block mt-0.5">
                T-shirt, leggings or fitted trousers
              </span>
            </button>

            <button
              type="button"
              onClick={() => setClothingFit('loose')}
              className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                clothingFit === 'loose'
                  ? 'border-amber-400 bg-amber-50/70 ring-2 ring-amber-300'
                  : 'border-[var(--vt-line,#DDD5C8)] hover:bg-[#FAF8F5]'
              }`}
            >
              <span className="text-xs font-bold block text-[var(--vt-ink,#1F1C18)]">
                Loose Clothes
              </span>
              <span className="text-[11px] text-[var(--vt-ink-muted,#5C554C)] block mt-0.5">
                Will trigger accuracy check flag
              </span>
            </button>
          </div>

          {clothingFit === 'loose' && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{t('clothingLooseWarning')}</span>
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex flex-col gap-2 pt-2">
          <Button type="submit" size="xl" className="w-full">
            {t('continue')}
          </Button>
          <span className="text-xs text-center text-[var(--vt-ink-muted,#5C554C)]">
            {t('consentNextNotice')}
          </span>
        </div>
      </form>
    </div>
  );
};
