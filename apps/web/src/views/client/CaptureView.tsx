import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Camera, Check, Circle, HelpCircle, Volume2, VolumeX, X } from 'lucide-react';
import { voiceGuide } from '../../capture/audio';
import { CameraManager } from '../../capture/camera';
import { CheckId } from '../../capture/checks';
import { CaptureRunner, RunnerSnapshot } from '../../capture/runner';
import { attachRunner, detachRunner, stopRunner } from '../../capture/runnerHost';
import { captureSession } from '../../capture/session';
import { Button } from '../../components/ui/Button';
import { LevelBubble } from '../../components/ui/LevelBubble';
import { Dialog } from '../../components/ui/feedback';
import { LangToggle } from '../../components/ui/forms';
import { vtStorage } from '../../db/storage';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';

type View = 'front' | 'side';

// Seven rows (9.7). "Person found" shows as part of the whole-body row, and stability only as "Hold still".
const ROWS: { key: TranslationKey; checks: CheckId[] }[] = [
  { key: 'checkLevel', checks: ['level'] },
  { key: 'checkWholeBody', checks: ['person', 'frame'] },
  { key: 'checkDistance', checks: ['distance'] },
  { key: 'checkFacing', checks: ['facing'] },
  { key: 'checkArms', checks: ['arms'] },
  { key: 'checkSheet', checks: ['sheet'] },
  { key: 'checkLightSharp', checks: ['light'] },
];

const BORDER = { ok: 'border-emerald-500', wait: 'border-amber-400', stop: 'border-rose-600' };
const EMPTY_SNAPSHOT: RunnerSnapshot = {
  results: null,
  instruction: null,
  border: 'stop',
  walkLeft: null,
  countdown: null,
  transitionLeft: null,
  shutterReady: false,
  tilt: { beta: 90, gamma: 0 },
};
const noSubscribe = () => () => {};

/** The target outline: one hand holds the sheet, the other arm hangs clear of the body (A14). */
const Outline: React.FC<{ view: View; label: string; sheetLabel: string }> = ({ view, label, sheetLabel }) => (
  <svg viewBox="0 0 200 400" role="img" aria-label={label} className="h-[52vh] w-auto">
    <g stroke="#fff" strokeWidth="2.5" strokeDasharray="5,4" fill="none" opacity="0.7">
      <ellipse cx="100" cy="36" rx="18" ry="24" />
      {view === 'front' ? (
        <>
          <path d="M70 66 H130 L136 200 L128 372 H106 L100 230 L94 372 H72 L64 200 Z" />
          <path d="M70 70 L44 130 L84 140" />
          <path d="M130 70 L164 150 L170 210" />
        </>
      ) : (
        <>
          <path d="M84 66 H118 L124 200 L118 372 H90 L84 200 Z" />
          <path d="M106 72 L124 150 L136 210" />
        </>
      )}
      <rect x="75" y={view === 'front' ? 96 : 176} width="50" height="50" stroke="#7dd3fc" />
    </g>
    <text x="100" y={view === 'front' ? 126 : 206} fill="#7dd3fc" fontSize="10" textAnchor="middle" fontWeight="bold">
      {sheetLabel}
    </text>
  </svg>
);

