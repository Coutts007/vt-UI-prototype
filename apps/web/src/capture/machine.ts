// The capture state machine (frontend-spec 10.7). Pure: no timers, no browser, no React.
export type View = 'front' | 'side';
export type CaptureMode = 'self' | 'assisted';
export type ErrorKind =
  | 'camera_denied'
  | 'camera_unavailable'
  | 'vision_unavailable'
  | 'worker_crash'
  | 'storage_failed';

export type CaptureState =
  | { name: 'idle' }
  | { name: 'permissions' }
  | { name: 'leveling' }
  | { name: 'walkAway'; view: View }
  | { name: 'checking'; view: View }
  | { name: 'countdown'; view: View }
  | { name: 'burst'; view: View }
  | { name: 'viewDone'; view: View }
  | { name: 'computing' }
  | { name: 'scaleCheck' }
  | { name: 'review' }
  | { name: 'saved' }
  | { name: 'discarded' }
  | { name: 'error'; kind: ErrorKind }
  | { name: 'retake'; view: View };

export type CaptureEvent =
  | { type: 'START'; mode: CaptureMode }
  | { type: 'PERMISSIONS_OK' }
  | { type: 'MOTION_DENIED' }
  | { type: 'PERMISSION_DENIED' }
  | { type: 'CAMERA_UNAVAILABLE' }
  | { type: 'LEVEL_OK' }
  | { type: 'LEVEL_SKIPPED' }
  | { type: 'WALK_DONE' }
  | { type: 'ALL_GREEN' }
  | { type: 'SHUTTER' }
  | { type: 'CHECK_FAILED' }
  | { type: 'COUNTDOWN_ZERO' }
  | { type: 'BURST_OK' }
  | { type: 'BURST_BAD' }
  | { type: 'ADVANCE' }
  | { type: 'FLIP_VIEW' }
  | { type: 'VISION_UNAVAILABLE' }
  | { type: 'COMPUTED' }
  | { type: 'WORKER_CRASH' }
  | { type: 'SCALE_OK' }
  | { type: 'SCALE_DISAGREE'; view: View }
  | { type: 'RETAKE'; view: View }
  | { type: 'BEGIN_RETAKE' }
  | { type: 'SAVE' }
  | { type: 'SAVE_FAILED' }
  | { type: 'DISCARD' }
  | { type: 'RETRY' }
  | { type: 'STOP' }
  | { type: 'RESET' };

export type StateName = CaptureState['name'];
export type EventType = CaptureEvent['type'];

export interface CaptureContext {
  mode: CaptureMode;
  levelUnchecked: boolean;
  /** Set while one view is being retaken, so the other view is not repeated. */
  retakeOf: View | null;
  retakeCount: number;
  /** Runs of the computation that crashed since the last good one (retry once, 9.9). */
  crashes: number;
  scaleDisagree: View | null;
}

export const INITIAL_CONTEXT: CaptureContext = {
  mode: 'self',
  levelUnchecked: false,
  retakeOf: null,
  retakeCount: 0,
  crashes: 0,
  scaleDisagree: null,
};

export interface Machine {
  state: CaptureState;
  context: CaptureContext;
}

export const initialMachine = (): Machine => ({
  state: { name: 'idle' },
  context: { ...INITIAL_CONTEXT },
});

type Result = { state: CaptureState; context?: Partial<CaptureContext> } | null;
type Handler<S extends StateName, E extends EventType> = (
  state: Extract<CaptureState, { name: S }>,
  event: Extract<CaptureEvent, { type: E }>,
  context: CaptureContext,
) => Result;
type Table = { [S in StateName]: { [E in EventType]?: Handler<S, E> } };

const stop = (): Result => ({
  state: { name: 'idle' },
  context: { ...INITIAL_CONTEXT },
});
const go = (state: CaptureState, context?: Partial<CaptureContext>): Result => ({ state, context });

