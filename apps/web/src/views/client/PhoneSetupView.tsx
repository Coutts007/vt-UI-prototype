import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Volume2, VolumeX } from 'lucide-react';
import { voiceGuide } from '../../capture/audio';
import {
  motionNeedsPermission,
  requestCameraPermission,
  requestMotionPermission,
  subscribeToOrientation,
  Tilt,
} from '../../capture/camera';
import { CAPTURE_CONFIG } from '../../capture/config';
import type { CaptureMode } from '../../capture/machine';
import { captureSession } from '../../capture/session';
import { Button } from '../../components/ui/Button';
import { visionAvailable } from '../../vision/client';
import { LevelBubble } from '../../components/ui/LevelBubble';
import { ProgressSteps } from '../../components/ui/data';
import { Banner } from '../../components/ui/feedback';
import { RadioCards } from '../../components/ui/forms';
import { vtStorage } from '../../db/storage';
import { useI18n } from '../../i18n';

type Step = 'download' | 'who' | 'camera' | 'motion' | 'place';
const { betaMin, betaMax, gammaMax } = CAPTURE_CONFIG.level;
const isLevel = (tilt: Tilt) => tilt.beta >= betaMin && tilt.beta <= betaMax && Math.abs(tilt.gamma) <= gammaMax;
// Laptops have no sensor. Dev and mock builds pretend the phone is level, so the flow can be tried.
const SIMULATE_LEVEL = import.meta.env.DEV || import.meta.env.MODE === 'mock';

const CARD = 'p-5 rounded-2xl border border-[var(--vt-line)] bg-white flex flex-col gap-4';

const VolumeCheck: React.FC<{ onHeard: () => void; onHelper: () => void }> = ({ onHeard, onHelper }) => {
  const { t } = useI18n();
  const [played, setPlayed] = useState(false);
  const [noes, setNoes] = useState(0);
  const play = () => {
    voiceGuide.unlock();
    voiceGuide.setMuted(false);
    voiceGuide.say('volume_test', { interrupt: true });
    setPlayed(true);
  };
  return (
    <section className={CARD} aria-label={t('volumeTitle')}>
      <h2 className="font-bold">{t('volumeTitle')}</h2>
      <Button variant="outline" onClick={play} icon={<Volume2 aria-hidden="true" className="w-5 h-5" />}>
        {t('volumePlay')}
      </Button>
      {played && (
        <>
          <p className="font-semibold">{t('volumeQuestion')}</p>
          <div className="grid grid-cols-2 gap-3">
            <Button onClick={onHeard}>{t('volumeYes')}</Button>
            <Button variant="outline" onClick={() => setNoes(noes + 1)}>
              {t('volumeNo')}
            </Button>
          </div>
        </>
      )}
      {noes > 0 && <p role="alert" className="font-medium">{t('volumeUp')}</p>}
      {noes > 1 && (
        <Button variant="outline" onClick={onHelper}>
          {t('volumeHelper')}
        </Button>
      )}
    </section>
  );
};

