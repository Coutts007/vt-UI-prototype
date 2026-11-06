// Camera permission and motion sensors. The capture stream itself is in cameraManager.ts.
import { CAPTURE_CONFIG } from './config';
export type CameraResult = { ok: true } | { ok: false; reason: 'denied' | 'unavailable' };

export type CameraFacing = 'environment' | 'user';

export const CAMERA_VIDEO: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1080 },
  height: { ideal: 1920 },
  aspectRatio: { ideal: 9 / 16 },
  frameRate: { ideal: 30, max: 30 },
};

/** The same stream for either camera (10.1.1, A4). The front camera is asked for exactly. */
export function cameraConstraints(facing: CameraFacing): MediaTrackConstraints {
  return facing === 'user' ? { ...CAMERA_VIDEO, facingMode: { exact: 'user' } } : CAMERA_VIDEO;
}

/** Asks for the camera once and lets it go, so capture can open it without another prompt. */
export async function requestCameraPermission(
  facing: CameraFacing = 'environment',
): Promise<CameraResult & { streamMax?: number }> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(facing), audio: false });
    const capabilities = stream.getVideoTracks()[0]?.getCapabilities?.();
    const streamMax = capabilities ? Math.max(capabilities.width?.max ?? 0, capabilities.height?.max ?? 0) : 0;
    stream.getTracks().forEach((track) => track.stop());
    return { ok: true, streamMax };
  } catch (error) {
    const name = (error as DOMException).name;
    return { ok: false, reason: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable' };
  }
}

export type MotionPermission = 'granted' | 'denied' | 'not-needed';

type IosOrientation = { requestPermission?: () => Promise<'granted' | 'denied'> };

export function motionNeedsPermission(): boolean {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window &&
    typeof (window.DeviceOrientationEvent as unknown as IosOrientation).requestPermission === 'function';
}

/** Must run inside a tap on iOS. */
export async function requestMotionPermission(): Promise<MotionPermission> {
  if (!motionNeedsPermission()) return 'not-needed';
  try {
    const answer = await (window.DeviceOrientationEvent as unknown as IosOrientation).requestPermission!();
    return answer === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export interface Tilt {
  beta: number;
  gamma: number;
}

type Up = [number, number, number];
const DEG = Math.PI / 180;

/** The "up" direction in the phone's own axes, from the event's Z-X'-Y'' angles (W3C). */
function upVector(beta: number, gamma: number): Up {
  const b = beta * DEG;
  const g = gamma * DEG;
  return [-Math.sin(g) * Math.cos(b), Math.sin(b), Math.cos(g) * Math.cos(b)];
}

/**
 * Lean and sideways tilt from the up vector (D50). `beta` is 90 minus the lean towards or away from
 * the screen; `gamma` is the rotation in the screen plane. Both read as the event's angles on a phone
 * near upright, but stay steady at 90 degrees, where the event's own gamma jumps wildly (gimbal lock).
 */
function tiltFromUp([x, y, z]: Up): Tilt {
  const norm = Math.hypot(x, y, z) || 1;
  return {
    beta: 90 - Math.asin(Math.max(-1, Math.min(1, z / norm))) / DEG,
    gamma: Math.atan2(-x, y) / DEG,
  };
}

export function tiltFromAngles(beta: number, gamma: number): Tilt {
  return tiltFromUp(upVector(beta, gamma));
}

/**
 * Low-pass filter on the up vector, so sensor jitter on a still phone does not flicker the level check.
 * Averaging the vector, not the angles, avoids wrap-around at +-180 degrees.
 */
export function createTiltSmoother(timeConstantMs: number) {
  let up: Up | null = null;
  let last = 0;
  return (beta: number, gamma: number, now: number): Tilt => {
    const next = upVector(beta, gamma);
    if (!up) {
      up = next;
    } else {
      const a = 1 - Math.exp(-Math.max(0, now - last) / timeConstantMs);
      up = [up[0] + a * (next[0] - up[0]), up[1] + a * (next[1] - up[1]), up[2] + a * (next[2] - up[2])];
    }
    last = now;
    return tiltFromUp(up);
  };
}

export function subscribeToOrientation(callback: (tilt: Tilt) => void): () => void {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return () => {};
  const smooth = createTiltSmoother(CAPTURE_CONFIG.level.smoothingMs);
  const handler = (event: DeviceOrientationEvent) => {
    if (event.beta === null || event.gamma === null) return;
    callback(smooth(event.beta, event.gamma, performance.now()));
  };
  window.addEventListener('deviceorientation', handler);
  return () => window.removeEventListener('deviceorientation', handler);
}
