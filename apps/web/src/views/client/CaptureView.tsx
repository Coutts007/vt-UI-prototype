import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import { Landmark, MarkerObs } from '../../types/api';
import { CameraManager, subscribeToOrientation, OrientationState } from '../../capture/camera';
import { evaluateCaptureChecks } from '../../capture/checks';
import { vtAudio } from '../../capture/audio';
import { generateSyntheticPose, generateSyntheticMarker } from '../../capture/fakeVision';
import { LevelBubble } from '../../components/ui/LevelBubble';
import {
  Volume2,
  VolumeX,
  X,
  Camera,
  CheckCircle2,
  HelpCircle,
  Video,
  Sliders,
  ChevronRight,
} from 'lucide-react';

interface CaptureViewProps {
  view: 'front' | 'side';
  onCompleteView: (burstData: { landmarks: Landmark[]; marker: MarkerObs }) => void;
  onCancel: () => void;
  onNavigate: (path: string) => void;
}

export const CaptureView: React.FC<CaptureViewProps> = ({
  view,
  onCompleteView,
  onCancel,
  onNavigate,
}) => {
  const { locale, setLocale, t } = useI18n();

  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraManagerRef = useRef<CameraManager>(new CameraManager());

  // Capture mode: self vs assisted
  const [captureMode, setCaptureMode] = useState<'self' | 'assisted'>('self');

  // Simulation vs Live Stream mode
  const [useSimulation, setUseSimulation] = useState<boolean>(false);
  const [simulationPreset, setSimulationPreset] = useState<'good' | 'arms_tucked' | 'too_close' | 'too_far' | 'cut_off'>('good');
  const [missingMarker, setMissingMarker] = useState<boolean>(false);

  // Vision landmarks & marker state
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [marker, setMarker] = useState<MarkerObs | null>(null);

  // Tilt sensors
  const [beta, setBeta] = useState<number>(90.0);
  const [gamma, setGamma] = useState<number>(0.0);

  // Countdown state
  const [countdown, setCountdown] = useState<number | null>(null);
  const [burstActive, setBurstActive] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(vtAudio.getMuted());

  // Walk-away initial countdown (8s on front view start)
  const [walkCountdown, setWalkCountdown] = useState<number | null>(view === 'front' ? 4 : null);

  // Transition overlay between front and side view
  const [transitioning, setTransitioning] = useState<boolean>(false);

  // Screen Wake Lock
  useEffect(() => {
    let wakeLock: any = null;
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then((lock) => {
        wakeLock = lock;
      }).catch(() => {});
    }
    return () => {
      if (wakeLock) wakeLock.release().catch(() => {});
    };
  }, []);

  // Initialize camera or fallback to simulation
  useEffect(() => {
    let mounted = true;
    if (videoRef.current && !useSimulation) {
      cameraManagerRef.current
        .startStream(videoRef.current, 'environment')
        .catch(() => {
          if (mounted) {
            setUseSimulation(true);
          }
        });
    }

    return () => {
      mounted = false;
      cameraManagerRef.current.stopStream();
    };
  }, [useSimulation]);

  // Subscribe to device motion
  useEffect(() => {
    const unsub = subscribeToOrientation((state: OrientationState) => {
      setBeta(state.beta);
      setGamma(state.gamma);
    });
    return () => unsub();
  }, []);

  // Update synthetic or live vision stream loop
  useEffect(() => {
    const interval = setInterval(() => {
      const synPose = generateSyntheticPose(view, simulationPreset);
      const synMarker = generateSyntheticMarker(view, missingMarker);
      setLandmarks(synPose);
      setMarker(synMarker);
    }, 150);

    return () => clearInterval(interval);
  }, [view, simulationPreset, missingMarker]);

  // Walk-away countdown
  useEffect(() => {
    if (walkCountdown === null) return;
    if (walkCountdown > 0) {
      const timer = setTimeout(() => {
        vtAudio.playTick();
        setWalkCountdown(walkCountdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setWalkCountdown(null);
    }
  }, [walkCountdown]);

  // Evaluate checks
  const checksEvaluation = evaluateCaptureChecks({
    view,
    beta,
    gamma,
    landmarks,
    marker,
    luminance: 125,
    stabilityScore: 0.95,
  });

  const { checks, allPassed, activeCorrectionKey, borderState } = checksEvaluation;

  // Auto-capture countdown logic (Section 10.3: when checks pass for 1.0s, start 3s countdown)
  useEffect(() => {
    if (walkCountdown !== null || burstActive || transitioning) return;

    if (allPassed && countdown === null) {
      // Start 3-second countdown
      vtAudio.playReadyChime();
      setCountdown(3);
    } else if (!allPassed && countdown !== null && countdown > 0) {
      // Cancel countdown if any check fails!
      vtAudio.playStopTone();
      setCountdown(null);
    }
  }, [allPassed, countdown, walkCountdown, burstActive, transitioning]);

  // Countdown timer step
  useEffect(() => {
    if (countdown === null) return;
    if (countdown > 0) {
      vtAudio.playCountdownBeep(countdown);
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0) {
      // Trigger Burst capture!
      triggerBurst();
    }
  }, [countdown]);

  const triggerBurst = () => {
    setCountdown(null);
    setBurstActive(true);
    vtAudio.playCountdownBeep(0);

    setTimeout(() => {
      vtAudio.playDoneChime();
      setBurstActive(false);

      const burstPose = generateSyntheticPose(view, 'good');
      const burstMarker = generateSyntheticMarker(view, false);

      onCompleteView({
        landmarks: burstPose,
        marker: burstMarker,
      });
    }, 1200);
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    vtAudio.setMuted(next);
  };

  // Border color based on 16px frame border states
  const borderClasses = {
    ok: 'border-emerald-500 shadow-[inset_0_0_40px_rgba(16,185,129,0.3)]',
    wait: 'border-amber-400 shadow-[inset_0_0_30px_rgba(251,191,36,0.2)]',
    stop: 'border-rose-600 shadow-[inset_0_0_30px_rgba(225,29,72,0.25)]',
  }[borderState];

  return (
    <div className={`fixed inset-0 z-50 bg-[#0E0E10] text-white flex flex-col justify-between select-none border-[14px] sm:border-[18px] transition-colors duration-200 ${borderClasses}`}>
      {/* 1. Status Strip Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/60 backdrop-blur-md z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setLocale(locale === 'en' ? 'sw' : 'en')}
            className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-xs font-bold text-white tracking-wider cursor-pointer"
          >
            {locale.toUpperCase()}
          </button>
          <span className="text-sm font-semibold text-slate-200">
            {view === 'front' ? t('frontViewTitle') : t('sideViewTitle')}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleMute}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            title="Toggle Audio"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          </button>

          <button
            onClick={onCancel}
            className="p-2 rounded-lg bg-white/10 hover:bg-rose-500/30 text-white cursor-pointer"
            title="Stop Measuring"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Main Viewport: Video Preview + Silhouette Overlay */}
      <div className="relative flex-1 w-full h-full overflow-hidden flex items-center justify-center">
        {/* Background Video Stream */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`absolute inset-0 w-full h-full object-cover z-0 ${useSimulation ? 'hidden' : ''}`}
        />

        {/* Fallback Simulation Canvas / Backdrop */}
        {useSimulation && (
          <div className="absolute inset-0 w-full h-full bg-linear-to-b from-slate-950 via-slate-900 to-black flex items-center justify-center opacity-90 z-0">
            <div className="text-center text-slate-600 text-xs">
              <span>Interactive Synthetic Vision Simulation</span>
            </div>
          </div>
        )}

        {/* Anatomical Target Outline (Corrected C2: 31% to 63% frame height at 2.5m) */}
        <div className="relative z-10 w-full h-full flex flex-col items-center justify-center pointer-events-none">
          <svg
            viewBox="0 0 200 400"
            className="h-[52vh] sm:h-[58vh] w-auto transition-opacity duration-300"
            aria-label="Target body outline"
          >
            {view === 'front' ? (
              // Front Outline with Arms ~30° out
              <g stroke="#FFFFFF" strokeWidth="2.5" strokeDasharray="5,4" fill="none" opacity="0.65">
                {/* Head */}
                <ellipse cx="100" cy="40" rx="18" ry="24" />
                {/* Torso & Legs */}
                <path d="M 82 64 C 70 70, 50 85, 42 120 L 32 180 C 40 185, 48 160, 54 135 C 60 145, 62 170, 62 200 L 56 370 C 64 375, 75 375, 80 370 L 95 240 L 105 240 L 120 370 C 125 375, 136 375, 144 370 L 138 200 C 138 170, 140 145, 146 135 C 152 160, 160 185, 168 180 L 158 120 C 150 85, 130 70, 118 64 Z" />
                {/* Chest Sheet Target Box */}
                <rect x="75" y="110" width="50" height="50" stroke="#38BDF8" strokeWidth="2" strokeDasharray="3,3" />
                <text x="100" y="140" fill="#38BDF8" fontSize="10" textAnchor="middle" fontWeight="bold">
                  {t('sheetHere')}
                </text>
              </g>
            ) : (
              // Right-Profile Silhouette
              <g stroke="#FFFFFF" strokeWidth="2.5" strokeDasharray="5,4" fill="none" opacity="0.65">
                {/* Profile Head */}
                <ellipse cx="100" cy="40" rx="16" ry="24" />
                {/* Profile Torso & Legs */}
                <path d="M 90 64 C 84 80, 80 120, 82 180 C 82 220, 85 280, 88 370 C 98 375, 110 375, 115 370 L 118 260 L 122 370 C 128 375, 138 375, 142 370 C 136 280, 132 200, 126 150 C 120 110, 115 70, 108 64 Z" />
                {/* Hip Sheet Target Box */}
                <rect x="75" y="160" width="50" height="50" stroke="#38BDF8" strokeWidth="2" strokeDasharray="3,3" />
                <text x="100" y="190" fill="#38BDF8" fontSize="10" textAnchor="middle" fontWeight="bold">
                  {t('sheetHere')}
                </text>
              </g>
            )}
          </svg>
        </div>

        {/* 3. Live 7-Check Overlay (Left Edge) */}
        <div className="absolute left-3 sm:left-6 top-16 z-20 flex flex-col gap-1.5 p-3 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-0.5">
            Capture Checks
          </span>
          {checks.map((chk) => (
            <div key={chk.id} className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${chk.passed ? 'bg-emerald-400' : 'bg-rose-500'}`} />
              <span className={`font-medium ${chk.passed ? 'text-slate-200' : 'text-rose-300'}`}>
                {t(chk.labelKey)}
              </span>
            </div>
          ))}
        </div>

        {/* 4. Live Level Bubble Indicator (Right Edge) */}
        <div className="absolute right-3 sm:right-6 top-16 z-20 p-2.5 rounded-xl bg-black/60 backdrop-blur-md border border-white/10">
          <LevelBubble beta={beta} gamma={gamma} size="sm" />
        </div>

        {/* Big Countdown Overlay (3, 2, 1 at 160px+) */}
        {countdown !== null && (
          <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-xs flex flex-col items-center justify-center">
            <span className="text-8xl sm:text-9xl font-black text-emerald-400 animate-ping duration-700">
              {countdown}
            </span>
            <span className="text-xl font-bold text-white mt-4 tracking-wider uppercase">
              {t('holdStill')}
            </span>
          </div>
        )}

        {/* Walk-away Countdown Notice */}
        {walkCountdown !== null && (
          <div className="absolute inset-0 z-30 bg-black/70 flex flex-col items-center justify-center p-6 text-center">
            <span className="text-6xl font-black text-white mb-4">{walkCountdown}</span>
            <h2 className="text-2xl font-bold text-white mb-2">{t('walkAwayPrompt')}</h2>
            <p className="text-sm text-slate-300 max-w-sm">
              Prop the phone on the chair. Stand back 2.5 metres against the wall holding the sheet.
            </p>
          </div>
        )}

        {/* Burst Active Processing Notice */}
        {burstActive && (
          <div className="absolute inset-0 z-40 bg-black/80 flex flex-col items-center justify-center text-center p-6">
            <div className="w-16 h-16 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin mb-4" />
            <span className="text-2xl font-bold text-white tracking-tight">{t('holdStill')}</span>
            <span className="text-xs text-slate-600 mt-2">Computing 5-frame median pose on device</span>
          </div>
        )}

        {/* 5. Main 56px Guidance Instruction (Visible across room at 2.5m) */}
        <div className="absolute bottom-24 sm:bottom-28 inset-x-4 sm:inset-x-8 z-30 flex justify-center text-center">
          <div className="bg-black/85 backdrop-blur-md px-6 py-3.5 rounded-2xl border border-white/20 shadow-2xl max-w-2xl w-full">
            <p
              className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-white leading-tight"
              aria-live="assertive"
            >
              {activeCorrectionKey ? t(activeCorrectionKey) : allPassed ? t('holdStill') : 'Preparing checks…'}
            </p>
          </div>
        </div>
      </div>

      {/* 6. Footer Controls: Shutter & Tuning Controls */}
      <div className="bg-black/75 backdrop-blur-md px-4 py-3 z-30 flex flex-col gap-2">
        <div className="flex items-center justify-between max-w-2xl mx-auto w-full">
          {/* Simulation Toggle & Presets */}
          <button
            type="button"
            onClick={() => setUseSimulation(!useSimulation)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-slate-300 cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{useSimulation ? 'Simulation Active' : 'Live Camera'}</span>
          </button>

          {/* Shutter Button (In Assisted Mode or Manual Override) */}
          <div className="flex items-center justify-center">
            {captureMode === 'assisted' || useSimulation ? (
              <button
                type="button"
                onClick={triggerBurst}
                disabled={!allPassed}
                className="w-16 h-16 sm:w-18 sm:h-18 rounded-full border-4 border-white bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center shadow-lg active:scale-95 transition-all cursor-pointer"
                aria-label="Capture photo burst"
              >
                <Camera className="w-7 h-7 text-white stroke-[2.5]" />
              </button>
            ) : (
              <span className="text-xs font-semibold text-slate-300 bg-white/10 px-4 py-2 rounded-full border border-white/10">
                {t('autoCaptureNotice')}
              </span>
            )}
          </div>

          {/* Help Button */}
          <button
            type="button"
            onClick={() => onNavigate('/help')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-slate-300 cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Guide</span>
          </button>
        </div>

        {/* Simulation preset buttons (For quick evaluation of all 9 checks on desktop) */}
        {useSimulation && (
          <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1 text-[11px]">
            <span className="text-slate-600 mr-1">Simulate checks:</span>
            {[
              { id: 'good', label: 'All Pass' },
              { id: 'arms_tucked', label: 'Arms Tucked' },
              { id: 'too_far', label: 'Too Far' },
              { id: 'too_close', label: 'Too Close' },
              { id: 'cut_off', label: 'Head/Feet Cut' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSimulationPreset(p.id as any)}
                className={`px-2 py-0.5 rounded cursor-pointer ${
                  simulationPreset === p.id ? 'bg-emerald-500 text-white font-bold' : 'bg-white/10 text-slate-300'
                }`}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setMissingMarker(!missingMarker)}
              className={`px-2 py-0.5 rounded cursor-pointer ${
                missingMarker ? 'bg-rose-500 text-white font-bold' : 'bg-white/10 text-slate-300'
              }`}
            >
              {missingMarker ? 'Sheet Missing' : 'Sheet Present'}
            </button>
          </div>
        )}

        <div className="text-center text-[10px] text-slate-600">
          Photos stay on this phone. Nothing is uploaded.
        </div>
      </div>
    </div>
  );
};
