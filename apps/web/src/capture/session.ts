// The capture in progress, held in memory only. Numbers only; nothing here is an image.
import type { LocalProfile } from '../db/storage';
import { trackFrame, untrackFrame } from '../vision/ledger';
import type { PersonMask, View, ViewChecks } from '../vision/types';
import type { CombinedView } from './burst';
import type { FreeArm } from './checks';
import { CaptureEvent, CaptureMode, Machine, initialMachine, transition } from './machine';

export interface ViewCapture extends Omit<CombinedView, 'mask'> {
  checks: ViewChecks;
  free_arm: FreeArm;
}

export class CaptureSession {
  machine: Machine = initialMachine();
  views: Partial<Record<View, ViewCapture>> = {};
  /** Combined person masks, for M7's profiles. In memory only, and released after computing. */
  masks: Partial<Record<View, PersonMask>> = {};
  profile: LocalProfile | null = null;
  /** What the camera and the models really used, read back at capture (10.1). */
  streamSize: { width: number; height: number } | null = null;
  modelVariant: 'lite' | 'full' = 'lite';
  startedAt = '';
  /** Set after a save, so Saved can show the status while the profile syncs. */
  savedProfileId: string | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getMachine = () => this.machine;

  send(event: CaptureEvent): void {
    const next = transition(this.machine, event);
    if (next === this.machine) return;
    this.machine = next;
    this.listeners.forEach((listener) => listener());
  }

  /** A fresh capture from /setup, whatever happened before. */
  begin(mode: CaptureMode): void {
    this.machine = initialMachine();
    this.views = {};
    this.releaseMasks();
    this.profile = null;
    this.startedAt = new Date().toISOString();
    this.send({ type: 'START', mode });
  }

  /** The client could not hear the phone and fetched a helper (A3 item 2). */
  setMode(mode: CaptureMode): void {
    this.machine = { ...this.machine, context: { ...this.machine.context, mode } };
    this.listeners.forEach((listener) => listener());
  }

  holdMask(view: View, mask: PersonMask | null): void {
    if (this.masks[view]) untrackFrame('mask');
    delete this.masks[view];
    if (!mask) return;
    this.masks[view] = mask;
    trackFrame('mask');
  }

  /** Called once the numbers are out (9.9, privacy invariant 2). */
  releaseMasks(): void {
    untrackFrame('mask', Object.keys(this.masks).length);
    this.masks = {};
  }

  /** Release everything from the capture (9.9, privacy invariant 2). */
  clear(): void {
    this.releaseMasks();
    this.machine = initialMachine();
    this.views = {};
    this.profile = null;
    this.listeners.forEach((listener) => listener());
  }
}

export const captureSession = new CaptureSession();
