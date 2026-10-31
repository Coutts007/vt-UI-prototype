// Keeps one runner alive across the /capture/front and /capture/side screens.
import { createVisionClient, VisionClient } from '../vision/client';
import { voiceGuide } from './audio';
import { CaptureRunner } from './runner';
import { captureSession } from './session';

interface Host {
  runner: CaptureRunner;
  vision: VisionClient;
  speed: number;
}

let host: Promise<Host | null> | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;

export function attachRunner(heightMm: number): Promise<Host | null> {
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = null;
  host ??= createVisionClient().then(async (made) => {
    if (!made) {
      captureSession.send({ type: 'VISION_UNAVAILABLE' });
      return null;
    }
    await made.client.init(heightMm);
    return {
      vision: made.client,
      speed: made.speed,
      runner: new CaptureRunner({
        session: captureSession,
        vision: made.client,
        audio: voiceGuide,
        speed: made.speed,
      }),
    };
  });
  return host;
}

/** The screen went away. If no capture screen follows, stop the timers and the voice. */
export function detachRunner(): void {
  stopTimer = setTimeout(() => {
    const name = captureSession.machine.state.name;
    if (name !== 'computing') stopRunner();
  }, 300);
}

export function stopRunner(): void {
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = null;
  void host?.then((current) => current?.runner.stop());
  host = null;
}

export function currentHost(): Promise<Host | null> {
  return host ?? Promise.resolve(null);
}
