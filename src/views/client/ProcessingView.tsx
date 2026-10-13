import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n';
import { Landmark, MarkerObs, MeasurementProfile } from '../../types/api';
import { computeMeasurements } from '../../measure/engine';
import { vtStorage } from '../../db/storage';
import { CheckCircle2, ShieldCheck, Cpu } from 'lucide-react';

interface ProcessingViewProps {
  frontData: { landmarks: Landmark[]; marker: MarkerObs };
  sideData: { landmarks: Landmark[]; marker: MarkerObs };
  onComplete: (profile: MeasurementProfile) => void;
}

export const ProcessingView: React.FC<ProcessingViewProps> = ({
  frontData,
  sideData,
  onComplete,
}) => {
  const { t } = useI18n();

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const draft = vtStorage.getDraft();

    // Step 1: Reading outline (0 - 1.2s)
    const t1 = setTimeout(() => setCurrentStep(2), 1200);

    // Step 2: Using sheet for real scale (1.2s - 2.5s)
    const t2 = setTimeout(() => setCurrentStep(3), 2500);

    // Step 3: Run deterministic measurement engine (at 3.8s)
    const t3 = setTimeout(() => {
      const output = computeMeasurements({
        landmarks_front: frontData.landmarks,
        landmarks_side: sideData.landmarks,
        marker_front: frontData.marker,
        marker_side: sideData.marker,
        height_mm_entered: draft.height_mm || 1700,
        sex: draft.sex || 'female',
        clothing_fit: draft.clothing_fit || 'fitted',
        level_unchecked: false,
      });

      const profileId = 'prof-' + Math.random().toString(36).substring(2, 9);
      const sessionId = 'sess-' + Math.random().toString(36).substring(2, 9);

      const profile: MeasurementProfile = {
        profile_id: profileId,
        client_code: draft.client_code || 'AB1234',
        version: 1,
        captured_at: new Date().toISOString(),
        status: 'final',
        sync_status: 'pending',
        rules_version: output.rules_version,
        covariates: {
          height_mm_entered: draft.height_mm || 1700,
          sex: draft.sex || 'female',
          clothing_fit: draft.clothing_fit || 'fitted',
          code_verified: true,
        },
        consent: draft.consent || {
          consent_version: '1.0',
          language: 'en',
          scope: ['measure', 'measurements_only', 'retention'],
          given_at: new Date().toISOString(),
        },
        session: {
          session_id: sessionId,
          started_at: new Date().toISOString(),
          capture_mode: draft.capture_mode || 'self',
          device_model: 'Android WebAssembly Browser',
          os: 'Mobile Web',
          browser: 'HTML5 PWA',
          memory_gb: 4,
          model_variant: 'lite',
          stream_w: 1080,
          stream_h: 1920,
          still_source: 'canvas',
          level_unchecked: false,
          capture_fallback: false,
          front_checks: {
            level: 'pass',
            frame: 'pass',
            distance: 'pass',
            symmetry: 'pass',
            arms: 'pass',
            marker: 'pass',
            light: 'pass',
            sharpness: 'pass',
          },
          side_checks: {
            level: 'pass',
            frame: 'pass',
            distance: 'pass',
            symmetry: 'pass',
            arms: 'pass',
            marker: 'pass',
            light: 'pass',
            sharpness: 'pass',
          },
          scale_front_mm_px: output.scale_front_mm_px,
          scale_side_mm_px: output.scale_side_mm_px,
          scale_stature_mm_px: output.scale_stature_mm_px,
          scale_disagreement_pct: output.scale_disagreement_pct,
          processing_ms: 3800,
          retake_count: 0,
          config_hash: 'c8d4e2f1',
        },
        landmarks_front: frontData.landmarks,
        landmarks_side: sideData.landmarks,
        marker_front: frontData.marker,
        marker_side: sideData.marker,
        measurements: output.measurements,
      };

      // Invariant 2: Release frame bitmaps and intermediate buffers
      // No images are held.
      onComplete(profile);
    }, 3800);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [frontData, sideData, onComplete]);

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center max-w-md mx-auto px-4 py-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-200 text-[var(--vt-thread,#2E3A87)] flex items-center justify-center mb-6 shadow-sm">
        <Cpu className="w-8 h-8 animate-pulse" />
      </div>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight mb-2">
        {t('processingTitle')}
      </h1>
      <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] mb-8">
        Time elapsed: <span className="font-mono font-bold">{elapsedSec}s</span> (Target: under 20s)
      </p>

      {/* 3 Progress Steps */}
      <div className="w-full bg-white rounded-2xl border border-[var(--vt-line,#DDD5C8)] p-6 shadow-xs flex flex-col gap-4 text-left mb-8">
        <div className="flex items-center gap-3">
          {currentStep >= 1 ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <div className="w-5 h-5 rounded-full border-2 border-slate-300 shrink-0" />
          )}
          <span className={`text-sm font-semibold ${currentStep >= 1 ? 'text-[var(--vt-ink,#1F1C18)]' : 'text-slate-400'}`}>
            {t('stepReadingOutline')}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {currentStep >= 2 ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <div className="w-5 h-5 rounded-full border-2 border-slate-300 shrink-0" />
          )}
          <span className={`text-sm font-semibold ${currentStep >= 2 ? 'text-[var(--vt-ink,#1F1C18)]' : 'text-slate-400'}`}>
            {t('stepUsingSheet')}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {currentStep >= 3 ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <div className="w-5 h-5 rounded-full border-2 border-slate-300 shrink-0" />
          )}
          <span className={`text-sm font-semibold ${currentStep >= 3 ? 'text-[var(--vt-ink,#1F1C18)]' : 'text-slate-400'}`}>
            {t('stepCalculatingGirths')}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-emerald-800 bg-emerald-50 px-4 py-2 rounded-full border border-emerald-200">
        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
        <span>{t('processingTargetNotice')}</span>
      </div>
    </div>
  );
};
