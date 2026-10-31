// Drives one capture from the walk-away to the end of the burst: timers, checks, voice.
// Views only draw what `snapshot` says, so all of this runs in a test without a browser.
import type { TranslationKey } from '../i18n/en';
import { VisionClient } from '../vision/client';
import type { Landmark, View } from '../vision/types';
import type { AudioPort } from './audio';
import { combineBurst } from './burst';
import { CAPTURE_CONFIG } from './config';
import { CheckId, CheckOutcome, CheckResults, evaluateChecks, firstFailing, toViewChecks } from './checks';
import { CheckFilter, GuidancePacer, InstructionHold } from './guidance';
import { CORRECTION_CLIPS, MessageKey } from './messages';
import type { CaptureSession } from './session';

export type Border = 'ok' | 'wait' | 'stop';

export interface RunnerSnapshot {
  results: CheckResults | null;
  instruction: TranslationKey | null;
  border: Border;
  walkLeft: number | null;
  countdown: number | null;
  transitionLeft: number | null;
  shutterReady: boolean;
  tilt: { beta: number; gamma: number };
}

const EMPTY: RunnerSnapshot = {
  results: null,
  instruction: null,
  border: 'stop',
  walkLeft: null,
  countdown: null,
  transitionLeft: null,
  shutterReady: false,
  tilt: { beta: 90, gamma: 0 },
};

export interface RunnerDeps {
  session: CaptureSession;
  vision: VisionClient;
  audio: AudioPort;
  /** Below 1 runs all waits faster, for tests. Fake vision only. */
  speed?: number;
  now?: () => number;
  /** Tilt from the phone's sensors; when absent the sample's own value is used. */
  sensorTilt?: () => { beta: number; gamma: number } | null;
}

export class CaptureRunner {
  snapshot: RunnerSnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private filter = new CheckFilter();
  private pacer = new GuidancePacer();
  private hold = new InstructionHold<TranslationKey>();
  private history: Landmark[][] = [];
  private greenSince: number | null = null;
  private lastOutcome: CheckOutcome | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private epoch = 0;
  private stopped = false;
  private failures = 0;
  private unsubscribe: () => void;
  private lastState = '';
  private startedSampling = false;
  private readonly speed: number;
  private readonly clock: () => number;

