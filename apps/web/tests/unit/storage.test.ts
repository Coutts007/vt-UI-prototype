import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertNoImages, vtStorage } from '../../src/db/storage';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => memory.set(k, v),
  removeItem: (k: string) => memory.delete(k),
});

const profile = (id: string, at: string, extra = {}) =>
  ({
    profile_id: id,
    client_code: 'AB1234',
    captured_at: at,
    sync_status: 'pending',
    measurements: [],
    ...extra,
  }) as never;

describe('image guard', () => {
  it.each([
    ['a Blob', new Blob(['x'])],
    ['a nested Blob', { a: [{ b: new Blob(['x']) }] }],
    ['a data URL', { photo: 'data:image/png;base64,AAAA' }],
    ['a data URL in a list', { photos: ['data:image/jpeg;base64,AAAA'] }],
    ['a large buffer', { raw: new ArrayBuffer(65537) }],
    ['a large typed array', { raw: new Uint8Array(65537) }],
    ['a Blob in a Map', new Map([['a', new Blob(['x'])]])],
    ['a Blob in a Set', new Set([new Blob(['x'])])],
    ['an upper-case data URL', { a: 'DATA:IMAGE/PNG;base64,AA' }],
    ['a data URL after a space', { a: ' data:image/png;base64,AA' }],
    ['a data URL of another type', { a: 'data:application/octet-stream;base64,AA' }],
    ['long text', { a: 'A'.repeat(65537) }],
    ['many small buffers', { a: Array.from({ length: 3 }, () => new ArrayBuffer(30000)) }],
    ['a long pixel list', { a: new Array(10001).fill(0) }],
  ])('rejects %s', (_, value) => {
    expect(() => assertNoImages(value)).toThrow(/Privacy violation/);
  });

  it('allows numbers and short text', () => {
    expect(() => assertNoImages({ a: [1, 2], b: 'hello', c: new Uint8Array(16) })).not.toThrow();
  });
});

describe('storage', () => {
  beforeEach(async () => {
    await vtStorage.clearAllLocalData();
  });

  it('refuses to save a profile holding image data', async () => {
    await expect(
      vtStorage.saveProfile(profile('a', '2026-01-01', { photo: 'data:image/png;base64,A' })),
    ).rejects.toThrow();
    expect(await vtStorage.getProfiles()).toEqual([]);
  });

  it('refuses image data written straight to a table', async () => {
    await expect(
      vtStorage.db.profiles.put(profile('a', '2026-01-01', { photo: new Blob(['x']) })),
    ).rejects.toThrow();
    await expect(
      vtStorage.db.settings.put({ key: 'a', value: 'data:image/png;base64,A' }),
    ).rejects.toThrow();
    await vtStorage.saveProfile(profile('b', '2026-01-01'));
    await expect(
      vtStorage.db.profiles.update('b', { photo: 'data:image/png;base64,A' } as never),
    ).rejects.toThrow();
  });

  it('returns profiles newest first and queues a sync', async () => {
    await vtStorage.saveProfile(profile('old', '2026-01-01T00:00:00Z'));
    await vtStorage.saveProfile(profile('new', '2026-02-01T00:00:00Z'));
    expect((await vtStorage.getProfiles()).map((p) => p.profile_id)).toEqual(['new', 'old']);
    expect(await vtStorage.db.pending_sync.count()).toBe(2);
  });

  it('updates sync status', async () => {
    await vtStorage.saveProfile(profile('a', '2026-01-01T00:00:00Z'));
    await vtStorage.updateProfileSyncStatus('a', 'synced');
    expect((await vtStorage.getProfileById('a'))?.sync_status).toBe('synced');
  });

  it('delete removes the data and queues the request', async () => {
    await vtStorage.saveProfile(profile('a', '2026-01-01T00:00:00Z', { sync_status: 'synced' }));
    await vtStorage.deleteProfile('a');
    expect(await vtStorage.getProfileById('a')).toBeNull();
    expect((await vtStorage.db.pending_sync.toArray())[0].operation).toBe('delete');
  });

  it('clearing the phone removes everything, including the draft', async () => {
    vtStorage.saveDraft({ client_code: 'AB1234' });
    localStorage.setItem('vt_api_profiles', '[]');
    await vtStorage.saveProfile(profile('a', '2026-01-01T00:00:00Z'));
    await vtStorage.clearAllLocalData();
    expect(await vtStorage.getProfiles()).toEqual([]);
    expect(memory.has('vt_client_draft')).toBe(false);
    expect(memory.has('vt_api_profiles')).toBe(false);
  });
});
