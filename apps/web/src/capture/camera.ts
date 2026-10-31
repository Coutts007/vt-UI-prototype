export class CameraManager {
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;

  async startStream(
    videoElement: HTMLVideoElement,
    preferredFacing: 'environment' | 'user' = 'environment'
  ): Promise<{ width: number; height: number }> {
    this.videoEl = videoElement;
    this.stopStream();

    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: { ideal: preferredFacing },
        width: { ideal: 1080 },
        height: { ideal: 1920 },
      },
      audio: false,
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch {
      // Fallback with generic video constraint
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    this.videoEl.srcObject = this.stream;
    await this.videoEl.play();

    return {
      width: this.videoEl.videoWidth || 1080,
      height: this.videoEl.videoHeight || 1920,
    };
  }

  stopStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
  }

  hasActiveStream(): boolean {
    return !!(this.stream && this.stream.active);
  }
}

export interface OrientationState {
  beta: number; // front-back tilt (-180..180). 90 is upright
  gamma: number; // left-right tilt (-90..90). 0 is level
  supported: boolean;
  permissionGranted: boolean;
}

export function subscribeToOrientation(
  callback: (state: OrientationState) => void
): () => void {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
    callback({ beta: 90, gamma: 0, supported: false, permissionGranted: false });
    return () => {};
  }

  const handler = (e: DeviceOrientationEvent) => {
    const beta = e.beta !== null ? Math.round(e.beta * 10) / 10 : 90;
    const gamma = e.gamma !== null ? Math.round(e.gamma * 10) / 10 : 0;
    callback({
      beta,
      gamma,
      supported: true,
      permissionGranted: true,
    });
  };

  window.addEventListener('deviceorientation', handler);
  return () => {
    window.removeEventListener('deviceorientation', handler);
  };
}
