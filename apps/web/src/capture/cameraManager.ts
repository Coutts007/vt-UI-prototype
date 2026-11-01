// The capture camera (frontend-spec 10.1). Loaded on demand. It gives out frames only to the vision
// pipeline and keeps none of them.
import { frameGeometry } from '../vision/frameMath';
import { trackFrame } from '../vision/ledger';
import { CAPTURE_CONFIG } from './config';
import { CAMERA_VIDEO } from './camera';

export interface AppliedCamera {
  width: number;
  height: number;
  frameRate: number | null;
  zoom: number | null;
  focusMode: string | null;
  label: string;
  /** Whether a lens or zoom change was asked for and held. Read on /dev/capture-tuning. */
  zoomPinned: boolean;
  still: 'imagecapture' | 'canvas';
}

type ZoomCaps = MediaTrackCapabilities & { zoom?: { min: number; max: number }; focusMode?: string[] };
type ZoomSettings = MediaTrackSettings & { zoom?: number; focusMode?: string };
interface PhotoCapture {
  takePhoto(): Promise<Blob>;
}
type WithImageCapture = { ImageCapture?: new (track: MediaStreamTrack) => PhotoCapture };

const WIDE = /wide|ultra|0\.5|macro|tele/i;

/** The rear camera to use: not a wide lens, and first in the browser's order (10.1.2). */
export function pickRearCamera(devices: Pick<MediaDeviceInfo, 'kind' | 'label' | 'deviceId'>[], current: string): string | null {
  const isRear = (d: { label: string }) => /back|rear|environment|facing back/i.test(d.label);
  if (!WIDE.test(current)) return null;
  const choice = devices.find((d) => d.kind === 'videoinput' && isRear(d) && !WIDE.test(d.label));
  return choice?.deviceId ?? null;
}

export class CameraTooSmall extends Error {}
export class CameraStopped extends Error {}

export class CameraManager {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  /** Bumps on every start and stop, so a getUserMedia still pending when we leave lets go of its stream. */
  private generation = 0;
  private opening: Promise<AppliedCamera> | null = null;
  applied: AppliedCamera | null = null;

  private readonly onPageHide = () => this.stop();

