// Pilot instrumentation (M15): every check's value per sample and the capture events, numbers only,
// in memory. /dev/capture-tuning downloads it as JSON. Never a frame, a code or a name.
import type { CheckId, CheckResults } from './checks';
import type { View } from '../vision/types';

export interface LogSample {
  t: number;
  view: View;
  state: string;
  checks: Record<CheckId, boolean>;
  person_height: number | null;
  marker_px: number | null;
  luminance: number;
  sharpness: number;
  beta: number;
  gamma: number;
}

export interface LogEvent {
  t: number;
  event: string;
  view: View | null;
  retake_count: number;
}

/** The only things the log says about a capture. No field for a code, a name or a value. */
export interface LogMeta {
  capture_mode?: 'self' | 'assisted';
  camera_facing?: 'environment' | 'user';
  guidance_mode?: 'voice' | 'visual';
  level_unchecked?: boolean;
  config?: string;
  app_version?: string;
  started_at?: string;
}

const MAX_SAMPLES = 4000;

export class SessionLog {
  meta: LogMeta = {};
  samples: LogSample[] = [];
  events: LogEvent[] = [];
  private startedAt = 0;

  begin(meta: LogMeta, now = Date.now()): void {
    this.meta = { ...meta, started_at: new Date(now).toISOString() };
    this.samples = [];
    this.events = [];
    this.startedAt = now;
  }

  sample(entry: Omit<LogSample, 't'>, now = Date.now()): void {
    if (this.samples.length >= MAX_SAMPLES) return;
    this.samples.push({ t: now - this.startedAt, ...entry });
  }

  event(event: string, view: View | null, retakeCount: number, now = Date.now()): void {
    this.events.push({ t: now - this.startedAt, event, view, retake_count: retakeCount });
  }

  clear(): void {
    this.begin({}, 0);
    this.meta = {};
  }

  toJSON(): { meta: LogMeta; events: LogEvent[]; samples: LogSample[] } {
    return { meta: this.meta, events: this.events, samples: this.samples };
  }
}

export const sessionLog = new SessionLog();
