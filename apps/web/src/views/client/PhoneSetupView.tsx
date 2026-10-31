import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../components/ui/Button';
import { LevelBubble } from '../../components/ui/LevelBubble';
import { vtStorage } from '../../db/storage';
import { vtAudio } from '../../capture/audio';
import { subscribeToOrientation, OrientationState } from '../../capture/camera';
import { Camera, Volume2, VolumeX, Smartphone, ArrowRight, CheckCircle2 } from 'lucide-react';

interface PhoneSetupViewProps {
  onNavigate: (path: string) => void;
}

export const PhoneSetupView: React.FC<PhoneSetupViewProps> = ({ onNavigate }) => {
  const { locale, t } = useI18n();

  const [captureMode, setCaptureMode] = useState<'self' | 'assisted'>('self');
  const [downloadProgress, setDownloadProgress] = useState<number>(100);
  const [isDownloaded, setIsDownloaded] = useState<boolean>(true);

  // Orientation state
  const [beta, setBeta] = useState<number>(90.0);
  const [gamma, setGamma] = useState<number>(0.0);
  const [isLevel, setIsLevel] = useState<boolean>(false);
  const [levelTimer, setLevelTimer] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(vtAudio.getMuted());

  // Subscribe to device motion tilt sensors
  useEffect(() => {
    const unsubscribe = subscribeToOrientation((state: OrientationState) => {
      setBeta(state.beta);
      setGamma(state.gamma);
    });
    return () => unsubscribe();
  }, []);

  // Level check timer: must be level for 1 second continuously (C1: beta in 88..92, |gamma| <= 2.5)
  useEffect(() => {
    const currentlyLevel = beta >= 88 && beta <= 92 && Math.abs(gamma) <= 2.5;
    if (currentlyLevel) {
      const timer = window.setInterval(() => {
        setLevelTimer((prev) => {
          if (prev >= 1) {
            setIsLevel(true);
            vtAudio.playReadyChime();
            clearInterval(timer);
            return 1;
          }
          return prev + 0.5;
        });
      }, 500);
      return () => clearInterval(timer);
    } else {
      setLevelTimer(0);
      setIsLevel(false);
    }
  }, [beta, gamma]);

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    vtAudio.setMuted(next);
  };

  const handleStartCapture = () => {
    vtStorage.saveDraft({
      ...vtStorage.getDraft(),
      capture_mode: captureMode,
    });

    vtAudio.speak(t('walkAwayPrompt'), locale);
    onNavigate('/capture/front');
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-6 sm:py-8">
      {/* Header */}
      <div className="flex items-center justify-between text-xs font-semibold text-[var(--vt-ink-muted,#5C554C)] mb-6 uppercase tracking-wider">
        <span>Step 5 of 5 · Phone Setup</span>
        <button
          onClick={toggleMute}
          className="flex items-center gap-1.5 text-xs text-[var(--vt-ink,#1F1C18)] hover:text-[var(--vt-thread,#2E3A87)] cursor-pointer"
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-rose-600" /> : <Volume2 className="w-4 h-4 text-emerald-600" />}
          <span>{isMuted ? t('unmuteToggle') : t('muteToggle')}</span>
        </button>
      </div>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight mb-2">
        {t('setupTitle')}
      </h1>
      <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mb-6 leading-relaxed">
        Prop your phone upright on a chair, check that it is level, and stand 2 to 2.5 metres away.
      </p>

      {/* 1. Mode Selection (Self vs Assisted) */}
      <div className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs mb-6">
        <label className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] block mb-3">
          {t('whoTakingPhotos')}
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setCaptureMode('self')}
            className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
              captureMode === 'self'
                ? 'border-[var(--vt-thread,#2E3A87)] bg-indigo-50/70 ring-2 ring-[var(--vt-thread,#2E3A87)]/15'
                : 'border-[var(--vt-line,#DDD5C8)] hover:bg-[#FAF8F5]'
            }`}
          >
            <span className="text-xs font-bold block text-[var(--vt-ink,#1F1C18)]">
              I am alone (Auto-shutter)
            </span>
            <span className="text-[11px] text-[var(--vt-ink-muted,#5C554C)] block mt-0.5 leading-snug">
              Phone will guide you and count down 3-2-1 automatically
            </span>
          </button>

          <button
            type="button"
            onClick={() => setCaptureMode('assisted')}
            className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
              captureMode === 'assisted'
                ? 'border-[var(--vt-thread,#2E3A87)] bg-indigo-50/70 ring-2 ring-[var(--vt-thread,#2E3A87)]/15'
                : 'border-[var(--vt-line,#DDD5C8)] hover:bg-[#FAF8F5]'
            }`}
          >
            <span className="text-xs font-bold block text-[var(--vt-ink,#1F1C18)]">
              Someone is helping me
            </span>
            <span className="text-[11px] text-[var(--vt-ink-muted,#5C554C)] block mt-0.5 leading-snug">
              Helper holds phone or taps shutter when checks turn green
            </span>
          </button>
        </div>
      </div>

      {/* 2. Prop Placement Guide & Live Level Bubble */}
      <div className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs mb-8">
        <h2 className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] mb-1">
          {t('placePhoneTitle')}
        </h2>
        <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] leading-relaxed mb-4">
          {t('placePhoneInstructions')}
        </p>

        {/* Visual Level Check Area */}
        <div className="p-4 rounded-xl bg-slate-900 text-white flex flex-col items-center justify-center gap-3 mb-4 shadow-inner">
          <LevelBubble beta={beta} gamma={gamma} size="lg" />

          <p className="text-xs text-center text-slate-300 max-w-xs mt-1">
            {isLevel ? (
              <span className="text-emerald-400 font-bold flex items-center justify-center gap-1">
                <CheckCircle2 className="w-4 h-4" />
                {t('levelSuccessChime')}
              </span>
            ) : (
              t('levelBubblePrompt')
            )}
          </p>
        </div>

        {/* Manual Tilt Adjusters (for testing on desktop laptops without accelerometers) */}
        <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[var(--vt-line,#DDD5C8)] text-xs text-[var(--vt-ink-muted,#5C554C)]">
          <div className="flex items-center justify-between mb-1.5 font-semibold text-[var(--vt-ink,#1F1C18)]">
            <span>Manual Tilt Adjustment (For Laptop / Desktop Testing)</span>
            <button
              type="button"
              onClick={() => {
                setBeta(90.0);
                setGamma(0.0);
              }}
              className="text-[var(--vt-thread,#2E3A87)] hover:underline cursor-pointer"
            >
              Reset to 90° Level
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="phonesetupview-1" className="block text-[11px] mb-1">Tilt (Beta: 88°–92° target)</label>
              <input id="phonesetupview-1"
                type="range"
                min="70"
                max="110"
                step="0.5"
                value={beta}
                onChange={(e) => setBeta(parseFloat(e.target.value))}
                className="w-full accent-[var(--vt-thread,#2E3A87)]"
              />
            </div>
            <div>
              <label htmlFor="phonesetupview-2" className="block text-[11px] mb-1">Roll (Gamma: -2° to +2° target)</label>
              <input id="phonesetupview-2"
                type="range"
                min="-20"
                max="20"
                step="0.5"
                value={gamma}
                onChange={(e) => setGamma(parseFloat(e.target.value))}
                className="w-full accent-[var(--vt-thread,#2E3A87)]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Start Button */}
      <Button
        onClick={handleStartCapture}
        size="xl"
        icon={<ArrowRight className="w-5 h-5" />}
        className="w-full"
      >
        {t('readyStart')}
      </Button>
    </div>
  );
};
