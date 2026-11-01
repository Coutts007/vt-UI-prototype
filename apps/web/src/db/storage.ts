import { DETAILS_CLEARED_EVENT } from './events';
import Dexie, { Table } from 'dexie';
import type { components } from '@vt/contracts';

type Payload = components['schemas']['MeasurementProfilePayload'];
export type ConsentRecord = components['schemas']['ConsentRecord'];
export type SyncStatus = 'pending' | 'synced' | 'conflict' | 'rejected';

/** The contract payload plus what only the phone knows (D32). */
export interface LocalProfile extends Payload {
  sync_status: SyncStatus;
  /** The server refused it three times, so the client is told to contact their tailor. */
  needs_help?: boolean;
  /** The server would not accept this phone for this code. Why is not known here (D45). */
  secret_refused?: boolean;
  /** This phone could not make or keep the secret for this code. */
  no_secret?: boolean;
}

/** One per client code on this phone. Never in a profile, a payload or a log (D45). */
export interface ClientSecretRow {
  client_code: string;
  secret: string;
  /** An earlier client cleared this phone: kept only until their unsent work settles. */
  left?: boolean;
}

export interface PendingSyncOp {
  op_id?: number;
  created_at: string;
  profile_id: string;
  operation: 'create' | 'delete' | 'withdraw';
  attempts: number;
  next_attempt_at: string;
  /** Kept on the operation, because a deletion outlives the profile it names (D9). */
  client_code?: string;
  /** Past the 24-hour retry window (12.2). Tried again only when the app next opens. */
  gave_up?: boolean;
  /** A send has begun, so the server may hold this profile even with no reply yet. */
  started?: boolean;
  /** The server refused this deletion's secret, so the client is told to ask their tailor. */
  secret_refused?: boolean;
  /** Refused with no secret to send: this phone never had one, or could not read it. */
  no_secret?: boolean;
  /** How many refusals so far. At the limit nothing retries until someone asks (D45). */
  refusals?: number;
}

export interface PreflightRecord {
  device_model: string;
  browser: string;
  os: string;
  memory_gb: number | null;
  stream_max: number;
}

export interface ClientDraftSettings {
  language?: 'en' | 'sw';
  client_code?: string;
  height_mm?: number;
  sex?: 'female' | 'male' | 'unspecified';
  clothing_fit?: 'fitted' | 'loose';
  consent?: ConsentRecord;
  model_variant?: 'lite' | 'full';
  code_verified?: boolean;
  preflight?: PreflightRecord;
  level_unchecked?: boolean;
  print_check_ok?: boolean;
  audio_muted?: boolean;
  capture_mode?: 'self' | 'assisted';
}

const MAX_BINARY_BYTES = 65536;
const MAX_TEXT_LENGTH = 65536;
const MAX_LIST_LENGTH = 10000;

/** Privacy guard: throws if anything image-like is about to be stored (frontend-spec 12.1). */
export function assertNoImages(value: unknown, path = 'root'): void {
  walk(value, path, { binary: 0, seen: new Set() });
}

