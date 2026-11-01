import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CameraManager,
  CameraStopped,
  CameraTooSmall,
  keepScreenOn,
  pickRearCamera,
} from '../../src/capture/cameraManager';

function fakeTrack(settings: Record<string, unknown> = {}, caps: Record<string, unknown> = {}) {
  const current = { width: 1080, height: 1920, frameRate: 30, ...settings };
  return {
    label: 'camera 0, facing back',
    stop: vi.fn(),
    getCapabilities: () => caps,
    getSettings: () => current,
    applyConstraints: vi.fn(async ({ advanced }: { advanced: Record<string, unknown>[] }) => {
      for (const part of advanced) Object.assign(current, part);
    }),
  };
}
const streamOf = (track: ReturnType<typeof fakeTrack>) =>
  ({ getTracks: () => [track], getVideoTracks: () => [track] }) as unknown as MediaStream;

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn();
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia, enumerateDevices: async () => [] },
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('camera (10.1)', () => {
  it('stops the stream if we left while getUserMedia was pending (M5 finding)', async () => {
    const track = fakeTrack();
    let resolve!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise((r) => (resolve = r)));
    const camera = new CameraManager();
    const started = camera.start();
    await Promise.resolve();
    camera.stop();
    resolve(streamOf(track));
    await expect(started).rejects.toBeInstanceOf(CameraStopped);
    expect(track.stop).toHaveBeenCalled();
    expect(camera.applied).toBeNull();
  });

  it('asks for the rear camera at 1080p, with no audio', async () => {
    getUserMedia.mockResolvedValue(streamOf(fakeTrack()));
    await new CameraManager().start();
    const asked = getUserMedia.mock.calls[0][0];
    expect(asked.audio).toBe(false);
    expect(asked.video.facingMode).toEqual({ ideal: 'environment' });
    expect(asked.video.height).toEqual({ ideal: 1920 });
  });

  it('pins zoom to 1 where the lens can go wider, and reads back what applied', async () => {
    const track = fakeTrack(
      { zoom: 0.6 },
      { zoom: { min: 0.5, max: 8 }, focusMode: ['continuous', 'manual'] },
    );
    getUserMedia.mockResolvedValue(streamOf(track));
    const applied = await new CameraManager().start();
    expect(track.applyConstraints).toHaveBeenCalledWith({
      advanced: [{ zoom: 1 }, { focusMode: 'continuous' }],
    });
    expect(applied).toMatchObject({
      zoom: 1,
      zoomPinned: true,
      focusMode: 'continuous',
      width: 1080,
      height: 1920,
    });
  });

  it('leaves zoom alone when the camera has no wider lens', async () => {
    const track = fakeTrack({}, { zoom: { min: 1, max: 8 } });
    getUserMedia.mockResolvedValue(streamOf(track));
    const applied = await new CameraManager().start();
    expect(track.applyConstraints).not.toHaveBeenCalled();
    expect(applied.zoomPinned).toBe(false);
  });

  it('does not fail when the browser refuses a constraint', async () => {
    const track = fakeTrack({}, { zoom: { min: 0.5, max: 8 } });
    track.applyConstraints.mockRejectedValue(new Error('no'));
    getUserMedia.mockResolvedValue(streamOf(track));
    await expect(new CameraManager().start()).resolves.toMatchObject({ zoomPinned: false });
  });

  it('records a landscape delivery as portrait', async () => {
    getUserMedia.mockResolvedValue(streamOf(fakeTrack({ width: 1920, height: 1080 })));
    expect(await new CameraManager().start()).toMatchObject({ width: 1080, height: 1920 });
  });

  it('refuses a camera below 1280 px and lets it go', async () => {
    const track = fakeTrack({ width: 640, height: 480 });
    getUserMedia.mockResolvedValue(streamOf(track));
    await expect(new CameraManager().start()).rejects.toBeInstanceOf(CameraTooSmall);
    expect(track.stop).toHaveBeenCalled();
  });

  it('stop ends every track, and a second start opens afresh', async () => {
    const first = fakeTrack();
    const second = fakeTrack();
    getUserMedia.mockResolvedValueOnce(streamOf(first)).mockResolvedValueOnce(streamOf(second));
    const camera = new CameraManager();
    await camera.start();
    camera.stop();
    expect(first.stop).toHaveBeenCalled();
    await camera.start();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('start is shared while the camera is open', async () => {
    getUserMedia.mockResolvedValue(streamOf(fakeTrack()));
    const camera = new CameraManager();
    await Promise.all([camera.start(), camera.start()]);
    await camera.start();
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it('swaps a wide lens for the main rear camera', () => {
    const devices = [
      { kind: 'videoinput', label: 'back ultra wide', deviceId: 'a' },
      { kind: 'videoinput', label: 'camera 2, facing back', deviceId: 'b' },
    ] as MediaDeviceInfo[];
    expect(pickRearCamera(devices, 'back ultra wide')).toBe('b');
    expect(pickRearCamera(devices, 'camera 2, facing back')).toBeNull();
  });

  it('still is null where ImageCapture does not exist (iOS)', async () => {
    getUserMedia.mockResolvedValue(streamOf(fakeTrack()));
    const camera = new CameraManager();
    await camera.start();
    expect(camera.applied?.still).toBe('canvas');
    await expect(camera.still()).resolves.toBeNull();
  });

  it('takes a still with ImageCapture on Android', async () => {
    const bitmap = { close: vi.fn() };
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      ImageCapture: class {
        takePhoto = async () => new Blob(['x']);
      },
    });
    vi.stubGlobal('createImageBitmap', async () => bitmap);
    getUserMedia.mockResolvedValue(streamOf(fakeTrack()));
    const camera = new CameraManager();
    await camera.start();
    expect(camera.applied?.still).toBe('imagecapture');
    await expect(camera.still()).resolves.toBe(bitmap);
  });
});

describe('wake lock', () => {
  it('holds the lock, asks again on return, and releases on leaving', async () => {
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ release }));
    const listeners: Record<string, () => void> = {};
    vi.stubGlobal('navigator', { wakeLock: { request } });
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (name: string, fn: () => void) => (listeners[name] = fn),
      removeEventListener: vi.fn(),
    });
    const stop = keepScreenOn();
    await Promise.resolve();
    expect(request).toHaveBeenCalledOnce();
    listeners.visibilitychange();
    expect(request).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    await Promise.resolve();
    stop();
    expect(release).toHaveBeenCalled();
  });
  it('a lock granted after leaving is released at once', async () => {
    const release = vi.fn(async () => {});
    let grant!: (lock: { release: typeof release }) => void;
    vi.stubGlobal('navigator', { wakeLock: { request: () => new Promise((r) => (grant = r)) } });
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    keepScreenOn()();
    grant({ release });
    await new Promise((r) => setTimeout(r, 0));
    expect(release).toHaveBeenCalled();
  });
});
