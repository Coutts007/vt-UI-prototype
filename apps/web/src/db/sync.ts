// The sync queue (frontend-spec 12.2). Decides per reply what becomes of each queued operation.
import type { ApiClient } from '../api/http';
import { ApiError, NetworkError } from '../api/http';
import { APP_VERSION } from '../appVersion';
import { LocalProfile, PendingSyncOp, vtStorage } from './storage';

const MINUTE = 60_000;
export const BACKOFF_MS = [MINUTE / 2, MINUTE, 2 * MINUTE, 5 * MINUTE, 15 * MINUTE, 60 * MINUTE];
export const GIVE_UP_MS = 24 * 60 * MINUTE;
export const HELP_AFTER_ATTEMPTS = 3;
/** About eight minutes of backoff. A refusal will not change by itself, so asking again is noise. */
export const REFUSAL_LIMIT = 5;
const TIMER_MS = 30_000;

export function backoffMs(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[0];
}

export interface SyncDeps {
  api: Pick<ApiClient, 'post'>;
  now?: () => number;
  online?: () => boolean;
  /** App start: also try operations past the 24-hour window. */
  includeGaveUp?: boolean;
  /** Back online: the wait was for the connection, so try now. */
  ignoreBackoff?: boolean;
}

function toPayload(profile: LocalProfile) {
  const {
    sync_status: _status,
    needs_help: _help,
    secret_refused: _refused,
    no_secret: _none,
    ...payload
  } = profile;
  return payload;
}

type Outcome = 'done' | 'retry' | 'stop' | 'refused';

async function sendCreate(op: PendingSyncOp, api: SyncDeps['api']): Promise<Outcome> {
  const profile = await vtStorage.getProfileById(op.profile_id);
  if (!profile) return 'done';
  let secret: string;
  try {
    secret = await vtStorage.secretFor(profile.client_code);
  } catch {
    // Storage is full or broken. Only this code is stuck, so the others still go.
    console.warn('profile_sync_refused', 'no_secret');
    await vtStorage.db.profiles.update(profile.profile_id, { no_secret: true }).catch(() => 0);
    return 'refused';
  }
  try {
    await api.post('/profiles', {
      body: toPayload(profile),
      headers: {
        'Idempotency-Key': profile.profile_id,
        'X-Client-Secret': secret,
        'X-App-Version': APP_VERSION,
      },
    } as never);
    await vtStorage.db.profiles.update(profile.profile_id, {
      sync_status: 'synced',
      needs_help: false,
      secret_refused: false,
      no_secret: false,
    });
    await vtStorage.purgeAfterSync(profile.profile_id);
    return 'done';
  } catch (error) {
    if (error instanceof NetworkError) return 'stop';
    if (!(error instanceof ApiError)) throw error;
    if (error.code === 'client_secret_refused') {
      // It stays on this phone, and the client can try again once the tailor has helped.
      console.warn('profile_sync_refused', error.code);
      await vtStorage.db.profiles.update(profile.profile_id, { secret_refused: true, no_secret: false });
      return 'refused';
    }
    if (error.code === 'profile_deleted') {
      // The client already asked for this to go, so it must not linger here either.
      await vtStorage.db.profiles.delete(profile.profile_id);
      await vtStorage.purgeAfterSync(profile.profile_id);
      return 'done';
    }
    if (error.status === 409 && error.code === 'stale_app_version') {
      // Not a conflict: nothing reached the server. An updated app can still send this profile.
      console.warn('profile_sync_refused', error.code);
      if (op.attempts + 1 >= HELP_AFTER_ATTEMPTS) {
        await vtStorage.db.profiles.update(profile.profile_id, { needs_help: true });
      }
      return 'retry';
    }
    if (error.status === 409) {
      await vtStorage.updateProfileSyncStatus(profile.profile_id, 'conflict');
      await vtStorage.purgeAfterSync(profile.profile_id);
      return 'done';
    }
    if (error.code === 'code_not_found') {
      await vtStorage.updateProfileSyncStatus(profile.profile_id, 'rejected');
      await vtStorage.purgeAfterSync(profile.profile_id);
      return 'done';
    }
    if (error.status === 413 || error.status === 415 || error.status === 422) {
      // No measurements or codes in the log, only what kind of refusal it was (golden rule 4).
      console.warn('profile_sync_refused', error.code);
      if (op.attempts + 1 >= HELP_AFTER_ATTEMPTS) {
        await vtStorage.db.profiles.update(profile.profile_id, { needs_help: true });
      }
    }
    return 'retry';
  }
}

async function sendDeletion(op: PendingSyncOp, api: SyncDeps['api']): Promise<Outcome> {
  if (!op.client_code) return 'done';
  // No secret still asks: the server has nothing to prove against if the code never received data.
  const secret = await vtStorage.existingSecret(op.client_code).catch(() => null);
  try {
    await api.post('/deletion-requests', {
      body: {
        client_code: op.client_code,
        reason: op.operation === 'withdraw' ? 'withdraw_consent' : 'delete',
      },
      headers: secret ? { 'X-Client-Secret': secret } : {},
    } as never);
    return 'done';
  } catch (error) {
    if (error instanceof NetworkError) return 'stop';
    if (!(error instanceof ApiError)) throw error;
    // Never dropped on a refusal: the client asked for this, and it has not happened.
    if (error.code === 'client_secret_refused') {
      await vtStorage.updateOp(op.op_id!, { secret_refused: !!secret, no_secret: !secret });
      return 'refused';
    }
    return 'retry';
  }
}

