import { MeasurementProfile, ConsentRecord } from '../types/api';

const DB_NAME = 'virtual_tailor_db';
const DB_VERSION = 1;

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

/**
 * Privacy guard: strictly checks that NO image data, Blob, ImageData, ImageBitmap,
 * ArrayBuffer > 64KB, or data:image URL is ever stored.
 */
export function assertNoImages(obj: unknown, path = 'root'): void {
  if (!obj || typeof obj !== 'object') return;

  if (typeof Blob !== 'undefined' && obj instanceof Blob) {
    throw new Error(`Privacy Violation: Blob found at ${path}. Images must never be stored.`);
  }
  if (typeof ImageData !== 'undefined' && obj instanceof ImageData) {
    throw new Error(`Privacy Violation: ImageData found at ${path}. Images must never be stored.`);
  }
  if (typeof ImageBitmap !== 'undefined' && obj instanceof ImageBitmap) {
    throw new Error(`Privacy Violation: ImageBitmap found at ${path}. Images must never be stored.`);
  }
  if (obj instanceof ArrayBuffer && obj.byteLength > 65536) {
    throw new Error(`Privacy Violation: Large ArrayBuffer (${obj.byteLength} bytes) found at ${path}.`);
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => assertNoImages(item, `${path}[${index}]`));
    return;
  }

  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof val === 'string' && val.startsWith('data:image')) {
      throw new Error(`Privacy Violation: data:image string detected at ${path}.${key}.`);
    }
    assertNoImages(val, `${path}.${key}`);
  }
}

class VTStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private initDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB not supported'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('profiles')) {
          const profileStore = db.createObjectStore('profiles', { keyPath: 'profile_id' });
          profileStore.createIndex('client_code', 'client_code', { unique: false });
          profileStore.createIndex('sync_status', 'sync_status', { unique: false });
          profileStore.createIndex('captured_at', 'captured_at', { unique: false });
        }
        if (!db.objectStoreNames.contains('pending_sync')) {
          db.createObjectStore('pending_sync', { keyPath: 'op_id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  async saveProfile(profile: MeasurementProfile): Promise<void> {
    assertNoImages(profile, 'profile');
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['profiles', 'pending_sync'], 'readwrite');
        const profilesStore = tx.objectStore('profiles');
        profilesStore.put(profile);

        if (profile.sync_status === 'pending') {
          const pendingStore = tx.objectStore('pending_sync');
          pendingStore.add({
            created_at: new Date().toISOString(),
            profile_id: profile.profile_id,
            operation: 'create',
            attempts: 0,
            next_attempt_at: new Date().toISOString(),
          });
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Fallback to localStorage if IndexedDB is blocked
      const existing = this.getProfilesFromLocalStorage();
      const idx = existing.findIndex((p) => p.profile_id === profile.profile_id);
      if (idx >= 0) existing[idx] = profile;
      else existing.unshift(profile);
      localStorage.setItem('vt_profiles', JSON.stringify(existing));
    }
  }

  async getProfiles(): Promise<MeasurementProfile[]> {
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('profiles', 'readonly');
        const store = tx.objectStore('profiles');
        const req = store.getAll();
        req.onsuccess = () => {
          const res = (req.result || []) as MeasurementProfile[];
          res.sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
          resolve(res);
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return this.getProfilesFromLocalStorage();
    }
  }

  async getProfileById(profileId: string): Promise<MeasurementProfile | null> {
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('profiles', 'readonly');
        const store = tx.objectStore('profiles');
        const req = store.get(profileId);
        req.onsuccess = () => resolve((req.result as MeasurementProfile) || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      const all = this.getProfilesFromLocalStorage();
      return all.find((p) => p.profile_id === profileId) || null;
    }
  }

  async updateProfileSyncStatus(
    profileId: string,
    syncStatus: 'pending' | 'synced' | 'conflict' | 'rejected'
  ): Promise<void> {
    try {
      const db = await this.initDB();
      const tx = db.transaction('profiles', 'readwrite');
      const store = tx.objectStore('profiles');
      const req = store.get(profileId);
      req.onsuccess = () => {
        const profile = req.result as MeasurementProfile;
        if (profile) {
          profile.sync_status = syncStatus;
          store.put(profile);
        }
      };
    } catch {
      const all = this.getProfilesFromLocalStorage();
      const p = all.find((item) => item.profile_id === profileId);
      if (p) {
        p.sync_status = syncStatus;
        localStorage.setItem('vt_profiles', JSON.stringify(all));
      }
    }
  }

  async deleteProfile(profileId: string): Promise<void> {
    try {
      const db = await this.initDB();
      const tx = db.transaction(['profiles', 'pending_sync'], 'readwrite');
      tx.objectStore('profiles').delete(profileId);
      tx.objectStore('pending_sync').add({
        created_at: new Date().toISOString(),
        profile_id: profileId,
        operation: 'delete',
        attempts: 0,
        next_attempt_at: new Date().toISOString(),
      });
    } catch {
      const all = this.getProfilesFromLocalStorage().filter((p) => p.profile_id !== profileId);
      localStorage.setItem('vt_profiles', JSON.stringify(all));
    }
  }

  async clearAllLocalData(): Promise<void> {
    try {
      const db = await this.initDB();
      const tx = db.transaction(['profiles', 'pending_sync', 'settings'], 'readwrite');
      tx.objectStore('profiles').clear();
      tx.objectStore('pending_sync').clear();
      tx.objectStore('settings').clear();
    } catch {
      localStorage.removeItem('vt_profiles');
      localStorage.removeItem('vt_client_draft');
    }
  }

  saveDraft(draft: ClientDraftSettings): void {
    assertNoImages(draft, 'draft');
    try {
      localStorage.setItem('vt_client_draft', JSON.stringify(draft));
    } catch {
      // ignore
    }
  }

  getDraft(): ClientDraftSettings {
    try {
      const raw = localStorage.getItem('vt_client_draft');
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return {
      capture_mode: 'self',
      clothing_fit: 'fitted',
      sex: 'female',
      height_mm: 1700,
      client_code: '',
    };
  }

  private getProfilesFromLocalStorage(): MeasurementProfile[] {
    try {
      const raw = localStorage.getItem('vt_profiles');
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return [];
  }
}

export const vtStorage = new VTStorage();