/** Null from a handler means a guard refused, so nothing changes. */
const TABLE: Table = {
  idle: {
    START: (_s, e) => go({ name: 'permissions' }, { ...INITIAL_CONTEXT, mode: e.mode }),
  },
  permissions: {
    PERMISSIONS_OK: () => go({ name: 'leveling' }),
    MOTION_DENIED: () => go({ name: 'leveling' }, { levelUnchecked: true }),
    PERMISSION_DENIED: () => go({ name: 'error', kind: 'camera_denied' }),
    CAMERA_UNAVAILABLE: () => go({ name: 'error', kind: 'camera_unavailable' }),
    STOP: stop,
  },
  leveling: {
    LEVEL_OK: () => go({ name: 'walkAway', view: 'front' }),
    LEVEL_SKIPPED: () => go({ name: 'walkAway', view: 'front' }, { levelUnchecked: true }),
    STOP: stop,
  },
  walkAway: {
    WALK_DONE: (s) => go({ name: 'checking', view: s.view }),
    VISION_UNAVAILABLE: () => go({ name: 'error', kind: 'vision_unavailable' }),
    STOP: stop,
  },
  checking: {
    // Alone, the phone counts down. With a helper, the shutter is pressed instead (9.7).
    ALL_GREEN: (s, _e, c) => (c.mode === 'self' ? go({ name: 'countdown', view: s.view }) : null),
    SHUTTER: (s, _e, c) => (c.mode === 'assisted' ? go({ name: 'burst', view: s.view }) : null),
    FLIP_VIEW: (s, _e, c) =>
      c.mode === 'assisted' && s.view === 'side' ? go({ name: 'checking', view: 'front' }) : null,
    VISION_UNAVAILABLE: () => go({ name: 'error', kind: 'vision_unavailable' }),
    STOP: stop,
  },
  countdown: {
    CHECK_FAILED: (s) => go({ name: 'checking', view: s.view }),
    COUNTDOWN_ZERO: (s) => go({ name: 'burst', view: s.view }),
    STOP: stop,
  },
  burst: {
    BURST_OK: (s) => go({ name: 'viewDone', view: s.view }),
    BURST_BAD: (s) => go({ name: 'checking', view: s.view }),
    STOP: stop,
  },
  viewDone: {
    ADVANCE: (s, _e, c) => {
      if (c.retakeOf || s.view === 'side') return go({ name: 'computing' });
      return go({ name: 'checking', view: 'side' });
    },
    STOP: stop,
  },
  computing: {
    COMPUTED: () => go({ name: 'scaleCheck' }, { crashes: 0 }),
    // A crash re-runs from the stored burst once. A second one asks for a retake (9.9).
    WORKER_CRASH: (_s, _e, c) =>
      c.crashes === 0
        ? go({ name: 'computing' }, { crashes: 1 })
        : go({ name: 'error', kind: 'worker_crash' }, { crashes: 0 }),
  },
  scaleCheck: {
    SCALE_OK: () => go({ name: 'review' }, { scaleDisagree: null, retakeOf: null }),
    SCALE_DISAGREE: (_s, e) => go({ name: 'review' }, { scaleDisagree: e.view, retakeOf: null }),
  },
  review: {
    RETAKE: (_s, e, c) =>
      go({ name: 'retake', view: e.view }, { retakeOf: e.view, retakeCount: c.retakeCount + 1 }),
    SAVE: () => go({ name: 'saved' }),
    SAVE_FAILED: () => go({ name: 'error', kind: 'storage_failed' }),
    DISCARD: () => go({ name: 'discarded' }),
  },
  retake: {
    BEGIN_RETAKE: (s) => go({ name: 'walkAway', view: s.view }),
    STOP: () => go({ name: 'review' }, { retakeOf: null }),
  },
  saved: { RESET: stop },
  discarded: { RESET: stop },
  error: {
    RETRY: (s) => {
      if (s.kind === 'camera_denied' || s.kind === 'camera_unavailable') {
        return go({ name: 'permissions' });
      }
      if (s.kind === 'storage_failed') return go({ name: 'review' });
      return null;
    },
    RETAKE: (s, e, c) =>
      s.kind === 'worker_crash'
        ? go({ name: 'retake', view: e.view }, { retakeOf: e.view, retakeCount: c.retakeCount + 1 })
        : null,
    RESET: stop,
  },
};

export function transition(machine: Machine, event: CaptureEvent): Machine {
  const handlers = TABLE[machine.state.name] as Record<
    string,
    ((s: CaptureState, e: CaptureEvent, c: CaptureContext) => Result) | undefined
  >;
  const result = handlers[event.type]?.(machine.state, event, machine.context);
  if (!result) return machine;
  return { state: result.state, context: { ...machine.context, ...result.context } };
}

/** Every "state + event" the table handles, so the test can prove it covers them all. */
export function listTransitions(): string[] {
  return Object.entries(TABLE).flatMap(([state, events]) =>
    Object.keys(events).map((event) => `${state}+${event}`),
  );
}