export const CaptureView: React.FC<{ view: View; onNavigate: (path: string) => void }> = ({ view, onNavigate }) => {
  const { locale, t } = useI18n();
  const machine = useSyncExternalStore(captureSession.subscribe, captureSession.getMachine);
  const [runner, setRunner] = useState<CaptureRunner | null>(null);
  const snapshot = useSyncExternalStore(
    runner?.subscribe ?? noSubscribe,
    runner?.getSnapshot ?? (() => EMPTY_SNAPSHOT),
  );
  const [muted, setMuted] = useState(voiceGuide.getMuted());
  const [askStop, setAskStop] = useState(false);
  const [help, setHelp] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { state, context } = machine;

  voiceGuide.setLocaleSource(() => locale);

  useEffect(() => {
    if (['idle', 'permissions', 'leveling', 'saved', 'discarded'].includes(state.name)) {
      onNavigate('/setup');
      return;
    }
    let live = true;
    void vtStorage.loadDraft().then(async (draft) => {
      const host = await attachRunner(draft.height_mm ?? 1700);
      if (live && host) setRunner(host.runner);
    });
    return () => {
      live = false;
      detachRunner();
    };
    // Once per screen: the runner outlives the move from front to side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which screen matches the machine.
  useEffect(() => {
    if (state.name === 'computing') onNavigate('/processing');
    else if ('view' in state && state.view !== view && state.name !== 'viewDone') {
      onNavigate(`/capture/${state.view}`);
    }
  }, [state, view, onNavigate]);

  // The preview only. No frame is read from this stream until M6.
  useEffect(() => {
    const camera = new CameraManager();
    if (videoRef.current) void camera.start(videoRef.current).catch(() => {});
    return () => camera.stop();
  }, []);

  // Keep the screen on, and ask again when the phone comes back (9.7).
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = () => {
      if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
      void navigator.wakeLock.request('screen').then((next) => (lock = next)).catch(() => {});
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => {});
    };
  }, []);

  const stop = () => {
    captureSession.send({ type: 'STOP' });
    stopRunner();
    voiceGuide.stop();
    void document.exitFullscreen?.().catch(() => {});
    onNavigate(captureSession.machine.state.name === 'review' ? '/review' : '/setup');
  };

  if (state.name === 'error') {
    return (
      <main className="fixed inset-0 z-50 bg-[#0E0E10] text-white flex flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-bold">{t('captureUnavailable')}</h1>
        <Button variant="outline" onClick={() => onNavigate('/setup')}>
          {t('back')}
        </Button>
      </main>
    );
  }

  const rowState = (checks: CheckId[]) => {
    if (!snapshot.results || state.name === 'walkAway') return 'wait';
    return checks.every((id) => snapshot.results![id]) ? 'pass' : 'fail';
  };
  const message = (): string => {
    if (state.name === 'burst') return t('holdStill');
    if (state.name === 'viewDone') return t('done');
    if (snapshot.instruction) return t(snapshot.instruction);
    return snapshot.results ? t('holdStill') : t('checksStarting');
  };

  return (
    <main
      className={`fixed inset-0 z-50 bg-[#0E0E10] text-white flex flex-col select-none border-[16px] ${BORDER[snapshot.border]}`}
      data-state={state.name}
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1 bg-black/70 z-30">
        <div className="bg-white text-black rounded-lg">
          <LangToggle />
        </div>
        <h1 className="text-sm font-semibold text-center">{view === 'front' ? t('frontViewTitle') : t('sideViewTitle')}</h1>
        <button type="button" aria-label={t('stopMeasuringConfirm')} onClick={() => setAskStop(true)} className="min-h-12 min-w-12 flex items-center justify-center cursor-pointer">
          <X aria-hidden="true" className="w-6 h-6" />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden flex items-center justify-center">
        <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-contain" />
        <div className="relative z-10 pointer-events-none">
          <Outline view={view} label={t('outlineLabel')} sheetLabel={t('sheetHere')} />
        </div>

        <ul aria-label={t('checksLabel')} className="absolute left-1 top-1 z-20 p-1.5 rounded-lg bg-black/70 text-xs space-y-0.5 max-w-[46%]">
          {ROWS.map((row) => {
            const rowResult = rowState(row.checks);
            return (
              <li key={row.key} className="flex items-center gap-1" data-check={row.key} data-result={rowResult}>
                {rowResult === 'pass' && <Check aria-hidden="true" className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                {rowResult === 'fail' && <X aria-hidden="true" className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
                {rowResult === 'wait' && <Circle aria-hidden="true" className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
                <span>{t(row.key)}</span>
                <span className="sr-only">
                  {t(rowResult === 'pass' ? 'pfPass' : rowResult === 'fail' ? 'pfFail' : 'pfWaiting')}
                </span>
              </li>
            );
          })}
        </ul>

        <div aria-hidden="true" className="absolute right-1 top-1 z-20 p-1 rounded-lg bg-black/70">
          <LevelBubble beta={snapshot.tilt.beta} gamma={snapshot.tilt.gamma} size="sm" />
        </div>

        <div className="absolute bottom-2 inset-x-1 z-30 text-center">
          <p
            role="status"
            data-testid="instruction"
            className="inline-block bg-black/85 rounded-2xl px-3 py-2 font-black leading-tight text-[clamp(28px,9vw,56px)]"
          >
            {message()}
          </p>
        </div>

        {snapshot.walkLeft !== null && (
          <div className="absolute inset-0 z-40 bg-black/80 flex flex-col items-center justify-center p-6 text-center" data-testid="walk">
            <p className="text-3xl font-bold">{t('walkToWallCountdown', { n: snapshot.walkLeft })}</p>
            <p className="mt-3">{t('walkAwayPrompt')}</p>
          </div>
        )}
        {snapshot.countdown !== null && (
          <div className="absolute inset-0 z-40 bg-black/40 flex items-center justify-center">
            <span data-testid="countdown" className="text-[9rem] font-black text-emerald-300 leading-none">
              {snapshot.countdown}
            </span>
          </div>
        )}
        {snapshot.transitionLeft !== null && (
          <div className="absolute inset-0 z-40 bg-black/85 flex flex-col items-center justify-center p-6 text-center" data-testid="turn">
            <p className="text-2xl font-bold leading-snug">{t('sideViewTransition')}</p>
            <p className="text-5xl font-black mt-4">{snapshot.transitionLeft}</p>
          </div>
        )}
      </div>

      <div className="bg-black/80 px-2 py-2 z-30">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setHelp(true)} className="min-h-12 px-2 flex items-center gap-1 text-sm cursor-pointer">
            <HelpCircle aria-hidden="true" className="w-5 h-5" />
            <span>{t('helpShort')}</span>
          </button>
          {context.mode === 'assisted' ? (
            <button
              type="button"
              aria-label={t('takePhoto')}
              disabled={!snapshot.shutterReady || state.name !== 'checking'}
              onClick={() => captureSession.send({ type: 'SHUTTER' })}
              className="w-[72px] h-[72px] rounded-full border-4 border-white bg-emerald-700 disabled:opacity-40 flex items-center justify-center cursor-pointer"
            >
              <Camera aria-hidden="true" className="w-8 h-8" />
            </button>
          ) : (
            <p className="text-xs text-center flex-1">{t('autoCaptureNotice')}</p>
          )}
          <button
            type="button"
            onClick={() => {
              voiceGuide.setMuted(!muted);
              setMuted(!muted);
            }}
            className="min-h-12 px-2 flex items-center gap-1 text-sm cursor-pointer"
          >
            {muted ? <VolumeX aria-hidden="true" className="w-5 h-5" /> : <Volume2 aria-hidden="true" className="w-5 h-5" />}
            <span>{muted ? t('unmuteToggle') : t('muteToggle')}</span>
          </button>
        </div>
        {context.mode === 'assisted' && view === 'side' && state.name === 'checking' && (
          <button type="button" onClick={() => captureSession.send({ type: 'FLIP_VIEW' })} className="min-h-12 w-full underline text-sm cursor-pointer">
            {t('flipView')}
          </button>
        )}
        <p className="text-center text-xs mt-1">{t('captureFooter')}</p>
      </div>

      <Dialog title={t('stopMeasuringConfirm')} open={askStop} onClose={() => setAskStop(false)}>
        <div className="flex gap-3 text-[var(--vt-ink)]">
          <Button variant="outline" className="flex-1" onClick={() => setAskStop(false)}>
            {t('cancel')}
          </Button>
          <Button variant="danger" className="flex-1" onClick={stop}>
            {t('stopMeasuring')}
          </Button>
        </div>
      </Dialog>
      <Dialog title={t('helpTitle')} open={help} onClose={() => setHelp(false)}>
        <p className="text-[var(--vt-ink)]">{t(view === 'front' ? 'helpFrontBody' : 'helpSideBody')}</p>
      </Dialog>
    </main>
  );
};