  constructor(private readonly deps: RunnerDeps) {
    this.speed = deps.speed ?? 1;
    const base = deps.now ?? (() => Date.now());
    // Thresholds stay as written, and the clock runs faster under a test speed.
    this.clock = () => base() / this.speed;
    this.unsubscribe = deps.session.subscribe(() => this.onState());
    this.onState();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  stop(): void {
    this.stopped = true;
    this.epoch += 1;
    this.clearTimers();
    this.unsubscribe();
    this.deps.vision.terminate();
    this.deps.audio.stop();
  }

  private patch(changes: Partial<RunnerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    this.listeners.forEach((listener) => listener());
  }

  private after(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.stopped) run();
    }, ms * this.speed);
    this.timers.add(timer);
  }

  private clearTimers(): void {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }

  private say(key: MessageKey, interrupt = false): void {
    this.deps.audio.say(key, { interrupt });
  }

  private onState(): void {
    const { state } = this.deps.session.machine;
    const stamp = JSON.stringify(state);
    if (stamp === this.lastState) return;
    const previous = this.lastState;
    this.lastState = stamp;
    this.epoch += 1;
    this.clearTimers();
    switch (state.name) {
      case 'walkAway':
        this.enterWalkAway();
        break;
      case 'checking':
        this.enterChecking(state.view, previous);
        break;
      case 'countdown':
        this.enterCountdown();
        break;
      case 'burst':
        void this.enterBurst(state.view);
        break;
      case 'viewDone':
        this.enterViewDone(state.view);
        break;
      default:
        break;
    }
  }

  private enterWalkAway(): void {
    this.patch({ ...EMPTY, walkLeft: CAPTURE_CONFIG.timing.walkAwaySec });
    this.say('walk_away', true);
    const tick = (left: number) => {
      if (left <= 0) {
        this.patch({ walkLeft: null });
        this.deps.session.send({ type: 'WALK_DONE' });
        return;
      }
      this.patch({ walkLeft: left });
      this.deps.audio.tone('pass');
      if (left <= 5) this.say(`n${left}` as MessageKey);
      this.after(1000, () => tick(left - 1));
    };
    this.after(1000, () => tick(CAPTURE_CONFIG.timing.walkAwaySec - 1));
  }

  private enterChecking(view: View, previous: string): void {
    const fromCountdown = previous.includes('countdown');
    this.patch({ countdown: null, walkLeft: null, transitionLeft: null, shutterReady: false });
    if (!fromCountdown) {
      this.filter.reset();
      this.pacer.reset();
      this.history = [];
      void this.deps.vision.reset(view).catch(() => {});
    }
    this.greenSince = null;
    this.startSampling(view);
  }

  private startSampling(view: View): void {
    const epoch = this.epoch;
    const loop = async () => {
      if (epoch !== this.epoch || this.stopped) return;
      try {
        const sample = await this.deps.vision.live();
        this.failures = 0;
        if (epoch !== this.epoch || this.stopped) return;
        this.onSample(view, sample);
      } catch {
        this.failures += 1;
        if (this.failures >= 3) {
          this.deps.session.send({ type: 'VISION_UNAVAILABLE' });
          return;
        }
      }
      if (epoch === this.epoch) this.after(CAPTURE_CONFIG.timing.sampleMs, () => void loop());
    };
    void loop();
  }

  private onSample(view: View, sample: Awaited<ReturnType<VisionClient['live']>>): void {
    const { machine } = this.deps.session;
    const levelUnchecked = machine.context.levelUnchecked;
    const orientation = this.deps.sensorTilt?.() ?? null;
    const outcome = evaluateChecks({ view, sample, orientation, levelUnchecked, history: this.history });
    if (sample.landmarks) {
      this.history = [...this.history, sample.landmarks].slice(-CAPTURE_CONFIG.stability.window);
    }
    this.lastOutcome = outcome;
    const now = this.clock();
    const stable = this.filter.update(now, outcome.results);
    const failing: CheckId | null = firstFailing(stable);
    const key = failing ? (outcome.corrections[failing] ?? null) : null;
    const clip = key ? (CORRECTION_CLIPS[key] ?? null) : null;

    for (const action of this.pacer.update(now, stable, clip)) {
      if ('tone' in action) this.deps.audio.tone(action.tone);
      else this.say(action.speak as MessageKey);
    }

    const failed = Object.values(stable).filter((ok) => !ok).length;
    const border: Border = failed === 0 ? 'ok' : failed === 1 ? 'wait' : 'stop';
    const tilt = orientation ?? sample.orientation ?? this.snapshot.tilt;
    const instruction = this.hold.update(now, key);

    if (machine.state.name === 'countdown') {
      this.patch({ results: stable, instruction, border, tilt });
      if (failing) {
        this.deps.audio.tone('stop');
        this.deps.session.send({ type: 'CHECK_FAILED' });
      }
      return;
    }

    if (failing) this.greenSince = null;
    else this.greenSince ??= now;
    const green = this.greenSince !== null && now - this.greenSince >= CAPTURE_CONFIG.timing.allGreenMs;
    this.patch({ results: stable, instruction, border, tilt, shutterReady: green });
    if (green && machine.context.mode === 'self') this.deps.session.send({ type: 'ALL_GREEN' });
  }

  private enterCountdown(): void {
    this.deps.audio.tone('chime');
    const view = (this.deps.session.machine.state as { view: View }).view;
    this.startSampling(view);
    const tick = (left: number) => {
      if (left <= 0) {
        this.deps.audio.tone('beepLong');
        this.patch({ countdown: null });
        this.deps.session.send({ type: 'COUNTDOWN_ZERO' });
        return;
      }
      this.patch({ countdown: left });
      this.deps.audio.tone('beep');
      this.say(`n${left}` as MessageKey, true);
      this.after(1000, () => tick(left - 1));
    };
    tick(CAPTURE_CONFIG.timing.countdownSec);
  }

  private async enterBurst(view: View): Promise<void> {
    const epoch = this.epoch;
    this.patch({ countdown: null, shutterReady: false });
    this.say('hold_still', true);
    const { session, vision } = this.deps;
    let combined = null;
    try {
      // About a second for the five frames (10.4).
      await new Promise<void>((resolve) =>
        this.after(CAPTURE_CONFIG.burst.frames * CAPTURE_CONFIG.burst.spacingMs, resolve),
      );
      combined = combineBurst(await vision.burst(view));
    } catch {
      combined = null;
    }
    if (epoch !== this.epoch || this.stopped) return;
    if (!combined || !this.lastOutcome) {
      this.say('try_again', true);
      session.send({ type: 'BURST_BAD' });
      return;
    }
    session.views[view] = {
      ...combined,
      checks: toViewChecks(this.lastOutcome, session.machine.context.levelUnchecked),
      free_arm: view === 'front' ? this.freeArmOf(combined) : null,
    };
    session.send({ type: 'BURST_OK' });
  }

  private freeArmOf(combined: NonNullable<ReturnType<typeof combineBurst>>) {
    return evaluateChecks({
      view: 'front',
      sample: {
        image_w: combined.marker.image_w,
        image_h: combined.marker.image_h,
        landmarks: combined.landmarks,
        mask: null,
        marker: combined.marker,
        luminance: 130,
        sharpness: 300,
      },
    }).freeArm;
  }

  private enterViewDone(view: View): void {
    const { audio, session } = this.deps;
    audio.tone('done');
    this.say('done', true);
    const { doneMs, sideTransitionSec } = CAPTURE_CONFIG.timing;
    const last = view === 'side' || session.machine.context.retakeOf !== null;
    if (last) {
      this.say('finished');
      this.after(doneMs, () => session.send({ type: 'ADVANCE' }));
      return;
    }
    this.after(doneMs, () => {
      this.say('turn_right');
      const tick = (left: number) => {
        if (left <= 0) {
          this.patch({ transitionLeft: null });
          session.send({ type: 'ADVANCE' });
          return;
        }
        this.patch({ transitionLeft: left });
        this.after(1000, () => tick(left - 1));
      };
      tick(sideTransitionSec);
    });
  }
}
