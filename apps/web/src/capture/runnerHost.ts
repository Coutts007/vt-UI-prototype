// Keeps one runner alive across the /capture/front and /capture/side screens.
import { createVisionClient, VisionClient } from '../vision/client';
import { voiceGuide } from './audio';
import { subscribeToOrientation, Tilt } from './camera';
import { CaptureRunner } from './runner';
import { captureSession } from './session';

interface Host {
  runner: CaptureRunner;
  vision: VisionClient;
  speed: number;
}

let host: Promise<Host | null> | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let stopSensors: (() => void) | null = null;
let tilt: Tilt | null = null;
let releaseCamera: () => void = () => {};

/** Set by the capture screen once the camera module has loaded. */
export function onCameraRelease(release: () => void): void {
  releaseCamera = release;
}

const levelOff = () => captureSession.machine.context.levelUnchecked;

export function attachRunner(heightMm: number): Promise<Host | null> {
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = null;
  host ??= createVisionClient().then(async (made) => {
    // Real models load during the walk-away. The voice must not wait for them.
    const ready = made.client.init(heightMm);
    if (made.real) {
      void ready.catch(() => captureSession.send({ type: 'VISION_UNAVAILABLE' }));
      if (!levelOff()) stopSensors = subscribeToOrientation((next) => (tilt = next));
    } else {
      await ready;
    }
    return {
      vision: made.client,
      speed: made.speed,
      runner: new CaptureRunner({
        session: captureSession,
        vision: made.client,
        audio: voiceGuide,
        speed: made.speed,
        selfTimedBurst: made.real,
        sensorTilt: made.real ? () => tilt : undefined,
      }),
    };
  }).catch(() => {
    captureSession.send({ type: 'VISION_UNAVAILABLE' });
    return null;
  });
  return host;
}

/** The screen went away. If no capture screen follows, stop the timers and the voice. */
export function detachRunner(): void {
  stopTimer = setTimeout(() => {
    releaseCamera(); // Computing needs no camera (10.1.6).
    const name = captureSession.machine.state.name;
    if (name !== 'computing') stopRunner();
  }, 300);
}

export function stopRunner(): void {
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = null;
  stopSensors?.();
  stopSensors = null;
  tilt = null;
  releaseCamera();
  captureSession.releaseMasks(); // Stopping keeps no image data (privacy invariant 2).
  void host?.then((current) => current?.runner.stop());
  host = null;
}

export function currentHost(): Promise<Host | null> {
  return host ?? Promise.resolve(null);
}
