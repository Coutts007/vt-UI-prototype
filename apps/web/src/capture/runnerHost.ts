// Keeps one runner alive across the /capture/front and /capture/side screens.
import { APP_VERSION } from '../appVersion';
import { createVisionClient, VisionClient } from '../vision/client';
import { voiceGuide } from './audio';
import { subscribeToOrientation, Tilt } from './camera';
import { CAPTURE_CONFIG, configHash } from './config';
import { CaptureRunner, RunnerDeps } from './runner';
import { captureSession } from './session';

interface Host {
  runner: CaptureRunner;
  vision: VisionClient;
  speed: number;
  /** False only when a dev or mock tab opted into the replay (D52). */
  real: boolean;
}

let host: Promise<Host | null> | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let stopSensors: (() => void) | null = null;
let tilt: Tilt | null = null;
let releaseCamera: () => void = () => {};
let cameraTrack: () => MediaStreamTrack | null = () => null;

/** Set by the capture screen once the camera module has loaded. */
export function onCameraRelease(release: () => void): void {
  releaseCamera = release;
}

/** Set by the capture screen: the live track when its torch can be driven, else null. */
export function onCameraTrack(getter: () => MediaStreamTrack | null): void {
  cameraTrack = getter;
}

/**
 * The torch cue (A3 item 5) exists only in builds with its flag, and only for voice guidance. The
 * flag is tested by its build-time name here, so a build without it drops the chunk (globals.d.ts).
 */
async function torchFor(): Promise<RunnerDeps['torch']> {
  if (!__VT_TORCH_CUE__ || captureSession.guidanceMode !== 'voice') return undefined;
  const { TorchCue } = await import('./torch');
  return new TorchCue(() => cameraTrack());
}

/** Pilot instrumentation lives in dev and mock builds only (M15). Numbers only. */
async function logFor(): Promise<RunnerDeps['log']> {
  if (!(import.meta.env.DEV || import.meta.env.MODE === 'mock')) return undefined;
  const { sessionLog } = await import('./sessionLog');
  sessionLog.begin({
    capture_mode: captureSession.machine.context.mode,
    camera_facing: captureSession.cameraFacing,
    guidance_mode: captureSession.guidanceMode,
    level_unchecked: captureSession.machine.context.levelUnchecked,
    config: `${CAPTURE_CONFIG.version}-${configHash()}`,
    app_version: APP_VERSION,
  });
  return sessionLog;
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
    const [torch, log] = await Promise.all([torchFor(), logFor()]);
    return {
      vision: made.client,
      speed: made.speed,
      real: made.real,
      runner: new CaptureRunner({
        session: captureSession,
        vision: made.client,
        audio: voiceGuide,
        speed: made.speed,
        selfTimedBurst: made.real,
        sensorTilt: made.real ? () => tilt : undefined,
        torch,
        log,
        requireMask: made.real,
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
