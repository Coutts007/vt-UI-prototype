// One test per transition (frontend-spec 10.7). The last test proves none was missed.
import { describe, expect, it } from 'vitest';
import {
  CaptureContext,
  CaptureEvent,
  CaptureState,
  INITIAL_CONTEXT,
  listTransitions,
  transition,
} from '../../src/capture/machine';

type Case = {
  from: CaptureState;
  event: CaptureEvent;
  to?: CaptureState;
  ctx?: Partial<CaptureContext>;
  after?: Partial<CaptureContext>;
};
const f = 'front' as const;
const s = 'side' as const;
const assisted = { mode: 'assisted' as const };
const review = { name: 'review' } as const;

const CASES: Case[] = [
  {
    from: { name: 'idle' },
    event: { type: 'START', mode: 'assisted' },
    to: { name: 'permissions' },
    after: assisted,
  },
  { from: { name: 'permissions' }, event: { type: 'PERMISSIONS_OK' }, to: { name: 'leveling' } },
  {
    from: { name: 'permissions' },
    event: { type: 'MOTION_DENIED' },
    to: { name: 'leveling' },
    after: { levelUnchecked: true },
  },
  {
    from: { name: 'permissions' },
    event: { type: 'PERMISSION_DENIED' },
    to: { name: 'error', kind: 'camera_denied' },
  },
  {
    from: { name: 'permissions' },
    event: { type: 'CAMERA_UNAVAILABLE' },
    to: { name: 'error', kind: 'camera_unavailable' },
  },
  { from: { name: 'permissions' }, event: { type: 'STOP' }, to: { name: 'idle' } },
  { from: { name: 'leveling' }, event: { type: 'LEVEL_OK' }, to: { name: 'walkAway', view: f } },
  {
    from: { name: 'leveling' },
    event: { type: 'LEVEL_SKIPPED' },
    to: { name: 'walkAway', view: f },
    after: { levelUnchecked: true },
  },
  { from: { name: 'leveling' }, event: { type: 'STOP' }, to: { name: 'idle' } },
  {
    from: { name: 'walkAway', view: s },
    event: { type: 'WALK_DONE' },
    to: { name: 'checking', view: s },
  },
  {
    from: { name: 'walkAway', view: f },
    event: { type: 'VISION_UNAVAILABLE' },
    to: { name: 'error', kind: 'vision_unavailable' },
  },
  { from: { name: 'walkAway', view: f }, event: { type: 'STOP' }, to: { name: 'idle' } },
  {
    from: { name: 'checking', view: f },
    event: { type: 'ALL_GREEN' },
    to: { name: 'countdown', view: f },
  },
  {
    from: { name: 'checking', view: f },
    event: { type: 'SHUTTER' },
    ctx: assisted,
    to: { name: 'burst', view: f },
  },
  {
    from: { name: 'checking', view: s },
    event: { type: 'FLIP_VIEW' },
    ctx: assisted,
    to: { name: 'checking', view: f },
  },
  {
    from: { name: 'checking', view: f },
    event: { type: 'VISION_UNAVAILABLE' },
    to: { name: 'error', kind: 'vision_unavailable' },
  },
  { from: { name: 'checking', view: s }, event: { type: 'STOP' }, to: { name: 'idle' } },
  {
    from: { name: 'countdown', view: f },
    event: { type: 'CHECK_FAILED' },
    to: { name: 'checking', view: f },
  },
  {
    from: { name: 'countdown', view: s },
    event: { type: 'COUNTDOWN_ZERO' },
    to: { name: 'burst', view: s },
  },
  { from: { name: 'countdown', view: f }, event: { type: 'STOP' }, to: { name: 'idle' } },
  {
    from: { name: 'burst', view: f },
    event: { type: 'BURST_OK' },
    to: { name: 'viewDone', view: f },
  },
  {
    from: { name: 'burst', view: s },
    event: { type: 'BURST_BAD' },
    to: { name: 'checking', view: s },
  },
  { from: { name: 'burst', view: f }, event: { type: 'STOP' }, to: { name: 'idle' } },
  {
    from: { name: 'viewDone', view: f },
    event: { type: 'ADVANCE' },
    to: { name: 'checking', view: s },
  },
  { from: { name: 'viewDone', view: f }, event: { type: 'STOP' }, to: { name: 'idle' } },
  {
    from: { name: 'computing' },
    event: { type: 'COMPUTED' },
    ctx: { crashes: 1 },
    to: { name: 'scaleCheck' },
    after: { crashes: 0 },
  },
  {
    from: { name: 'computing' },
    event: { type: 'WORKER_CRASH' },
    to: { name: 'computing' },
    after: { crashes: 1 },
  },
  {
    from: { name: 'scaleCheck' },
    event: { type: 'SCALE_OK' },
    ctx: { retakeOf: f, scaleDisagree: s },
    to: review,
    after: { retakeOf: null, scaleDisagree: null },
  },
  {
    from: { name: 'scaleCheck' },
    event: { type: 'SCALE_DISAGREE', view: s },
    to: review,
    after: { scaleDisagree: s },
  },
  {
    from: review,
    event: { type: 'RETAKE', view: s },
    ctx: { retakeCount: 1 },
    to: { name: 'retake', view: s },
    after: { retakeOf: s, retakeCount: 2 },
  },
  { from: review, event: { type: 'SAVE' }, to: { name: 'saved' } },
  { from: review, event: { type: 'SAVE_FAILED' }, to: { name: 'error', kind: 'storage_failed' } },
  { from: review, event: { type: 'DISCARD' }, to: { name: 'discarded' } },
  {
    from: { name: 'retake', view: f },
    event: { type: 'BEGIN_RETAKE' },
    to: { name: 'walkAway', view: f },
  },
  {
    from: { name: 'retake', view: f },
    event: { type: 'STOP' },
    ctx: { retakeOf: f },
    to: review,
    after: { retakeOf: null },
  },
  { from: { name: 'saved' }, event: { type: 'RESET' }, to: { name: 'idle' } },
  { from: { name: 'discarded' }, event: { type: 'RESET' }, to: { name: 'idle' } },
  {
    from: { name: 'error', kind: 'camera_denied' },
    event: { type: 'RETRY' },
    to: { name: 'permissions' },
  },
  {
    from: { name: 'error', kind: 'worker_crash' },
    event: { type: 'RETAKE', view: f },
    to: { name: 'retake', view: f },
    after: { retakeOf: f, retakeCount: 1 },
  },
  { from: { name: 'error', kind: 'worker_crash' }, event: { type: 'RESET' }, to: { name: 'idle' } },
];