export const PhoneSetupView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('download');
  const [progress, setProgress] = useState<number | null>(null);
  const [mode, setMode] = useState<CaptureMode>('self');
  const [cameraIssue, setCameraIssue] = useState<'denied' | 'unavailable' | null>(null);
  const [motionDenied, setMotionDenied] = useState(false);
  const [tilt, setTilt] = useState<Tilt>({ beta: 90, gamma: 0 });
  const [sensor, setSensor] = useState<'waiting' | 'on' | 'absent'>('waiting');
  const [levelHeld, setLevelHeld] = useState(false);
  const [heard, setHeard] = useState(false);
  const [muted, setMuted] = useState(voiceGuide.getMuted());
  const levelSince = useRef<number | null>(null);

  useEffect(() => {
    if (!visionAvailable()) return;
    void vtStorage.loadDraft().then((draft) => {
      if (!draft.consent) onNavigate(draft.client_code ? '/consent' : '/start');
      else if (draft.consent.withdrawn_at) onNavigate('/consent');
      if (draft.capture_mode) setMode(draft.capture_mode);
    });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Placeholder until M6 has model files: the bar only shows how the step will look.
  const download = () => {
    setProgress(0);
    const timer = setInterval(() => {
      setProgress((value) => {
        const next = (value ?? 0) + 25;
        if (next >= 100) clearInterval(timer);
        return Math.min(next, 100);
      });
    }, 150);
  };

  const applyLevel = (next: Tilt) => {
    setTilt(next);
    if (!isLevel(next)) {
      levelSince.current = null;
      setLevelHeld(false);
      return;
    }
    levelSince.current ??= Date.now();
    if (Date.now() - levelSince.current >= CAPTURE_CONFIG.timing.levelHoldMs) {
      setLevelHeld((was) => {
        if (!was) voiceGuide.tone('chime');
        return true;
      });
    }
  };

  useEffect(() => {
    if (step !== 'place' || motionDenied) return;
    let seen = false;
    const unsubscribe = subscribeToOrientation((next) => {
      seen = true;
      setSensor('on');
      applyLevel(next);
    });
    const timer = setTimeout(() => {
      if (seen) return;
      if (SIMULATE_LEVEL) {
        setSensor('on');
        setLevelHeld(true);
      } else {
        setSensor('absent');
      }
    }, CAPTURE_CONFIG.timing.motionWaitMs);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [step, motionDenied]);

  const allowCamera = async () => {
    setCameraIssue(null);
    const { state } = captureSession.machine;
    if (state.name === 'error') captureSession.send({ type: 'RETRY' });
    else captureSession.begin(mode);
    vtStorage.saveDraft({ ...vtStorage.getDraft(), capture_mode: mode });
    voiceGuide.unlock();
    const result = await requestCameraPermission();
    if (!result.ok) {
      setCameraIssue(result.reason);
      captureSession.send({ type: result.reason === 'denied' ? 'PERMISSION_DENIED' : 'CAMERA_UNAVAILABLE' });
      return;
    }
    const draft = vtStorage.getDraft();
    if (draft.preflight && result.streamMax) {
      vtStorage.saveDraft({ ...draft, preflight: { ...draft.preflight, stream_max: result.streamMax } });
    }
    if (motionNeedsPermission()) {
      setStep('motion');
      return;
    }
    captureSession.send({ type: 'PERMISSIONS_OK' });
    setStep('place');
  };

  const allowMotion = async () => {
    const answer = await requestMotionPermission();
    if (answer === 'denied') {
      setMotionDenied(true);
      captureSession.send({ type: 'MOTION_DENIED' });
    } else {
      captureSession.send({ type: 'PERMISSIONS_OK' });
    }
    setStep('place');
  };

  const skipLevel = motionDenied || sensor === 'absent';
  const volumeOk = mode === 'assisted' || heard;
  const canStart = (levelHeld || skipLevel) && volumeOk;

  const start = () => {
    voiceGuide.unlock();
    // Fullscreen must come from the tap, and is only a nicety if the browser refuses.
    void document.documentElement.requestFullscreen?.().catch(() => {});
    captureSession.send({ type: skipLevel ? 'LEVEL_SKIPPED' : 'LEVEL_OK' });
    onNavigate('/capture/front');
  };

  const toggleMute = () => {
    voiceGuide.setMuted(!muted);
    setMuted(!muted);
  };

  // No build but dev and mock can measure before M6, so nothing here may promise otherwise.
  if (!visionAvailable()) {
    return (
      <div className="max-w-xl mx-auto px-4 py-6 flex flex-col gap-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t('setupTitle')}</h1>
        <p role="status" className="font-semibold">
          {t('captureUnavailable')}
        </p>
        <Button variant="outline" onClick={() => onNavigate('/')}>
          {t('backHome')}
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6 flex flex-col gap-5">
      <ProgressSteps current={2} />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t('setupTitle')}</h1>
        <button type="button" onClick={toggleMute} className="min-h-12 flex items-center gap-1.5 text-sm font-medium cursor-pointer">
          {muted ? <VolumeX aria-hidden="true" className="w-5 h-5" /> : <Volume2 aria-hidden="true" className="w-5 h-5" />}
          <span>{muted ? t('unmuteToggle') : t('muteToggle')}</span>
        </button>
      </div>

      {step === 'download' && (
        <section className={CARD}>
          <h2 className="font-bold">{t('modelDownloadTitle')}</h2>
          <p>{t('modelDownloadPrompt')}</p>
          {progress !== null && (
            <div>
              <div
                role="progressbar"
                aria-label={t('modelDownloadTitle')}
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-3 rounded-full bg-[var(--vt-line)] overflow-hidden"
              >
                <div className="h-full bg-[var(--vt-thread)]" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-sm mt-1 tabular-nums">{progress}%</p>
            </div>
          )}
          {progress === 100 && <p className="font-medium text-emerald-900">{t('downloadDone')}</p>}
          <div className="flex gap-3">
            {progress !== 100 ? (
              <>
                <Button onClick={download} disabled={progress !== null} className="flex-1">
                  {t('downloadNow')}
                </Button>
                <Button variant="outline" onClick={() => setStep('who')} className="flex-1">
                  {t('downloadLater')}
                </Button>
              </>
            ) : (
              <Button onClick={() => setStep('who')} className="flex-1">
                {t('continue')}
              </Button>
            )}
          </div>
        </section>
      )}

      {step === 'who' && (
        <section className={CARD}>
          <RadioCards<CaptureMode>
            legend={t('whoTakingPhotos')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'self', label: t('modeSelf') },
              { value: 'assisted', label: t('modeAssisted') },
            ]}
          />
          <Button onClick={() => setStep('camera')}>{t('continue')}</Button>
        </section>
      )}

      {step === 'camera' && (
        <section className={CARD}>
          <p>{t('allowCameraRationale')}</p>
          <Button onClick={() => void allowCamera()}>{cameraIssue ? t('retry') : t('allowCamera')}</Button>
          {cameraIssue === 'denied' && (
            <div role="alert" className="text-sm space-y-1">
              <p className="font-semibold">{t('cameraDeniedTitle')}</p>
              <p>{t('cameraDeniedChrome')}</p>
              <p>{t('cameraDeniedSafari')}</p>
              <p>{t('cameraDeniedSamsung')}</p>
            </div>
          )}
          {cameraIssue === 'unavailable' && (
            <p role="alert" className="text-sm font-medium">
              {t('pfCamera')}
            </p>
          )}
        </section>
      )}

      {step === 'motion' && (
        <section className={CARD}>
          <p>{t('allowMotionRationale')}</p>
          <Button onClick={() => void allowMotion()}>{t('allowMotion')}</Button>
        </section>
      )}

      {step === 'place' && (
        <>
          <section className={CARD}>
            <h2 className="font-bold">{t('placePhoneTitle')}</h2>
            <p className="text-sm">{t('placePhoneInstructions')}</p>
            {skipLevel ? (
              <Banner tone="warn">{t('levelSkippedNotice')}</Banner>
            ) : (
              <div className="p-4 rounded-xl bg-slate-900 text-white flex flex-col items-center gap-3">
                <LevelBubble beta={tilt.beta} gamma={tilt.gamma} size="lg" />
                <p role="status" className="text-sm text-center">
                  {levelHeld ? (
                    <span className="font-bold inline-flex items-center gap-1">
                      <CheckCircle2 aria-hidden="true" className="w-4 h-4" />
                      {t('levelSuccessChime')}
                    </span>
                  ) : (
                    t('levelBubblePrompt')
                  )}
                </p>
              </div>
            )}
          </section>
          {mode === 'self' && !heard && (
            <VolumeCheck
              onHeard={() => setHeard(true)}
              onHelper={() => {
                setMode('assisted');
                captureSession.setMode('assisted');
                vtStorage.saveDraft({ ...vtStorage.getDraft(), capture_mode: 'assisted' });
              }}
            />
          )}
          {heard && mode === 'self' && <p className="font-medium text-emerald-900">{t('volumeOk')}</p>}
          <Button onClick={start} disabled={!canStart} size="xl" className="w-full">
            {t('readyStart')}
          </Button>
        </>
      )}
    </div>
  );
};