const refusalEnded = (op: PendingSyncOp) => (op.refusals ?? 0) >= REFUSAL_LIMIT;

/** One pass over the queue. Returns how many operations were sent or settled. */
export async function runSync(deps: SyncDeps): Promise<number> {
  const now = deps.now ?? Date.now;
  const online = deps.online ?? (() => navigator.onLine);
  if (!online()) return 0;
  let settled = 0;
  const ops = await vtStorage.getPendingOps();
  // A deletion wipes all of a client's data, so a later upload must not arrive before it runs (D45).
  const clearing = new Map<string, number>();
  for (const op of ops) {
    if (op.operation !== 'create' && op.client_code) {
      clearing.set(op.client_code, (clearing.get(op.client_code) ?? 0) + 1);
    }
  }
  for (const op of ops) {
    if (refusalEnded(op)) continue;
    if (op.operation === 'create' && op.client_code && clearing.get(op.client_code)) continue;
    if (op.gave_up && !deps.includeGaveUp) continue;
    if (!op.gave_up && !deps.ignoreBackoff && Date.parse(op.next_attempt_at) > now()) continue;
    if (op.operation === 'create') await vtStorage.updateOp(op.op_id!, { started: true });
    const outcome =
      op.operation === 'create' ? await sendCreate(op, deps.api) : await sendDeletion(op, deps.api);
    if (outcome === 'done') {
      await vtStorage.removeOp(op.op_id!);
      settled += 1;
      if (op.operation !== 'create' && op.client_code) {
        clearing.set(op.client_code, (clearing.get(op.client_code) ?? 1) - 1);
      }
      continue;
    }
    const attempts = op.attempts + 1;
    const refusals = (op.refusals ?? 0) + (outcome === 'refused' ? 1 : 0);
    const gaveUp = refusals >= REFUSAL_LIMIT || now() - Date.parse(op.created_at) >= GIVE_UP_MS;
    await vtStorage.updateOp(op.op_id!, {
      attempts,
      refusals,
      gave_up: gaveUp,
      next_attempt_at: new Date(now() + backoffMs(attempts)).toISOString(),
    });
    if (outcome === 'stop') break;
  }
  await vtStorage.pruneLeftSecrets();
  return settled;
}

export interface SyncNotice {
  /** The server refused a profile three times (12.2). */
  needsHelp: boolean;
  /** The server would not accept this phone for a code, so a profile has not been sent (D45). */
  secretRefused: boolean;
  /** This phone could not make or keep a secret, so a profile has not been sent. */
  noSecret: boolean;
  /** The server refused this phone's secret, so a deletion has not happened yet. */
  deletionRefused: boolean;
  /** This phone has no secret to prove a deletion with, so it has not happened yet. */
  deletionNoSecret: boolean;
  /** Refusals used up the retries, so only asking again will send anything. */
  refusalEnded: boolean;
  /** A code was refused and can be corrected on My measurements. */
  rejected: boolean;
  /** Something has waited past the 24-hour window. */
  overdue: boolean;
  unsent: number;
}

export async function readNotice(): Promise<SyncNotice> {
  const [ops, profiles, visible] = await Promise.all([
    vtStorage.getPendingOps(),
    vtStorage.getProfiles(),
    vtStorage.getVisibleProfiles(),
  ]);
  return {
    needsHelp: visible.some((p) => p.needs_help),
    secretRefused: visible.some((p) => p.secret_refused),
    noSecret: visible.some((p) => p.no_secret),
    deletionRefused: ops.some((op) => op.operation !== 'create' && op.secret_refused),
    deletionNoSecret: ops.some((op) => op.operation !== 'create' && op.no_secret),
    refusalEnded: ops.some(refusalEnded),
    rejected: visible.some((p) => p.sync_status === 'rejected'),
    overdue: ops.some((op) => op.gave_up && !refusalEnded(op)),
    unsent: profiles.filter((p) => p.sync_status === 'pending').length,
  };
}

const listeners = new Set<() => void>();
export function onSyncChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let running: Promise<void> | null = null;
let api: SyncDeps['api'] | null = null;

export function syncNow(includeGaveUp = false, ignoreBackoff = false): Promise<void> {
  if (!api) return Promise.resolve();
  const client = api;
  running ??= runSync({ api: client, includeGaveUp, ignoreBackoff })
    .catch(() => 0)
    .then(() => {
      running = null;
      listeners.forEach((listener) => listener());
    });
  return running;
}

/** The triggers from 12.2: app start, back online, back in view, a timer, and after each save. */
export function startSyncLoop(client: SyncDeps['api']): () => void {
  api = client;
  const trigger = () => void syncNow();
  const visible = () => {
    if (document.visibilityState === 'visible') trigger();
  };
  const backOnline = () => void syncNow(true, true);
  window.addEventListener('online', backOnline);
  document.addEventListener('visibilitychange', visible);
  const timer = setInterval(trigger, TIMER_MS);
  void syncNow(true);
  return () => {
    window.removeEventListener('online', backOnline);
    document.removeEventListener('visibilitychange', visible);
    clearInterval(timer);
  };
}
