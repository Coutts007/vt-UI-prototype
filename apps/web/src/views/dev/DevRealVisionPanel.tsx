// Developer panel: the real camera and models, with live numbers for every check (10.3).
import React, { useEffect, useRef, useState } from 'react';
import { subscribeToOrientation, Tilt } from '../../capture/camera';
import { AppliedCamera, captureCamera } from '../../capture/cameraManager';
import { CHECK_ORDER, CheckOutcome, evaluateChecks, firstFailing, maskBounds } from '../../capture/checks';
import { CAPTURE_CONFIG } from '../../capture/config';
import { VisionClient } from '../../vision/client';
import { REAL_LIMITS, RealVisionWorker } from '../../vision/realVision';
import type { Landmark, View, VisionSample } from '../../vision/types';

interface Live {
  sample: VisionSample;
  outcome: CheckOutcome;
  fps: number;
  ms: number;
}

const row = (label: string, value: string) => (
  <tr className="border-t" key={label}>
    <th className="text-left p-2 font-medium">{label}</th>
    <td className="p-2 font-mono" data-testid={`real-${label}`}>
      {value}
    </td>
  </tr>
);

export const DevRealVisionPanel: React.FC<{ view: View }> = ({ view }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [applied, setApplied] = useState<AppliedCamera | null>(null);
  const [problem, setProblem] = useState('');
  const [tilt, setTilt] = useState<Tilt | null>(null);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const tiltRef = useRef<Tilt | null>(null);

  useEffect(() => {
    let running = true;
    const vision = new VisionClient(new RealVisionWorker(), REAL_LIMITS);
    const stopTilt = subscribeToOrientation((next) => {
      tiltRef.current = next;
      setTilt(next);
    });
    captureCamera.mount(video.current);
    const history: Landmark[][] = [];
    const run = async () => {
      try {
        setApplied(await captureCamera.start());
        await vision.init(1700);
        let last = performance.now();
        while (running) {
          const started = performance.now();
          const sample = await vision.live().catch((error: unknown) => {
            setProblem(String(error));
            return null;
          });
          if (!running) break;
          if (sample) {
            setProblem('');
            const outcome = evaluateChecks({ view: viewRef.current, sample, orientation: tiltRef.current, history });
            if (sample.landmarks) {
              history.push(sample.landmarks);
              if (history.length > CAPTURE_CONFIG.stability.window) history.shift();
            }
            const now = performance.now();
            setLive({ sample, outcome, fps: 1000 / Math.max(now - last, 1), ms: now - started });
            last = now;
          }
          await new Promise((resolve) => setTimeout(resolve, CAPTURE_CONFIG.timing.sampleMs));
        }
      } catch (error) {
        setProblem(String(error));
      }
    };
    void run();
    return () => {
      running = false;
      stopTilt();
      vision.terminate();
      captureCamera.stop();
      captureCamera.mount(null);
    };
  }, []);

  const sample = live?.sample;
  const outcome = live?.outcome;
  const bounds = sample?.mask ? maskBounds(sample.mask) : null;
  const failing = outcome ? firstFailing(outcome.results) : null;
  const lm = sample?.landmarks;
  const shoulders = lm ? Math.abs(lm[11].x - lm[12].x) : null;

  return (
    <section className="space-y-3" aria-label="Real camera">
      <video ref={video} playsInline muted className="w-40 border" />
      {problem && <p role="alert" data-testid="real-problem">{problem}</p>}
      <p data-testid="real-first-failing" className="font-bold">
        First failing: {live ? (failing ?? 'none') : 'starting'}
      </p>
      <table className="w-full text-sm border">
        <tbody>
          {CHECK_ORDER.map((id) => row(id, outcome ? (outcome.results[id] ? 'pass' : 'fail') : '-'))}
          {row('fps', live ? live.fps.toFixed(1) : '-')}
          {row('sample ms', live ? live.ms.toFixed(0) : '-')}
          {row('frame size', sample ? `${sample.image_w} x ${sample.image_h}` : '-')}
          {row('beta / gamma', tilt ? `${tilt.beta.toFixed(1)} / ${tilt.gamma.toFixed(1)}` : 'no sensor')}
          {row('landmarks', lm ? `${lm.length}, min visibility ${Math.min(...[0, 11, 12, 23, 24, 27, 28].map((i) => lm[i].visibility)).toFixed(2)}` : 'none')}
          {row('person height', bounds ? (bounds.bottom - bounds.top).toFixed(3) : '-')}
          {row('mask top / bottom / left / right', bounds ? `${bounds.top.toFixed(3)} ${bounds.bottom.toFixed(3)} ${bounds.left.toFixed(3)} ${bounds.right.toFixed(3)}` : '-')}
          {row('shoulder width', shoulders !== null ? shoulders.toFixed(3) : '-')}
          {row('marker side px', sample?.marker ? sample.marker.side_px.toFixed(1) : '-')}
          {row('luminance', sample ? sample.luminance.toFixed(0) : '-')}
          {row('sharpness', sample ? sample.sharpness.toFixed(0) : '-')}
          {row('free arm', outcome?.freeArm ?? '-')}
          {row('camera', applied ? `${applied.width} x ${applied.height} @ ${applied.frameRate ?? '?'} zoom ${applied.zoom ?? '-'} focus ${applied.focusMode ?? '-'}` : '-')}
          {row('lens', applied?.label ?? '-')}
          {row('still', applied?.still ?? '-')}
        </tbody>
      </table>
    </section>
  );
};
