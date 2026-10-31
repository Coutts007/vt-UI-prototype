// Camera permission and preview. Real capture arrives in M6; no frame is read from this stream.
export type CameraResult = { ok: true } | { ok: false; reason: 'denied' | 'unavailable' };

const VIDEO: MediaStreamConstraints['video'] = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1080 },
  height: { ideal: 1920 },
  aspectRatio: { ideal: 9 / 16 },
  frameRate: { ideal: 30, max: 30 },
};

/** Asks for the camera once and lets it go, so capture can open it without another prompt. */
export async function requestCameraPermission(): Promise<CameraResult & { streamMax?: number }> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: false });
    const capabilities = stream.getVideoTracks()[0]?.getCapabilities?.();
    const streamMax = capabilities ? Math.max(capabilities.width?.max ?? 0, capabilities.height?.max ?? 0) : 0;
    stream.getTracks().forEach((track) => track.stop());
    return { ok: true, streamMax };
  } catch (error) {
    const name = (error as DOMException).name;
    return { ok: false, reason: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable' };
  }
}

export class CameraManager {
  private stream: MediaStream | null = null;

  async start(video: HTMLVideoElement): Promise<void> {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: false });
    video.srcObject = this.stream;
    await video.play();
  }

  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
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

export function subscribeToOrientation(callback: (tilt: Tilt) => void): () => void {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return () => {};
  const handler = (event: DeviceOrientationEvent) => {
    if (event.beta === null || event.gamma === null) return;
    callback({ beta: event.beta, gamma: event.gamma });
  };
  window.addEventListener('deviceorientation', handler);
  return () => window.removeEventListener('deviceorientation', handler);
}
