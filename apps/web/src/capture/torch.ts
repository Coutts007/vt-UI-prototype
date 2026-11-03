// The torch cue experiment (A3 item 5, D25). In self-capture the flash LED faces the client, who
// cannot see the screen: it blinks slowly while the checks are almost green and fast during the
// countdown, and goes out well before the burst so it never changes the exposure. Rear camera only.
import { CAPTURE_CONFIG } from './config';

export type TorchPhase = 'off' | 'almost' | 'countdown';

export interface TorchPort {
  phase(next: TorchPhase): void;
  /** Resolves once the LED has been asked to go out. */
  off(): Promise<void>;
}

type TorchTrack = Pick<MediaStreamTrack, 'applyConstraints'>;

export class TorchCue implements TorchPort {
  private current: TorchPhase = 'off';
  private lit = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Every change the LED was asked for, for tests and the device log. */
  changes: boolean[] = [];

  constructor(private readonly getTrack: () => TorchTrack | null) {}

  phase(next: TorchPhase): void {
    if (next === this.current) return;
    this.current = next;
    this.clear();
    if (next === 'off') {
      void this.apply(false);
      return;
    }
    const period = next === 'almost' ? CAPTURE_CONFIG.torch.slowPeriodMs : CAPTURE_CONFIG.torch.fastPeriodMs;
    void this.apply(true);
    this.timer = setInterval(() => void this.apply(!this.lit), period / 2);
  }

  async off(): Promise<void> {
    this.current = 'off';
    this.clear();
    await this.apply(false);
  }

  private clear(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async apply(on: boolean): Promise<void> {
    const track = this.getTrack();
    if (!track) return;
    this.lit = on;
    this.changes.push(on);
    const constraints: Record<string, unknown>[] = [{ torch: on }];
    try {
      await track.applyConstraints({ advanced: constraints } as MediaTrackConstraints);
    } catch {
      // A torch the browser will not drive is simply no cue.
    }
  }
}
