// Hysteresis and spoken pacing (frontend-spec 10.3, A3 item 3). Time is passed in, so it is testable.
import { CAPTURE_CONFIG, CaptureConfig } from './config';
import { CHECK_ORDER, CheckId, CheckResults } from './checks';

/** A check must hold a new state for the hysteresis time before the screen and voice follow it. */
export class CheckFilter {
  private stable: CheckResults | null = null;
  private since: Partial<Record<CheckId, number>> = {};

  constructor(private readonly config: CaptureConfig = CAPTURE_CONFIG) {}

  update(now: number, raw: CheckResults): CheckResults {
    if (!this.stable) {
      this.stable = { ...raw };
      return this.stable;
    }
    const next = { ...this.stable };
    for (const id of CHECK_ORDER) {
      if (raw[id] === next[id]) {
        delete this.since[id];
        continue;
      }
      const started = this.since[id] ?? now;
      this.since[id] = started;
      if (now - started >= this.config.timing.hysteresisMs) {
        next[id] = raw[id];
        delete this.since[id];
      }
    }
    this.stable = next;
    return next;
  }

  reset(): void {
    this.stable = null;
    this.since = {};
  }
}

/** The on-screen message stays at least the hold time, unless the problem is fixed. */
export class InstructionHold<T> {
  private current: T | null = null;
  private shownAt = 0;

  constructor(private readonly config: CaptureConfig = CAPTURE_CONFIG) {}

  update(now: number, wanted: T | null): T | null {
    if (wanted === null) {
      this.current = null;
      return null;
    }
    if (this.current === null) {
      this.current = wanted;
      this.shownAt = now;
    } else if (wanted !== this.current && now - this.shownAt >= this.config.timing.messageHoldMs) {
      this.current = wanted;
      this.shownAt = now;
    }
    return this.current;
  }
}

export type PacerAction = { speak: string } | { tone: 'pass' };

/**
 * At most one spoken correction per 3 s, the same one again every 6 s while it lasts,
 * and "Good" with a pass tone when a check turns green.
 */
export class GuidancePacer {
  private spokenKey: string | null = null;
  private lastCorrectionAt = -Infinity;
  private lastGoodAt = -Infinity;
  private greens = new Set<CheckId>();
  private first = true;

  constructor(private readonly config: CaptureConfig = CAPTURE_CONFIG) {}

  update(now: number, results: CheckResults, correction: string | null): PacerAction[] {
    const { correctionGapMs, repeatMs, goodGapMs } = this.config.pacing;
    const actions: PacerAction[] = [];
    let turned = false;
    for (const id of CHECK_ORDER) {
      if (results[id] && !this.greens.has(id)) {
        if (!this.first) turned = true;
        this.greens.add(id);
      } else if (!results[id]) {
        this.greens.delete(id);
      }
    }
    this.first = false;

    if (turned) {
      actions.push({ tone: 'pass' });
      if (now - this.lastGoodAt >= goodGapMs) {
        actions.push({ speak: 'good' });
        this.lastGoodAt = now;
      }
    }

    if (correction === null) {
      this.spokenKey = null;
      return actions;
    }
    const gap = now - this.lastCorrectionAt;
    const repeat = correction === this.spokenKey && gap >= repeatMs;
    const change = correction !== this.spokenKey && gap >= correctionGapMs;
    if (repeat || change) {
      actions.push({ speak: correction });
      this.spokenKey = correction;
      this.lastCorrectionAt = now;
    }
    return actions;
  }

  /** A burst or countdown speaks over everything, and the next view starts fresh. */
  reset(): void {
    this.spokenKey = null;
    this.greens.clear();
    this.first = true;
  }
}