function walk(value: unknown, path: string, state: { binary: number; seen: Set<object> }): void {
  if (typeof value === 'string') {
    if (/^\s*data:/i.test(value)) throw new Error(`Privacy violation: data URL at ${path}`);
    if (value.length > MAX_TEXT_LENGTH) throw new Error(`Privacy violation: long text at ${path}`);
    return;
  }
  if (!value || typeof value !== 'object' || state.seen.has(value)) return;
  state.seen.add(value);
  for (const [name, type] of [
    ['Blob', typeof Blob !== 'undefined' ? Blob : null],
    ['ImageData', typeof ImageData !== 'undefined' ? ImageData : null],
    ['ImageBitmap', typeof ImageBitmap !== 'undefined' ? ImageBitmap : null],
  ] as const) {
    if (type && value instanceof type) throw new Error(`Privacy violation: ${name} at ${path}`);
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    state.binary += value.byteLength;
    if (state.binary > MAX_BINARY_BYTES) {
      throw new Error(`Privacy violation: ${state.binary} bytes of binary data at ${path}`);
    }
    return;
  }
  if (Array.isArray(value) || value instanceof Set) {
    const items = [...value];
    if (items.length > MAX_LIST_LENGTH) throw new Error(`Privacy violation: long list at ${path}`);
    items.forEach((item, index) => walk(item, `${path}[${index}]`, state));
    return;
  }
  if (value instanceof Map) {
    for (const [key, item] of value) {
      walk(key, `${path}.key`, state);
      walk(item, `${path}.value`, state);
    }
    return;
  }
  for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`, state);
}

class VTDatabase extends Dexie {
  profiles!: Table<LocalProfile, string>;
  pending_sync!: Table<PendingSyncOp, number>;
  settings!: Table<{ key: string; value: unknown }, string>;
  client_secrets!: Table<ClientSecretRow, string>;

  constructor() {
    super('virtual_tailor');
    this.version(1).stores({
      profiles: 'profile_id, client_code, sync_status, captured_at',
      pending_sync: '++op_id, created_at, profile_id',
      settings: 'key',
    });
    this.version(2).stores({ client_secrets: 'client_code' });
    // The guard sits on the tables, so no write can go around it.
    for (const table of this.tables) {
      table.hook('creating', (_key, row) => assertNoImages(row, table.name));
      table.hook('updating', (changes) => {
        assertNoImages(changes, table.name);
      });
    }
  }
}

function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const LEGACY_DRAFT_KEY = 'vt_client_draft';
const DRAFT_ROW = 'draft';
// Ids a shared-phone client left behind when they cleared their details (9.11).
const LEFT_ROW = 'left_behind';
const EMPTY_DRAFT: ClientDraftSettings = { capture_mode: 'self', clothing_fit: 'fitted' };

function announceCleared(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(DETAILS_CLEARED_EVENT));
  }
}

class VTStorage {
  readonly db = new VTDatabase();
  private draft: ClientDraftSettings | null = null;

  private op(profileId: string, operation: PendingSyncOp['operation'], clientCode?: string): PendingSyncOp {
    const now = new Date().toISOString();
    return {
      created_at: now,
      profile_id: profileId,
      operation,
      attempts: 0,
      next_attempt_at: now,
      client_code: clientCode,
    };
  }

  /** Writes first, so "Saved" is only ever shown for something on disk (NFR-08). */
  async saveProfile(profile: LocalProfile): Promise<void> {
    assertNoImages(profile, 'profile');
    await this.db.transaction('rw', this.db.profiles, this.db.pending_sync, this.db.client_secrets, async () => {
      await this.db.profiles.put(profile);
      // Someone is measuring under this code again, so a cleared client's secret is theirs to keep.
      await this.db.client_secrets.update(profile.client_code, { left: false });
      if (profile.sync_status === 'pending') {
        await this.db.pending_sync.add(this.op(profile.profile_id, 'create', profile.client_code));
      }
    });
  }

  /** This phone's secret for a code, made on first use. A transaction, so two tabs agree on one. */
  async secretFor(clientCode: string): Promise<string> {
    return this.db.transaction('rw', this.db.client_secrets, async () => {
      const row = await this.db.client_secrets.get(clientCode);
      if (row) return row.secret;
      const secret = newSecret();
      await this.db.client_secrets.add({ client_code: clientCode, secret });
      return secret;
    });
  }

  async existingSecret(clientCode: string): Promise<string | null> {
    return (await this.db.client_secrets.get(clientCode))?.secret ?? null;
  }

  /** A cleared client's secret goes once nothing of theirs is waiting to send. */
  async pruneLeftSecrets(): Promise<void> {
    await this.db.transaction('rw', this.db.client_secrets, this.db.pending_sync, async () => {
      const waiting = new Set((await this.db.pending_sync.toArray()).map((op) => op.client_code));
      const rows = await this.db.client_secrets.toArray();
      await this.db.client_secrets.bulkDelete(
        rows.filter((row) => row.left && !waiting.has(row.client_code)).map((row) => row.client_code),
      );
    });
  }

  async getProfiles(): Promise<LocalProfile[]> {
    return this.db.profiles.orderBy('captured_at').reverse().toArray();
  }

  async getProfileById(profileId: string): Promise<LocalProfile | null> {
    return (await this.db.profiles.get(profileId)) ?? null;
  }

  private async leftIds(): Promise<string[]> {
    return ((await this.db.settings.get(LEFT_ROW))?.value as string[] | undefined) ?? [];
  }

  private async setLeftIds(ids: string[]): Promise<void> {
    if (ids.length) await this.db.settings.put({ key: LEFT_ROW, value: ids });
    else await this.db.settings.delete(LEFT_ROW);
  }

  /** What this client may see: not what an earlier client left waiting to send. */
  async getVisibleProfiles(): Promise<LocalProfile[]> {
    const left = new Set(await this.leftIds());
    return (await this.getProfiles()).filter(
      (row) => !(left.has(row.profile_id) && row.sync_status === 'pending'),
    );
  }

  /** The newest profile that is this client's own, for a Saved screen opened without one. */
  async latestOwnProfile(): Promise<LocalProfile | null> {
    const left = new Set(await this.leftIds());
    return (await this.getProfiles()).find((row) => !left.has(row.profile_id)) ?? null;
  }

  /** Not yet with the server: waiting to send, or refused and needing a corrected code. */
  async countUnsent(): Promise<number> {
    const rows = await this.getProfiles();
    return rows.filter((row) => row.sync_status === 'pending' || row.sync_status === 'rejected').length;
  }

  /** The highest local version for this code, plus one (12.2). */
  async nextVersion(clientCode: string): Promise<number> {
    const rows = await this.db.profiles.where('client_code').equals(clientCode).toArray();
    return rows.reduce((highest, row) => Math.max(highest, row.version), 0) + 1;
  }

  async updateProfileSyncStatus(profileId: string, syncStatus: SyncStatus): Promise<void> {
    await this.db.profiles.update(profileId, { sync_status: syncStatus });
  }

  /** A rejected code was fixed, so the profile goes back in the queue. */
  async changeProfileCode(profileId: string, clientCode: string): Promise<void> {
    const version = await this.nextVersion(clientCode);
    const left = await this.leftIds();
    await this.db.transaction('rw', this.db.profiles, this.db.pending_sync, this.db.settings, async () => {
      await this.setLeftIds(left.filter((id) => id !== profileId));
      await this.db.profiles.update(profileId, {
        client_code: clientCode,
        version,
        sync_status: 'pending',
        needs_help: false,
      });
      await this.db.pending_sync.where('profile_id').equals(profileId).delete();
      await this.db.pending_sync.add(this.op(profileId, 'create', clientCode));
    });
  }

  async deleteProfile(profileId: string): Promise<void> {
    await this.db.transaction('rw', this.db.profiles, this.db.pending_sync, async () => {
      const row = await this.db.profiles.get(profileId);
      await this.db.profiles.delete(profileId);
      await this.db.pending_sync.add(this.op(profileId, 'delete', row?.client_code));
    });
  }

  /**
   * Delete my data, or withdraw consent (9.12). Local records go now and the server is asked later.
   * A profile the server cannot have seen needs no request: its code was refused, or no send has begun.
   */
  async deleteMyData(clientCode: string, reason: 'delete' | 'withdraw'): Promise<void> {
    await this.db.transaction('rw', this.db.profiles, this.db.pending_sync, this.db.settings, async () => {
      const rows = await this.db.profiles.where('client_code').equals(clientCode).toArray();
      // The server deletes everything of a client's at once, so one request says it all.
      let asked = false;
      for (const row of rows) {
        const creates = await this.db.pending_sync.where('profile_id').equals(row.profile_id).toArray();
        const neverSent = row.sync_status === 'pending' && creates.every((c) => !c.started && c.attempts === 0);
        await this.db.pending_sync.where('profile_id').equals(row.profile_id).delete();
        await this.db.profiles.delete(row.profile_id);
        if (!neverSent && row.sync_status !== 'rejected' && !asked) {
          asked = true;
          await this.db.pending_sync.add(this.op(row.profile_id, reason, clientCode));
        }
      }
    });
    const draft = await this.loadDraft();
    if (draft.client_code && draft.client_code !== clientCode) return;
    const { consent, client_code: _code, code_verified: _verified, height_mm: _height, sex: _sex, ...rest } = draft;
    this.saveDraft(
      reason === 'withdraw' && consent ? { ...rest, consent: { ...consent, withdrawn_at: new Date().toISOString() } } : rest,
    );
    announceCleared();
  }

  async getPendingOps(): Promise<PendingSyncOp[]> {
    return this.db.pending_sync.orderBy('created_at').toArray();
  }

  async updateOp(opId: number, changes: Partial<PendingSyncOp>): Promise<void> {
    await this.db.pending_sync.update(opId, changes);
  }

  /** Someone asked to try again, perhaps after their tailor freed the code. */
  async retryRefused(): Promise<void> {
    const now = new Date().toISOString();
    await this.db.transaction('rw', this.db.pending_sync, this.db.profiles, async () => {
      const ended = (await this.db.pending_sync.toArray()).filter((op) => op.refusals);
      for (const op of ended) {
        await this.db.pending_sync.update(op.op_id!, {
          refusals: 0,
          gave_up: false,
          secret_refused: false,
          no_secret: false,
          next_attempt_at: now,
        });
        if (op.operation === 'create') {
          await this.db.profiles.update(op.profile_id, { secret_refused: false, no_secret: false });
        }
      }
    });
  }

  async removeOp(opId: number): Promise<void> {
    await this.db.pending_sync.delete(opId);
  }

  async clearAllLocalData(): Promise<void> {
    await Promise.all([
      this.db.profiles.clear(),
      this.db.pending_sync.clear(),
      this.db.settings.clear(),
      this.db.client_secrets.clear(),
    ]);
    this.draft = null;
    localStorage.removeItem(LEGACY_DRAFT_KEY);
    // The prototype client keeps its copies here until M9 to M11.
    for (const key of ['users', 'clients', 'profiles', 'orders', 'audit', 'participants', 'readings']) {
      localStorage.removeItem(`vt_api_${key}`);
    }
  }

  /**
   * Shared phone (9.11): details go now. Anything the server has not received stays: pending until it
   * settles, rejected until someone corrects the code or deletes it on My measurements.
   */
  async clearClientDetails(): Promise<{ keptUnsent: number }> {
    const rows = await this.db.profiles.toArray();
    const unsent = rows.filter((row) => row.sync_status === 'pending' || row.sync_status === 'rejected');
    const kept = new Set(unsent.map((row) => row.profile_id));
    const left = await this.leftIds();
    await this.db.profiles.bulkDelete(rows.filter((row) => !kept.has(row.profile_id)).map((row) => row.profile_id));
    await this.db.settings.clear();
    // The next person must not act for this client (D45). Only what still has to send keeps its secret.
    const ops = await this.db.pending_sync.toArray();
    const needed = new Set([...unsent.map((row) => row.client_code), ...ops.map((op) => op.client_code)]);
    const secrets = await this.db.client_secrets.toArray();
    await this.db.client_secrets.bulkDelete(
      secrets.filter((row) => !needed.has(row.client_code)).map((row) => row.client_code),
    );
    await this.db.client_secrets.bulkPut(
      secrets.filter((row) => needed.has(row.client_code)).map((row) => ({ ...row, left: true })),
    );
    this.draft = null;
    localStorage.removeItem(LEGACY_DRAFT_KEY);
    await this.setLeftIds([...new Set([...left.filter((id) => kept.has(id)), ...kept])]);
    announceCleared();
    return { keptUnsent: unsent.length };
  }

  /** A left-behind profile has settled, so it leaves the phone. Nobody else's is touched. */
  async purgeAfterSync(profileId: string): Promise<boolean> {
    const left = await this.leftIds();
    if (!left.includes(profileId)) return false;
    await this.db.profiles.delete(profileId);
    await this.setLeftIds(left.filter((id) => id !== profileId));
    return true;
  }

  /** Memory changes at once. Await the result before leaving a screen whose answer must survive a reload. */
  async saveDraft(draft: ClientDraftSettings): Promise<void> {
    assertNoImages(draft, 'draft');
    this.draft = draft;
    try {
      await this.db.settings.put({ key: DRAFT_ROW, value: draft });
    } catch {
      // The draft stays in memory if the database cannot be written.
    }
  }

  /** The draft in memory. Call loadDraft first after a reload. */
  getDraft(): ClientDraftSettings {
    return this.draft ?? { ...EMPTY_DRAFT };
  }

  async loadDraft(): Promise<ClientDraftSettings> {
    if (this.draft) return this.draft;
    try {
      localStorage.removeItem(LEGACY_DRAFT_KEY);
      const row = await this.db.settings.get(DRAFT_ROW);
      this.draft = (row?.value as ClientDraftSettings | undefined) ?? { ...EMPTY_DRAFT };
    } catch {
      this.draft = { ...EMPTY_DRAFT };
    }
    return this.draft;
  }
}

export const vtStorage = new VTStorage();
