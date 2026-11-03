// The torch cue experiment (A3 item 5, D25): slow blink while almost ready, fast in the countdown,
// out before the burst, and never with the front camera.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioPort } from '../../src/capture/audio';
import { CAPTURE_CONFIG } from '../../src/capture/config';
import { CaptureRunner } from '../../src/capture/runner';
import { CaptureSession } from '../../src/capture/session';
import { SessionLog } from '../../src/capture/sessionLog';
import { TorchCue, TorchPhase, TorchPort } from '../../src/capture/torch';
import { VisionClient } from '../../src/vision/client';
import { DEFAULT_FAKE, FakeOptions, FakeVisionWorker } from '../../src/vision/fakeVision';

class Ear implements AudioPort {
  say() {}
  sayAll() {}
  tone() {}
  stop() {}
}

class FakeTorch implements TorchPort {
  phases: { at: number; phase: TorchPhase }[] = [];
  offs: number[] = [];
  phase(next: TorchPhase) {
    this.phases.push({ at: Date.now(), phase: next });
  }
  async off() {
    this.offs.push(Date.now());
  }
}

function start(options: Partial<FakeOptions> = {}) {
  const session = new CaptureSession();
  const torch = new FakeTorch();
  const log = new SessionLog();
  log.begin({ capture_mode: 'self', camera_facing: 'environment' });
  const vision = new VisionClient(new FakeVisionWorker({ ...DEFAULT_FAKE, ...options }));
  const runner = new CaptureRunner({ session, vision, audio: new Ear(), torch, log });
  session.begin('self');
  session.send({ type: 'PERMISSIONS_OK' });
  session.send({ type: 'LEVEL_OK' });
  return { session, torch, log, runner };
}
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

describe('TorchCue', () => {
  it('blinks slowly while almost ready, fast in the countdown, and goes out', async () => {
    const track = { applyConstraints: vi.fn(async () => {}) };
    const cue = new TorchCue(() => track);
    cue.phase('almost');
    await wait(CAPTURE_CONFIG.torch.slowPeriodMs * 2);
    expect(cue.changes).toEqual([true, false, true, false, true]);
    cue.phase('countdown');
    await wait(CAPTURE_CONFIG.torch.fastPeriodMs);
    expect(cue.changes.slice(5)).toEqual([true, false, true]);
    await cue.off();
    expect(cue.changes.at(-1)).toBe(false);
    await wait(2000);
    expect(cue.changes.length).toBe(9);
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] });
  });

  it('does nothing without a torch track, and survives a refused constraint', async () => {
    const none = new TorchCue(() => null);
    none.phase('almost');
    await wait(3000);
    expect(none.changes).toEqual([]);
    await none.off();
    const refusing = new TorchCue(() => ({ applyConstraints: vi.fn(async () => { throw new Error('no'); }) }));
    refusing.phase('countdown');
    await wait(1000);
    await refusing.off();
    expect(refusing.changes.at(-1)).toBe(false);
  });
});

describe('the runner drives the cue', () => {
  it('almost ready on green, countdown on the countdown, off 300 ms before the burst', async () => {
    const { session, torch, runner } = start();
    await wait(8100);
    expect(torch.phases[0]?.phase).toBe('off');
    await wait(500);
    expect(torch.phases.at(-1)?.phase).toBe('almost');
    await wait(800);
    expect(session.machine.state.name).toBe('countdown');
    const countdownAt = torch.phases.find((p) => p.phase === 'countdown')!.at;
    await wait(3100);
    expect(session.machine.state.name).toBe('burst');
    const burstAt = Date.now() - 100;
    expect(torch.offs[0]).toBeLessThanOrEqual(burstAt - CAPTURE_CONFIG.torch.offBeforeBurstMs);
    expect(torch.offs[0]).toBeGreaterThan(countdownAt);
    runner.stop();
    expect(torch.offs.length).toBeGreaterThanOrEqual(2);
  });

  it('stays off while two or more checks fail, and goes back to almost when one is left', async () => {
    const { torch, runner } = start({ scenario: 'too_far', recover: true });
    await wait(8100 + 500);
    const phases = torch.phases.map((p) => p.phase);
    expect(phases).toContain('off');
    await wait(6000);
    expect(torch.phases.at(-1)?.phase).toMatch(/almost|countdown/);
    runner.stop();
  });
});

describe('the session log', () => {
  it('records numbers per sample and the capture events, nothing else', async () => {
    const { log, runner } = start();
    await wait(8100 + 1300 + 3100 + 1100);
    expect(log.events.map((e) => e.event)).toEqual(['walk_away', 'checking', 'countdown', 'burst', 'view_done']);
    expect(log.samples.length).toBeGreaterThan(5);
    const sample = log.samples[0];
    expect(sample.view).toBe('front');
    expect(typeof sample.luminance).toBe('number');
    expect(sample.checks.level).toBe(true);
    for (const value of Object.values(sample)) {
      expect(['number', 'string', 'object', 'boolean']).toContain(typeof value);
      if (typeof value === 'string') expect(value.length).toBeLessThan(20);
    }
    const text = JSON.stringify(log.toJSON());
    expect(text).not.toMatch(/data:|base64|mask|landmarks/);
    expect(Object.keys(log.toJSON().meta).sort()).toEqual(['camera_facing', 'capture_mode', 'started_at']);
    expect(Object.keys(sample).sort()).toEqual([
      'beta', 'checks', 'gamma', 'luminance', 'marker_px', 'person_height', 'sharpness', 'state', 't', 'view',
    ]);
    runner.stop();
  });

  it('keeps at most 4000 samples and clears', () => {
    const log = new SessionLog();
    log.begin({ capture_mode: 'self' }, 5);
    const entry = {
      view: 'front' as const, state: 'checking', checks: {} as never, person_height: null, marker_px: null,
      luminance: 1, sharpness: 2, beta: 90, gamma: 0,
    };
    for (let i = 0; i < 4100; i += 1) log.sample(entry, 5 + i);
    expect(log.samples.length).toBe(4000);
    expect(log.samples[1].t).toBe(1);
    expect(log.meta.started_at).toBe('1970-01-01T00:00:00.005Z');
    log.clear();
    expect(log.samples).toEqual([]);
    expect(log.meta).toEqual({});
  });
});
