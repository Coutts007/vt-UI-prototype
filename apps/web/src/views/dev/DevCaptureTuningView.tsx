// Developer page: pick what the fake vision worker replays, and read every check's live verdict.
import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { CHECK_ORDER, evaluateChecks, firstFailing, maskBounds } from '../../capture/checks';
import { CAPTURE_CONFIG, configHash } from '../../capture/config';
import { sessionLog } from '../../capture/sessionLog';
import { FAKE_VISION_KEY } from '../../vision/client';
import { DEFAULT_FAKE, FakeOptions, FakeVisionWorker, readFakeOptions, SCENARIOS, Scenario } from '../../vision/fakeVision';
import type { View } from '../../vision/types';

const RealPanel = lazy(() => import('./DevRealVisionPanel').then((m) => ({ default: m.DevRealVisionPanel })));

/** Pilot instrumentation (M15): the last capture's check values, numbers only, as a local download. */
function downloadSessionLog(): void {
  const text = JSON.stringify(sessionLog.toJSON(), null, 1);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `vt-capture-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export const DevCaptureTuningView: React.FC = () => {
  const [options, setOptions] = useState<FakeOptions>(readFakeOptions);
  const [view, setView] = useState<View>('front');
  const [tick, setTick] = useState(0);
  const worker = useMemo(() => new FakeVisionWorker(DEFAULT_FAKE), []);

  useEffect(() => {
    sessionStorage.setItem(FAKE_VISION_KEY, JSON.stringify(options));
  }, [options]);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), CAPTURE_CONFIG.timing.sampleMs * 3);
    return () => clearInterval(timer);
  }, []);

  const sample = useMemo(() => worker.live(options.scenario, view), [worker, options.scenario, view, tick]);
  const outcome = evaluateChecks({ view, sample });
  const failing = firstFailing(outcome.results);
  const bounds = sample.mask ? maskBounds(sample.mask) : null;

  return (
    <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <h1 className="text-2xl font-extrabold">Capture tuning</h1>
      <p className="text-sm">
        Thresholds {CAPTURE_CONFIG.version} · {configHash()}. Choices apply to the next capture in this tab.
      </p>
      <div className="grid sm:grid-cols-3 gap-4">
        <label className="block text-sm font-semibold">
          Scenario
          <select
            data-testid="scenario"
            value={options.scenario}
            onChange={(event) => setOptions({ ...options, scenario: event.target.value as Scenario })}
            className="block w-full min-h-12 border rounded-lg px-2"
          >
            {SCENARIOS.map((scenario) => (
              <option key={scenario}>{scenario}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          View
          <select value={view} onChange={(event) => setView(event.target.value as View)} className="block w-full min-h-12 border rounded-lg px-2">
            <option>front</option>
            <option>side</option>
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Speed
          <select
            value={options.speed}
            onChange={(event) => setOptions({ ...options, speed: Number(event.target.value) })}
            className="block w-full min-h-12 border rounded-lg px-2"
          >
            <option value={1}>real time</option>
            <option value={0.1}>ten times faster</option>
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 min-h-12">
        <input
          type="checkbox"
          checked={options.recover}
          onChange={(event) => setOptions({ ...options, recover: event.target.checked })}
        />
        Fail first, then recover
      </label>
      <label className="flex items-center gap-2 min-h-12">
        <input
          type="checkbox"
          data-testid="real-switch"
          checked={options.real === true}
          onChange={(event) => setOptions({ ...options, real: event.target.checked })}
        />
        Real camera and models (built app only, not the Vite dev server)
      </label>
      {options.real && (
        <Suspense fallback={null}>
          <RealPanel view={view} />
        </Suspense>
      )}
      <section className="border rounded-lg p-3 space-y-2" aria-label="Session log">
        <p className="text-sm" data-testid="session-log-count">
          Last capture in this tab: {sessionLog.samples.length} samples, {sessionLog.events.length} events
          {sessionLog.meta.camera_facing ? ` (${String(sessionLog.meta.capture_mode)}, ${String(sessionLog.meta.camera_facing)} camera, ${String(sessionLog.meta.guidance_mode)} guidance)` : ''}.
          Numbers only; nothing identifies the client.
        </p>
        <div className="flex gap-3">
          <button type="button" data-testid="download-log" onClick={downloadSessionLog} disabled={!sessionLog.samples.length} className="min-h-12 px-3 border rounded-lg font-semibold disabled:opacity-50">
            Download session log (JSON)
          </button>
          <button type="button" onClick={() => { sessionLog.clear(); setTick((value) => value + 1); }} className="min-h-12 px-3 border rounded-lg">
            Clear
          </button>
        </div>
      </section>
      <p data-testid="first-failing" className="font-bold">
        First failing: {failing ?? 'none'} {failing ? `(${outcome.corrections[failing]})` : ''}
      </p>
      <table className="w-full text-sm border">
        <tbody>
          {CHECK_ORDER.map((id) => (
            <tr key={id} className="border-t">
              <th className="text-left p-2 font-medium">{id}</th>
              <td className="p-2 font-mono">{outcome.results[id] ? 'pass' : 'fail'}</td>
            </tr>
          ))}
          <tr className="border-t">
            <th className="text-left p-2 font-medium">person height</th>
            <td className="p-2 font-mono">{bounds ? (bounds.bottom - bounds.top).toFixed(3) : '-'}</td>
          </tr>
          <tr className="border-t">
            <th className="text-left p-2 font-medium">marker side px</th>
            <td className="p-2 font-mono">{sample.marker?.side_px.toFixed(1) ?? '-'}</td>
          </tr>
          <tr className="border-t">
            <th className="text-left p-2 font-medium">luminance / sharpness</th>
            <td className="p-2 font-mono">
              {sample.luminance} / {sample.sharpness}
            </td>
          </tr>
          <tr className="border-t">
            <th className="text-left p-2 font-medium">free arm</th>
            <td className="p-2 font-mono">{outcome.freeArm ?? '-'}</td>
          </tr>
        </tbody>
      </table>
    </main>
  );
};
