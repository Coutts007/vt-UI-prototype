import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CheckCircle2, Cpu, ShieldCheck } from 'lucide-react';
import { currentHost, stopRunner } from '../../capture/runnerHost';
import { captureSession } from '../../capture/session';
import { Button } from '../../components/ui/Button';
import type { LocalProfile } from '../../db/storage';
import { vtStorage } from '../../db/storage';
import { useI18n } from '../../i18n';

const STEPS = ['stepReadingOutline', 'stepUsingSheet', 'stepCalculatingGirths'] as const;
const STEP_MS = 500;

export const ProcessingView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const { t } = useI18n();
  const machine = useSyncExternalStore(captureSession.subscribe, captureSession.getMachine);
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(Date.now());
  const running = useRef(false);

  useEffect(() => {
    const clock = setInterval(() => setElapsed(Math.round((Date.now() - started.current) / 1000)), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    if (machine.state.name === 'error') return;
    if (machine.state.name !== 'computing') {
      onNavigate(machine.state.name === 'review' ? '/review' : '/');
      return;
    }
    if (running.current) return;
    running.current = true;
    const run = async () => {
      const host = await currentHost();
      const speed = host?.speed ?? 1;
      for (let i = 1; i <= STEPS.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, STEP_MS * speed));
        setStep(i);
      }
      let profile: LocalProfile;
      let disagreeing: 'front' | 'side' | null;
      try {
        const { buildProfile, disagreeingView, readProfiles } = await import('../../capture/compute');
        // First, so a crash below cannot lose the masks' numbers when they are released (A5 F1).
        readProfiles(captureSession);
        await host?.vision.compute();
        const draft = await vtStorage.loadDraft();
        profile = buildProfile(captureSession, draft, Date.now() - started.current);
        disagreeing = disagreeingView(captureSession, profile.session.scale_disagreement_pct);
      } catch {
        running.current = false;
        captureSession.send({ type: 'WORKER_CRASH' });
        // Still computing after the first crash: run again from the stored burst (9.9).
        if (captureSession.machine.state.name === 'computing') {
          void run();
        } else {
          captureSession.releaseMasks();
          stopRunner();
        }
        return;
      }
      captureSession.profile = profile;
      captureSession.releaseMasks();
      stopRunner();
      captureSession.send({ type: 'COMPUTED' });
      captureSession.send(disagreeing ? { type: 'SCALE_DISAGREE', view: disagreeing } : { type: 'SCALE_OK' });
      onNavigate('/review');
    };
    void run();
    // Runs for the computing state only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine.state.name]);

  if (machine.state.name === 'error') {
    const retake = (view: 'front' | 'side') => {
      captureSession.send({ type: 'RETAKE', view });
      captureSession.send({ type: 'BEGIN_RETAKE' });
      onNavigate(`/capture/${view}`);
    };
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center max-w-md mx-auto px-4 text-center gap-4">
        <h1 className="text-2xl font-extrabold">{t('processingFailed')}</h1>
        <div className="grid grid-cols-2 gap-3 w-full">
          <Button variant="outline" onClick={() => retake('front')}>
            {t('retakeFront')}
          </Button>
          <Button variant="outline" onClick={() => retake('side')}>
            {t('retakeSide')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center max-w-md mx-auto px-4 py-8 text-center">
      <Cpu aria-hidden="true" className="w-12 h-12 text-[var(--vt-thread)] mb-5" />
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-2">{t('processingTitle')}</h1>
      <p className="text-sm mb-6 tabular-nums">{t('processingElapsed', { n: elapsed })}</p>
      <ol className="w-full bg-white rounded-2xl border border-[var(--vt-line)] p-5 flex flex-col gap-3 text-left mb-6">
        {STEPS.map((key, index) => (
          <li key={key} className="flex items-center gap-3 font-semibold">
            {step > index ? (
              <CheckCircle2 aria-hidden="true" className="w-5 h-5 text-emerald-700 shrink-0" />
            ) : (
              <span aria-hidden="true" className="w-5 h-5 rounded-full border-2 border-slate-400 shrink-0" />
            )}
            <span>{t(key)}</span>
            <span className="sr-only">{t(step > index ? 'done' : 'pfWaiting')}</span>
          </li>
        ))}
      </ol>
      <p className="flex items-center gap-2 text-sm text-emerald-900">
        <ShieldCheck aria-hidden="true" className="w-4 h-4 shrink-0" />
        <span>{t('processingTargetNotice')}</span>
      </p>
    </div>
  );
};
