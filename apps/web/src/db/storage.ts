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

  constructor() {
    super('virtual_tailor');
    this.version(1).stores({
      profiles: 'profile_id, client_code, sync_status, captured_at',
      pending_sync: '++op_id, created_at, profile_id',
      settings: 'key',
    });
    // The guard sits on the tables, so no write can go around it.
    for (const table of this.tables) {
      table.hook('creating', (_key, row) => assertNoImages(row, table.name));
      table.hook('updating', (changes) => {
        assertNoImages(changes, table.name);
      });
    }
  }
}

const LEGACY_DRAFT_KEY = 'vt_client_draft';
const DRAFT_ROW = 'draft';
const PURGE_ROW = 'purge_after_sync';
const EMPTY_DRAFT: ClientDraftSettings = { capture_mode: 'self', clothing_fit: 'fitted' };

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
    await this.db.transaction('rw', this.db.profiles, this.db.pending_sync, async () => {
      await this.db.profiles.put(profile);
      if (profile.sync_status === 'pending') {
        await this.db.pending_sync.add(this.op(profile.profile_id, 'create', profile.client_code));
      }
    });
  }

  async getProfiles(): Promise<LocalProfile[]> {
    return this.db.profiles.orderBy('captured_at').reverse().toArray();
  }

  async getProfileById(profileId: string): Promise<LocalProfile | null> {
    return (await this.db.profiles.get(profileId)) ?? null;
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
    await this.db.transaction('rw', this.db.profiles, this.db.pending_sync, async () => {
      await this.db.profiles.update(profileId, {
        client_code: clientCode,
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
   * A profile the server cannot have seen needs no request: its code was refused, or it was never sent.
   */
  async deleteMyData(clientCode: string, reason: 'delete' | 'withdraw'): Promise<void> {
    await this.db.transaction('rw', this.db.profiles, this.db.pending_sync, this.db.settings, async () => {
      const rows = await this.db.profiles.where('client_code').equals(clientCode).toArray();
      for (const row of rows) {
        const creates = await this.db.pending_sync.where('profile_id').equals(row.profile_id).toArray();
        const neverSent = row.sync_status === 'pending' && creates.every((c) => c.attempts === 0);
        await this.db.pending_sync.where('profile_id').equals(row.profile_id).delete();
        await this.db.profiles.delete(row.profile_id);
        if (!neverSent && row.sync_status !== 'rejected') {
          await this.db.pending_sync.add(this.op(row.profile_id, reason, clientCode));
        }
      }
    });
    const { consent, ...rest } = await this.loadDraft();
    this.saveDraft(
      reason === 'withdraw' && consent ? { ...rest, consent: { ...consent, withdrawn_at: new Date().toISOString() } } : rest,
    );
  }

  async getPendingOps(): Promise<PendingSyncOp[]> {
    return this.db.pending_sync.orderBy('created_at').toArray();
  }

  async updateOp(opId: number, changes: Partial<PendingSyncOp>): Promise<void> {
    await this.db.pending_sync.update(opId, changes);
  }

  async removeOp(opId: number): Promise<void> {
    await this.db.pending_sync.delete(opId);
  }

  async clearAllLocalData(): Promise<void> {
    await Promise.all([this.db.profiles.clear(), this.db.pending_sync.clear(), this.db.settings.clear()]);
    this.draft = null;
    localStorage.removeItem(LEGACY_DRAFT_KEY);
    // The prototype client keeps its copies here until M9 to M11.
    for (const key of ['users', 'clients', 'profiles', 'orders', 'audit', 'participants', 'readings']) {
      localStorage.removeItem(`vt_api_${key}`);
    }
  }

  /** Shared phone (9.11): details go now, and anything unsent stays until it has been sent. */
  async clearClientDetails(): Promise<{ keptUnsent: number }> {
    const rows = await this.db.profiles.toArray();
    const unsent = rows.filter((row) => row.sync_status === 'pending');
    await this.db.profiles.bulkDelete(
      rows.filter((row) => row.sync_status !== 'pending').map((row) => row.profile_id),
    );
    await this.db.settings.clear();
    this.draft = null;
    localStorage.removeItem(LEGACY_DRAFT_KEY);
    if (unsent.length) await this.db.settings.put({ key: PURGE_ROW, value: true });
    return { keptUnsent: unsent.length };
  }

  /** Once the last profile a shared-phone user left behind has gone, it leaves the phone too. */
  async purgeAfterSync(profileId: string): Promise<boolean> {
    const row = await this.db.settings.get(PURGE_ROW);
    if (!row?.value) return false;
    await this.db.profiles.delete(profileId);
    if ((await this.db.profiles.count()) === 0) await this.db.settings.delete(PURGE_ROW);
    return true;
  }

  saveDraft(draft: ClientDraftSettings): void {
    assertNoImages(draft, 'draft');
    this.draft = draft;
    void this.db.settings.put({ key: DRAFT_ROW, value: draft }).catch(() => {
      // The draft stays in memory if the database cannot be written.
    });
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
