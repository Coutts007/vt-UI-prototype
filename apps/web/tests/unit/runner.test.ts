// A whole capture on fake timers: what happens when, and what the client hears.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioPort, ToneName } from '../../src/capture/audio';
import { CaptureRunner } from '../../src/capture/runner';
import { CaptureSession } from '../../src/capture/session';
import { VisionClient } from '../../src/vision/client';
import { DEFAULT_FAKE, FakeOptions, FakeVisionWorker } from '../../src/vision/fakeVision';

class Ear implements AudioPort {
  words: string[] = [];
  tones: ToneName[] = [];
  say(key: string) {
    this.words.push(key);
  }
  sayAll(keys: string[]) {
    this.words.push(...keys);
  }
  tone(name: ToneName) {
    this.tones.push(name);
  }
  stop() {}
}

function start(options: Partial<FakeOptions> = {}, mode: 'self' | 'assisted' = 'self') {
  const session = new CaptureSession();
  const ear = new Ear();
  const vision = new VisionClient(new FakeVisionWorker({ ...DEFAULT_FAKE, ...options }));
  const runner = new CaptureRunner({ session, vision, audio: ear });
  session.begin(mode);
  session.send({ type: 'PERMISSIONS_OK' });
  session.send({ type: 'LEVEL_OK' });
  return { session, ear, runner };
}
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const name = (session: CaptureSession) => session.machine.state.name;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('self capture', () => {
  it('walk away, front, turn, side, then "walk back"', async () => {
    const { session, ear, runner } = start();
    expect(name(session)).toBe('walkAway');
    expect(ear.words[0]).toBe('walk_away');
    await wait(7900);
    expect(name(session)).toBe('walkAway');
    await wait(200);
    expect(session.machine.state).toEqual({ name: 'checking', view: 'front' });
    await wait(1300);
    expect(name(session)).toBe('countdown');
    await wait(3100);
    expect(name(session)).toBe('burst');
    await wait(1100);
    expect(session.machine.state).toEqual({ name: 'viewDone', view: 'front' });
    expect(session.views.front?.checks.level).toBe('pass');
    expect(session.views.front?.free_arm).toBe('left');
    await wait(1300);
    expect(ear.words).toContain('turn_right');
    await wait(6000);
    expect(session.machine.state).toEqual({ name: 'checking', view: 'side' });
    await wait(1300 + 3100 + 1100);
    expect(session.machine.state).toEqual({ name: 'viewDone', view: 'side' });
    await wait(1300);
    expect(name(session)).toBe('computing');
    expect(session.views.side).toBeDefined();
    // Everything A3 says must be heard, in order.
    const order = [
      'walk_away',
      'n5',
      'n1',
      'n3',
      'n2',
      'hold_still',
      'done',
      'turn_right',
      'finished',
    ];
    let at = -1;
    for (const word of order) {
      at = ear.words.indexOf(word, at + 1);
      expect(at, word).toBeGreaterThanOrEqual(0);
    }
    expect(ear.tones).toEqual(expect.arrayContaining(['chime', 'beep', 'beepLong', 'done']));
    runner.stop();
  });

  it('a failing check is spoken and blocks the countdown, then recovers', async () => {
    const { session, ear, runner } = start({ scenario: 'too_far', recover: true });
    await wait(8100);
    await wait(500);
    expect(name(session)).toBe('checking');
    expect(ear.words).toContain('corr_too_far');
    expect(runner.getSnapshot().instruction).toBe('corrTooFar');
    expect(runner.getSnapshot().border).not.toBe('ok');
    await wait(6000);
    expect(ear.words).toContain('good');
    expect(ear.tones).toContain('pass');
    expect(name(session)).toBe('countdown');
    runner.stop();
  });

  it('a check failing in the countdown cancels it with the stop tone', async () => {
    const { session, ear, runner } = start();
    await wait(8100);
    await wait(1300);
    expect(name(session)).toBe('countdown');
    const sample = vi.spyOn(VisionClient.prototype, 'live').mockImplementation(async () => ({
      image_w: 1080,
      image_h: 1920,
      landmarks: null,
      mask: null,
      marker: null,
      luminance: 130,
      sharpness: 300,
      orientation: { beta: 90, gamma: 0 },
    }));
    await wait(700);
    expect(session.machine.state).toEqual({ name: 'checking', view: 'front' });
    expect(ear.tones).toContain('stop');
    expect(runner.getSnapshot().countdown).toBeNull();
    sample.mockRestore();
    runner.stop();
  });

  it('a bad burst says try again and goes back to checking', async () => {
    const { session, ear, runner } = start({ scenario: 'burst_bad' });
    await wait(8100 + 1300 + 3100 + 1100);
    expect(ear.words).toContain('try_again');
    expect(session.views.front).toBeUndefined();
    await wait(1400 + 3100 + 1100);
    expect(session.views.front).toBeDefined();
    runner.stop();
  });

  it('a retake repeats only that view', async () => {
    const { session, runner } = start();
    await wait(8100 + 1300 + 3100 + 1100 + 1300 + 6000 + 1300 + 3100 + 1100 + 1300);
    expect(name(session)).toBe('computing');
    session.send({ type: 'COMPUTED' });
    session.send({ type: 'SCALE_OK' });
    session.send({ type: 'RETAKE', view: 'side' });
    session.send({ type: 'BEGIN_RETAKE' });
    expect(session.machine.state).toEqual({ name: 'walkAway', view: 'side' });
    await wait(8100 + 1300 + 3100 + 1100 + 1300);
    expect(name(session)).toBe('computing');
    expect(session.machine.context.retakeCount).toBe(1);
    runner.stop();
  });

  it('stopped runners do nothing more', async () => {
    const { session, ear, runner } = start();
    runner.stop();
    const heard = ear.words.length;
    await wait(20000);
    expect(ear.words).toHaveLength(heard);
    expect(name(session)).toBe('walkAway');
  });
});

describe('with a helper', () => {
  it('no countdown: the shutter enables on green and takes the burst', async () => {
    const { session, runner } = start({}, 'assisted');
    await wait(8100);
    await wait(1400);
    expect(name(session)).toBe('checking');
    expect(runner.getSnapshot().shutterReady).toBe(true);
    session.send({ type: 'SHUTTER' });
    expect(name(session)).toBe('burst');
    await wait(1100);
    expect(name(session)).toBe('viewDone');
    runner.stop();
  });
});

it('a speed below 1 runs the same flow faster', async () => {
  const session = new CaptureSession();
  const vision = new VisionClient(new FakeVisionWorker(DEFAULT_FAKE));
  const runner = new CaptureRunner({ session, vision, audio: new Ear(), speed: 0.1 });
  session.begin('self');
  session.send({ type: 'PERMISSIONS_OK' });
  session.send({ type: 'LEVEL_OK' });
  await vi.advanceTimersByTimeAsync(900);
  expect(name(session)).toBe('checking');
  runner.stop();
});
