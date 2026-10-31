import React, { useState } from 'react';
import { evaluateCaptureChecks } from '../../capture/checks';
import { generateSyntheticPose, generateSyntheticMarker } from '../../capture/fakeVision';
import { Button } from '../../components/ui/Button';
import { Sliders, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

export const DevCaptureTuningView: React.FC = () => {
  const [view, setView] = useState<'front' | 'side'>('front');
  const [beta, setBeta] = useState<number>(90.0);
  const [gamma, setGamma] = useState<number>(0.0);
  const [modifier, setModifier] = useState<'good' | 'arms_tucked' | 'too_close' | 'too_far' | 'cut_off'>('good');
  const [missingMarker, setMissingMarker] = useState<boolean>(false);
  const [luminance, setLuminance] = useState<number>(130);
  const [stability, setStability] = useState<number>(0.95);

  const landmarks = generateSyntheticPose(view, modifier);
  const marker = generateSyntheticMarker(view, missingMarker);

  const evalResult = evaluateCaptureChecks({
    view,
    beta,
    gamma,
    landmarks,
    marker,
    luminance,
    stabilityScore: stability,
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
          Capture Thresholds &amp; Vision Tuning (/dev/capture-tuning)
        </h1>
        <p className="text-sm text-[var(--vt-ink-muted,#5C554C)]">
          Live simulation laboratory to inspect check evaluations and 56px guidance corrections
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Controls Column */}
        <div className="p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)]">
            Input Covariates
          </h2>

          <div>
            <label className="text-xs font-bold block mb-1">View Orientation</label>
            <div className="grid grid-cols-2 gap-2">
              {(['front', 'side'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`py-2 rounded-lg text-xs font-bold capitalize cursor-pointer ${
                    view === v ? 'bg-[var(--vt-thread,#2E3A87)] text-white' : 'border border-[var(--vt-line,#DDD5C8)]'
                  }`}
                >
                  {v} view
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="devcapturetuningview-1" className="text-xs font-bold block mb-1">Body Pose Preset</label>
            <select id="devcapturetuningview-1"
              value={modifier}
              onChange={(e) => setModifier(e.target.value as any)}
              className="w-full h-10 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-xs font-semibold"
            >
              <option value="good">Optimal Stance (Passes checks)</option>
              <option value="arms_tucked">Arms Tucked Near Body</option>
              <option value="too_close">Too Close to Camera (&gt;63% height)</option>
              <option value="too_far">Too Far From Camera (&lt;31% height)</option>
              <option value="cut_off">Head or Feet Cut Off</option>
            </select>
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={missingMarker}
                onChange={(e) => setMissingMarker(e.target.checked)}
                className="w-4 h-4 rounded text-[var(--vt-thread,#2E3A87)]"
              />
              <span>Simulate Missing / Obscured Measuring Sheet</span>
            </label>
          </div>

          <div>
            <label htmlFor="devcapturetuningview-2" className="text-xs font-bold block mb-1">Tilt Beta: {beta}° (Target: 88°–92°)</label>
            <input id="devcapturetuningview-2"
              type="range"
              min="75"
              max="105"
              step="0.5"
              value={beta}
              onChange={(e) => setBeta(parseFloat(e.target.value))}
              className="w-full accent-[var(--vt-thread,#2E3A87)]"
            />
          </div>

          <div>
            <label htmlFor="devcapturetuningview-3" className="text-xs font-bold block mb-1">Roll Gamma: {gamma}° (Target: ±2.5°)</label>
            <input id="devcapturetuningview-3"
              type="range"
              min="-10"
              max="10"
              step="0.5"
              value={gamma}
              onChange={(e) => setGamma(parseFloat(e.target.value))}
              className="w-full accent-[var(--vt-thread,#2E3A87)]"
            />
          </div>

          <div>
            <label htmlFor="devcapturetuningview-4" className="text-xs font-bold block mb-1">Luminance: {luminance} (Target: 50–235)</label>
            <input id="devcapturetuningview-4"
              type="range"
              min="20"
              max="255"
              value={luminance}
              onChange={(e) => setLuminance(parseInt(e.target.value))}
              className="w-full accent-[var(--vt-thread,#2E3A87)]"
            />
          </div>
        </div>

        {/* Results Column */}
        <div className="p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)]">
            Live Check Evaluation Output
          </h2>

          <div
            className={`p-4 rounded-xl border flex items-center gap-3 ${
              evalResult.borderState === 'ok'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                : evalResult.borderState === 'wait'
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-rose-50 border-rose-300 text-rose-900'
            }`}
          >
            {evalResult.borderState === 'ok' ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
            ) : (
              <XCircle className="w-6 h-6 text-rose-600 shrink-0" />
            )}
            <div>
              <span className="font-bold text-sm block">
                Frame Border State: {evalResult.borderState.toUpperCase()}
              </span>
              <span className="text-xs">
                All Passed: {evalResult.allPassed ? 'YES (Trigger countdown)' : 'NO (Display guidance)'}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 text-white text-center">
            <span className="text-[10px] text-slate-600 uppercase tracking-wider block mb-1">
              Active 56px Correction Prompt
            </span>
            <span className="text-xl font-black text-amber-300">
              {evalResult.activeCorrectionKey || 'None (Hold Still)'}
            </span>
          </div>

          <div className="divide-y divide-[var(--vt-line,#DDD5C8)]/60 text-xs">
            {evalResult.checks.map((chk) => (
              <div key={chk.id} className="py-2.5 flex items-center justify-between">
                <span className="font-semibold">{chk.id}</span>
                <span className={`font-mono font-bold ${chk.passed ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {chk.passed ? 'PASS' : 'FAIL'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