  private async open(constraints: MediaTrackConstraints, generation: number): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      throw new CameraStopped('camera_stopped');
    }
    return stream;
  }

  /** Opens the stream, or returns the one already open. Safe to stop while it is still pending. */
  start(): Promise<AppliedCamera> {
    if (this.applied && this.stream) return Promise.resolve(this.applied);
    this.opening ??= this.startFresh().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async startFresh(): Promise<AppliedCamera> {
    this.releaseStream(); // Safari falls to 640 x 480 if an old stream is still open (10.1.6).
    const generation = ++this.generation;
    let stream = await this.open(CAMERA_VIDEO, generation);
    let track = stream.getVideoTracks()[0];

    // After permission the labels are real, so a wide lens can be swapped for the main one.
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const better = pickRearCamera(devices, track.label);
      if (generation !== this.generation) throw new CameraStopped('camera_stopped');
      if (better) {
        stream.getTracks().forEach((t) => t.stop());
        stream = await this.open({ ...CAMERA_VIDEO, facingMode: undefined, deviceId: { exact: better } }, generation);
        track = stream.getVideoTracks()[0];
      }
    } catch (error) {
      if (error instanceof CameraStopped) {
        stream.getTracks().forEach((t) => t.stop());
        throw error;
      }
      // Keeping the first lens is fine: each view has its own marker scale.
    }

    this.stream = stream;
    window.addEventListener('pagehide', this.onPageHide);
    const zoomPinned = await this.pin(track);
    if (generation !== this.generation) throw new CameraStopped('camera_stopped');

    const settings = track.getSettings() as ZoomSettings;
    const portrait = frameGeometry(settings.width ?? 0, settings.height ?? 0, 1e6, true);
    if (Math.max(portrait.w, portrait.h) < CAPTURE_CONFIG.frames.minLongEdge) {
      this.stop();
      throw new CameraTooSmall('camera_too_small');
    }
    this.applied = {
      width: portrait.w,
      height: portrait.h,
      frameRate: settings.frameRate ?? null,
      zoom: settings.zoom ?? null,
      focusMode: settings.focusMode ?? null,
      label: track.label,
      zoomPinned,
      still: (window as unknown as WithImageCapture).ImageCapture ? 'imagecapture' : 'canvas',
    };
    if (this.video) this.attach(this.video);
    return this.applied;
  }

  /** Zoom 1 keeps the main lens, and continuous focus where offered. Ignored constraints never fail. */
  private async pin(track: MediaStreamTrack): Promise<boolean> {
    const caps = (track.getCapabilities?.() ?? {}) as ZoomCaps;
    const advanced: Record<string, unknown>[] = [];
    if (caps.zoom && caps.zoom.min < 1) advanced.push({ zoom: 1 });
    if (caps.focusMode?.includes('continuous')) advanced.push({ focusMode: 'continuous' });
    if (!advanced.length) return false;
    try {
      await track.applyConstraints({ advanced } as MediaTrackConstraints);
    } catch {
      return false;
    }
    return (track.getSettings() as ZoomSettings).zoom === 1;
  }

  private attach(video: HTMLVideoElement): void {
    if (video.srcObject !== this.stream) video.srcObject = this.stream;
    void video.play().catch(() => {});
  }

  /** Each capture screen has its own video element. The stream carries on from front to side. */
  mount(video: HTMLVideoElement | null): void {
    this.video = video;
    if (video && this.stream) this.attach(video);
  }

  /** One frame at most `longEdge` pixels long, upright. The caller owns it and must close it. */
  async grab(longEdge: number): Promise<ImageBitmap> {
    const video = this.video;
    if (!video || !this.stream || video.readyState < 2 || !video.videoWidth) throw new Error('no_frame');
    const { w, h, rotate } = frameGeometry(video.videoWidth, video.videoHeight, longEdge, true);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no_canvas');
    if (rotate) {
      context.translate(w, 0);
      context.rotate(Math.PI / 2);
      context.drawImage(video, 0, 0, h, w);
    } else {
      context.drawImage(video, 0, 0, w, h);
    }
    const bitmap = await createImageBitmap(canvas);
    canvas.width = 0;
    canvas.height = 0;
    trackFrame('bitmap');
    return bitmap;
  }

  /** The full-resolution still, on Android only (10.1.5). Null wherever it is unavailable. */
  async still(): Promise<ImageBitmap | null> {
    const track = this.stream?.getVideoTracks()[0];
    const Capture = (window as unknown as WithImageCapture).ImageCapture;
    if (!track || !Capture) return null;
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), CAPTURE_CONFIG.timing.stillTimeoutMs);
      });
      const photo = await Promise.race([new Capture(track).takePhoto(), late]);
      clearTimeout(timer);
      if (!photo) return null;
      const bitmap = await createImageBitmap(photo);
      trackFrame('bitmap');
      return bitmap;
    } catch {
      return null;
    }
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.applied = null;
    if (this.video) this.video.srcObject = null;
  }

  /** Stops every track, including one still being opened (10.1.6). */
  stop(): void {
    this.generation += 1;
    this.releaseStream();
    window.removeEventListener('pagehide', this.onPageHide);
  }
}

export const captureCamera = new CameraManager();

/** Keeps the screen on, and asks again when the phone comes back (9.7). */
export function keepScreenOn(): () => void {
  let lock: WakeLockSentinel | null = null;
  let held = true;
  const acquire = () => {
    if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
    void navigator.wakeLock
      .request('screen')
      .then((next) => {
        if (held) lock = next;
        else void next.release().catch(() => {});
      })
      .catch(() => {});
  };
  acquire();
  document.addEventListener('visibilitychange', acquire);
  return () => {
    held = false;
    document.removeEventListener('visibilitychange', acquire);
    void lock?.release().catch(() => {});
    lock = null;
  };
}
