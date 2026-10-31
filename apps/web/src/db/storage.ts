import Dexie, { Table } from 'dexie';
import { MeasurementProfile, ConsentRecord } from '../types/api';

export interface PendingSyncOp {
  op_id?: number;
  created_at: string;
  profile_id: string;
  operation: 'create' | 'delete' | 'withdraw';
  attempts: number;
  next_attempt_at: string;
}

export interface ClientDraftSettings {
  language?: 'en' | 'sw';
  client_code?: string;
  height_mm?: number;
  sex?: 'female' | 'male' | 'unspecified';
  clothing_fit?: 'fitted' | 'loose';
  consent?: ConsentRecord;
  model_variant?: 'lite' | 'full';
  preflight_ok?: boolean;
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
  profiles!: Table<MeasurementProfile, string>;
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

const DRAFT_KEY = 'vt_client_draft';

class VTStorage {
  readonly db = new VTDatabase();

  private op(profileId: string, operation: PendingSyncOp['operation']): PendingSyncOp {
    const now = new Date().toISOString();
    return { created_at: now, profile_id: profileId, operation, attempts: 0, next_attempt_at: now };
  }

  async saveProfile(profile: MeasurementProfile): Promise<void> {
    assertNoImages(profile, 'profile');
    await this.db.transaction('rw', this.db.profiles, this.db.pending_sync, async () => {
      await this.db.profiles.put(profile);
      if (profile.sync_status === 'pending') {
        await this.db.pending_sync.add(this.op(profile.profile_id, 'create'));
      }
    });
  }

  async getProfiles(): Promise<MeasurementProfile[]> {
    const rows = await this.db.profiles.orderBy('captured_at').reverse().toArray();
    return rows;
  }

  async getProfileById(profileId: string): Promise<MeasurementProfile | null> {
    return (await this.db.profiles.get(profileId)) ?? null;
  }

  async updateProfileSyncStatus(
    profileId: string,
    syncStatus: 'pending' | 'synced' | 'conflict' | 'rejected',
  ): Promise<void> {
    await this.db.profiles.update(profileId, { sync_status: syncStatus });
  }

  async deleteProfile(profileId: string): Promise<void> {
    await this.db.transaction('rw', this.db.profiles, this.db.pending_sync, async () => {
      await this.db.profiles.delete(profileId);
      await this.db.pending_sync.add(this.op(profileId, 'delete'));
    });
  }

  async clearAllLocalData(): Promise<void> {
    await Promise.all([this.db.profiles.clear(), this.db.pending_sync.clear(), this.db.settings.clear()]);
    localStorage.removeItem(DRAFT_KEY);
    // The prototype client keeps its copies here until M9 to M11.
    for (const key of ['users', 'clients', 'profiles', 'orders', 'audit', 'participants', 'readings']) {
      localStorage.removeItem(`vt_api_${key}`);
    }
  }

  saveDraft(draft: ClientDraftSettings): void {
    assertNoImages(draft, 'draft');
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }

  getDraft(): ClientDraftSettings {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) return JSON.parse(raw) as ClientDraftSettings;
    } catch {
      // A damaged draft is treated as no draft.
    }
    return { capture_mode: 'self', clothing_fit: 'fitted', sex: 'female', height_mm: 1700, client_code: '' };
  }
}

export const vtStorage = new VTStorage();
