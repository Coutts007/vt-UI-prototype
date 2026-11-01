// The sync queue (frontend-spec 12.2). Decides per reply what becomes of each queued operation.
import type { ApiClient } from '../api/http';
import { ApiError, NetworkError } from '../api/http';
import { APP_VERSION } from '../appVersion';
import { LocalProfile, PendingSyncOp, vtStorage } from './storage';

const MINUTE = 60_000;
export const BACKOFF_MS = [MINUTE / 2, MINUTE, 2 * MINUTE, 5 * MINUTE, 15 * MINUTE, 60 * MINUTE];
export const GIVE_UP_MS = 24 * 60 * MINUTE;
export const HELP_AFTER_ATTEMPTS = 3;
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
  const { sync_status: _status, needs_help: _help, secret_refused: _refused, ...payload } = profile;
  return payload;
}

type Outcome = 'done' | 'retry' | 'stop';

async function sendCreate(op: PendingSyncOp, api: SyncDeps['api']): Promise<Outcome> {
  const profile = await vtStorage.getProfileById(op.profile_id);
  if (!profile) return 'done';
  try {
    await api.post('/profiles', {
      body: toPayload(profile),
      headers: {
        'Idempotency-Key': profile.profile_id,
        'X-Client-Secret': await vtStorage.secretFor(profile.client_code),
        'X-App-Version': APP_VERSION,
      },
    } as never);
    await vtStorage.db.profiles.update(profile.profile_id, {
      sync_status: 'synced',
      needs_help: false,
      secret_refused: false,
    });
    await vtStorage.purgeAfterSync(profile.profile_id);
    return 'done';
  } catch (error) {
    if (error instanceof NetworkError) return 'stop';
    if (!(error instanceof ApiError)) throw error;
    if (error.code === 'client_secret_refused') {
      // Another phone claimed this code. It stays queued, so it sends once the tailor frees the code.
      console.warn('profile_sync_refused', error.code);
      await vtStorage.db.profiles.update(profile.profile_id, { secret_refused: true });
      return 'retry';
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
  const secret = await vtStorage.existingSecret(op.client_code);
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
    if (error.code === 'client_secret_refused') await vtStorage.updateOp(op.op_id!, { secret_refused: true });
    return 'retry';
  }
}

/** One pass over the queue. Returns how many operations were sent or settled. */
export async function runSync(deps: SyncDeps): Promise<number> {
  const now = deps.now ?? Date.now;
  const online = deps.online ?? (() => navigator.onLine);
  if (!online()) return 0;
  let settled = 0;
  for (const op of await vtStorage.getPendingOps()) {
    if (op.gave_up && !deps.includeGaveUp) continue;
    if (!op.gave_up && !deps.ignoreBackoff && Date.parse(op.next_attempt_at) > now()) continue;
    if (op.operation === 'create') await vtStorage.updateOp(op.op_id!, { started: true });
    const outcome =
      op.operation === 'create' ? await sendCreate(op, deps.api) : await sendDeletion(op, deps.api);
    if (outcome === 'done') {
      await vtStorage.removeOp(op.op_id!);
      settled += 1;
      continue;
    }
    const attempts = op.attempts + 1;
    const gaveUp = now() - Date.parse(op.created_at) >= GIVE_UP_MS;
    await vtStorage.updateOp(op.op_id!, {
      attempts,
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
  /** Another phone holds this code, so only the tailor can free it (D45). */
  secretRefused: boolean;
  /** A deletion could not be proved from this phone, so it has not happened yet. */
  deletionRefused: boolean;
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
    deletionRefused: ops.some((op) => op.operation !== 'create' && op.secret_refused),
    rejected: visible.some((p) => p.sync_status === 'rejected'),
    overdue: ops.some((op) => op.gave_up),
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
