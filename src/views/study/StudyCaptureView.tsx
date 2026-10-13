import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { NumberInput } from '../../components/ui/NumberInput';
import { vtStorage } from '../../db/storage';
import { Beaker, ArrowRight, ShieldCheck, Check } from 'lucide-react';

interface StudyCaptureViewProps {
  initialParticipantCode?: string;
  onNavigate: (path: string) => void;
}

export const StudyCaptureView: React.FC<StudyCaptureViewProps> = ({
  initialParticipantCode,
  onNavigate,
}) => {
  const { t } = useI18n();

  const [participantCode, setParticipantCode] = useState(initialParticipantCode || 'P001');
  const [setNo, setSetNo] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<'self' | 'assisted'>('self');
  const [lighting, setLighting] = useState<'window' | 'lamp' | 'outdoor'>('window');
  const [distanceM, setDistanceM] = useState<number>(2.2);
  const [clothingFit, setClothingFit] = useState<'fitted' | 'loose'>('fitted');
  const [heightCm, setHeightCm] = useState<number>(170);
  const [paperConsent, setPaperConsent] = useState<boolean>(true);
  const [lux, setLux] = useState<number>(240);

  const handleStartStudyCapture = () => {
    // Save draft with study covariates
    vtStorage.saveDraft({
      client_code: participantCode,
      height_mm: Math.round(heightCm * 10),
      clothing_fit: clothingFit,
      capture_mode: mode,
      consent: {
        consent_version: 'study-paper-1.0',
        language: 'en',
        scope: ['study_paper', 'measure', 'measurements_only', 'retention'],
        given_at: new Date().toISOString(),
      },
    });

    onNavigate('/capture/front');
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 text-[var(--vt-thread,#2E3A87)] flex items-center justify-center">
          <Beaker className="w-6 h-6 stroke-[2.2]" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
            Researcher Study Capture
          </h1>
          <p className="text-sm text-[var(--vt-ink-muted,#5C554C)]">
            Enforce experimental covariates for MKU Thesis Validation Protocol (Appendix E)
          </p>
        </div>
      </div>

      <div className="p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs space-y-5">
        {/* Participant & Set */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Participant Code
            </label>
            <input
              type="text"
              value={participantCode}
              onChange={(e) => setParticipantCode(e.target.value.toUpperCase())}
              className="w-full h-11 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] font-mono font-bold text-base"
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Capture Set Number
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setSetNo(num as any)}
                  className={`h-11 rounded-xl border text-xs font-bold cursor-pointer ${
                    setNo === num
                      ? 'bg-[var(--vt-thread,#2E3A87)] text-white'
                      : 'border-[var(--vt-line,#DDD5C8)] hover:bg-[#FAF8F5]'
                  }`}
                >
                  Set {num}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Height & Clothing Fit */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Measured Stature (cm)
            </label>
            <input
              type="number"
              value={heightCm}
              onChange={(e) => setHeightCm(parseFloat(e.target.value) || 170)}
              className="w-full h-11 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] font-mono text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Observed Clothing Fit
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['fitted', 'loose'] as const).map((fit) => (
                <button
                  key={fit}
                  type="button"
                  onClick={() => setClothingFit(fit)}
                  className={`h-11 rounded-xl border text-xs font-bold capitalize cursor-pointer ${
                    clothingFit === fit
                      ? 'bg-[var(--vt-thread,#2E3A87)] text-white'
                      : 'border-[var(--vt-line,#DDD5C8)] hover:bg-[#FAF8F5]'
                  }`}
                >
                  {fit}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Environmental Covariates (Lighting & Distance) */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Ambient Lighting
            </label>
            <select
              value={lighting}
              onChange={(e) => setLighting(e.target.value as any)}
              className="w-full h-11 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-xs font-semibold"
            >
              <option value="window">Natural Window Light</option>
              <option value="lamp">Indoor Bulb / Lamp</option>
              <option value="outdoor">Outdoor Diffused</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Distance Wall-to-Phone (m)
            </label>
            <input
              type="number"
              step="0.1"
              value={distanceM}
              onChange={(e) => setDistanceM(parseFloat(e.target.value) || 2.2)}
              className="w-full h-11 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm font-mono"
            />
          </div>
        </div>

        {/* Paper Consent Confirmation */}
        <label className="flex items-center gap-3 p-3 rounded-xl bg-[#FAF8F5] border border-[var(--vt-line,#DDD5C8)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={paperConsent}
            onChange={(e) => setPaperConsent(e.target.checked)}
            className="w-5 h-5 rounded text-[var(--vt-thread,#2E3A87)]"
          />
          <span className="text-xs font-semibold text-[var(--vt-ink,#1F1C18)]">
            Paper consent verified and on file for {participantCode} (MKU IERC Protocol 1.0)
          </span>
        </label>
      </div>

      <Button
        onClick={handleStartStudyCapture}
        disabled={!paperConsent}
        size="xl"
        icon={<ArrowRight className="w-5 h-5" />}
        className="w-full"
      >
        Launch Experimental Capture Flow
      </Button>
    </div>
  );
};