const run = (from: CaptureState, event: CaptureEvent, ctx: Partial<CaptureContext> = {}) =>
  transition({ state: from, context: { ...INITIAL_CONTEXT, ...ctx } }, event);

describe('every transition', () => {
  it.each(CASES.map((c) => [`${c.from.name} + ${c.event.type}`, c] as const))('%s', (_, c) => {
    const next = run(c.from, c.event, c.ctx);
    expect(next.state).toEqual(c.to);
    if (c.after) expect(next.context).toMatchObject(c.after);
  });

  it('the cases cover the whole table', () => {
    const tested = new Set(CASES.map((c) => `${c.from.name}+${c.event.type}`));
    expect(listTransitions().filter((t) => !tested.has(t))).toEqual([]);
  });
});

describe('branches and guards', () => {
  it('the side view moves on to computing', () => {
    expect(run({ name: 'viewDone', view: s }, { type: 'ADVANCE' }).state).toEqual({
      name: 'computing',
    });
  });
  it('a retake of the front view does not repeat the side view', () => {
    expect(run({ name: 'viewDone', view: f }, { type: 'ADVANCE' }, { retakeOf: f }).state).toEqual({
      name: 'computing',
    });
  });
  it('a second crash asks for a retake', () => {
    const next = run({ name: 'computing' }, { type: 'WORKER_CRASH' }, { crashes: 1 });
    expect(next.state).toEqual({ name: 'error', kind: 'worker_crash' });
    expect(next.context.crashes).toBe(0);
  });
  it('all green does not start the countdown with a helper', () => {
    const from = { name: 'checking', view: f } as const;
    expect(run(from, { type: 'ALL_GREEN' }, assisted).state).toEqual(from);
  });
  it('the shutter does nothing when alone', () => {
    const from = { name: 'checking', view: f } as const;
    expect(run(from, { type: 'SHUTTER' }).state).toEqual(from);
  });
  it('only a helper can flip back, and only from the side view', () => {
    expect(run({ name: 'checking', view: s }, { type: 'FLIP_VIEW' }).state.name).toBe('checking');
    const front = { name: 'checking', view: f } as const;
    expect(run(front, { type: 'FLIP_VIEW' }, assisted).state).toEqual(front);
    expect(run({ name: 'checking', view: s }, { type: 'FLIP_VIEW' }).state).toEqual({
      name: 'checking',
      view: s,
    });
  });
  it('a camera error retries, a crash does not', () => {
    const crash = { name: 'error', kind: 'worker_crash' } as const;
    expect(run(crash, { type: 'RETRY' }).state).toEqual(crash);
    const storage = { name: 'error', kind: 'storage_failed' } as const;
    expect(run(storage, { type: 'RETRY' }).state).toEqual(review);
    const denied = { name: 'error', kind: 'camera_denied' } as const;
    expect(run(denied, { type: 'RETAKE', view: f }).state).toEqual(denied);
  });
  it('an event the state does not handle changes nothing', () => {
    const start = { state: { name: 'review' } as const, context: { ...INITIAL_CONTEXT } };
    expect(transition(start, { type: 'ALL_GREEN' })).toBe(start);
  });
  it('stopping clears the session flags', () => {
    const next = run({ name: 'checking', view: f }, { type: 'STOP' }, { levelUnchecked: true });
    expect(next.context).toEqual(INITIAL_CONTEXT);
  });
});
