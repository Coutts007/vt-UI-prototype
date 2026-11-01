// Sync queue semantics (frontend-spec 12.2) and the delete-my-data queue (9.12).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '../../src/api/http';
import { BACKOFF_MS, GIVE_UP_MS, backoffMs, readNotice, runSync } from '../../src/db/sync';
import { LocalProfile, vtStorage } from '../../src/db/storage';

vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});

const profile = (id: string, extra: Partial<LocalProfile> = {}) =>
  ({
    profile_id: id,
    client_code: 'AB1234',
    version: 1,
    captured_at: '2026-10-01T10:00:00Z',
    status: 'final',
    sync_status: 'pending',
    measurements: [],
    ...extra,
  }) as unknown as LocalProfile;

const NOW = Date.parse('2026-10-31T12:00:00Z');
let clock = NOW + 1000 * 86400 * 365;
// Each pass runs a day later unless a test chooses the time, so backoff has always passed.
function run(reply: () => unknown, at?: number) {
  const now = at ?? (clock += 86_400_000);
  const post = vi.fn(async () => reply());
  const done = runSync({
    api: { post } as never,
    now: () => now,
    online: () => true,
    includeGaveUp: at === undefined,
  });
  return { post, done };
}
const fail = (error: Error) => () => {
  throw error;
};
const status = async (id: string) => (await vtStorage.getProfileById(id))?.sync_status;

beforeEach(() => vtStorage.clearAllLocalData());

describe('profile replies', () => {
  it('201 becomes synced and leaves the queue', async () => {
    await vtStorage.saveProfile(profile('a'));
    const { post, done } = run(() => ({}));
    await done;
    expect(await status('a')).toBe('synced');
    expect(await vtStorage.getPendingOps()).toEqual([]);
    const [path, options] = post.mock.calls[0] as unknown as [string, Record<string, any>];
    expect(path).toBe('/profiles');
    expect(options.headers['Idempotency-Key']).toBe('a');
    expect(options.body).not.toHaveProperty('sync_status');
  });

  it('an old app is not a conflict: the profile stays queued', async () => {
    await vtStorage.saveProfile(profile('a'));
    await run(fail(new ApiError(409, 'stale_app_version', {}))).done;
    expect((await vtStorage.getProfileById('a'))?.sync_status).toBe('pending');
    expect(await vtStorage.db.pending_sync.count()).toBe(1);
  });

  it('409 becomes conflict and keeps the local copy', async () => {
    await vtStorage.saveProfile(profile('a'));
    await run(fail(new ApiError(409, 'profile_version_conflict', {}))).done;
    expect(await status('a')).toBe('conflict');
    expect(await vtStorage.getProfileById('a')).not.toBeNull();
    expect(await vtStorage.getPendingOps()).toEqual([]);
  });

  it('404 becomes rejected', async () => {
    await vtStorage.saveProfile(profile('a'));
    await run(fail(new ApiError(404, 'code_not_found', {}))).done;
    expect(await status('a')).toBe('rejected');
    expect(await vtStorage.getPendingOps()).toEqual([]);
  });

  it('a corrected code goes back in the queue', async () => {
    await vtStorage.saveProfile(profile('a', { sync_status: 'rejected' }));
    await vtStorage.changeProfileCode('a', 'CD2001');
    expect(await status('a')).toBe('pending');
    const { post, done } = run(() => ({}));
    await done;
    expect((post.mock.calls[0] as unknown as [string, any])[1].body.client_code).toBe('CD2001');
  });

  it('422 stays pending and asks for help after 3 attempts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await vtStorage.saveProfile(profile('a'));
    const refused = new ApiError(422, 'validation_failed', {});
    for (let attempt = 1; attempt <= 2; attempt++) {
      await run(fail(refused)).done;
      expect((await readNotice()).needsHelp).toBe(false);
    }
    await run(fail(refused)).done;
    expect(await status('a')).toBe('pending');
    expect((await readNotice()).needsHelp).toBe(true);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('AB1234');
    warn.mockRestore();
  });

  it('a network failure keeps it pending and backs off', async () => {
    await vtStorage.saveProfile(profile('a'));
    const later = Date.now() + 1000;
    await run(fail(new NetworkError('down')), later).done;
    const [op] = await vtStorage.getPendingOps();
    expect(await status('a')).toBe('pending');
    expect(op.attempts).toBe(1);
    expect(Date.parse(op.next_attempt_at)).toBe(later + 30_000);
    const blocked = run(() => ({}), later + 29_000);
    await blocked.done;
    expect(blocked.post).not.toHaveBeenCalled();
    const allowed = run(() => ({}), later + 30_000);
    await allowed.done;
    expect(await status('a')).toBe('synced');
  });

  it('a 5xx backs off too', async () => {
    await vtStorage.saveProfile(profile('a'));
    await run(fail(new ApiError(503, 'unknown', {}))).done;
    expect((await vtStorage.getPendingOps())[0].attempts).toBe(1);
  });

  it('a network failure stops the pass, so the queue does not hammer a dead link', async () => {
    await vtStorage.saveProfile(profile('a'));
    await vtStorage.saveProfile(profile('b'));
    const { post, done } = run(fail(new NetworkError('down')));
    await done;
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does nothing offline', async () => {
    await vtStorage.saveProfile(profile('a'));
    const post = vi.fn();
    await runSync({ api: { post } as never, online: () => false });
    expect(post).not.toHaveBeenCalled();
  });

  it('after 24 hours it stops trying until the app next opens, and is never lost', async () => {
    await vtStorage.saveProfile(profile('a'));
    const late = Date.now() + GIVE_UP_MS + 1000;
    await run(fail(new NetworkError('down')), late).done;
    expect((await readNotice()).overdue).toBe(true);
    const timer = run(() => ({}), late + GIVE_UP_MS);
    await timer.done;
    expect(timer.post).not.toHaveBeenCalled();
    expect(await status('a')).toBe('pending');
    const post = vi.fn(async () => ({}));
    await runSync({
      api: { post } as never,
      now: () => late + GIVE_UP_MS,
      online: () => true,
      includeGaveUp: true,
    });
    expect(await status('a')).toBe('synced');
  });
});

describe('backoff', () => {
  it('follows 30 s, 1, 2, 5, 15 minutes, then an hour', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffMs)).toEqual([...BACKOFF_MS, 3_600_000, 3_600_000]);
    expect(BACKOFF_MS.slice(0, 3)).toEqual([30_000, 60_000, 120_000]);
  });
});

describe('versions', () => {
  it('uses the highest local version for the code, plus one', async () => {
    expect(await vtStorage.nextVersion('AB1234')).toBe(1);
    await vtStorage.saveProfile(profile('a', { version: 4 }));
    await vtStorage.saveProfile(profile('b', { version: 2, client_code: 'CD2001' }));
    expect(await vtStorage.nextVersion('AB1234')).toBe(5);
  });
});

describe('delete my data', () => {
  it('removes local records at once and queues a request for what the server holds', async () => {
    await vtStorage.saveProfile(profile('a', { sync_status: 'synced' }));
    await vtStorage.saveProfile(profile('b', { client_code: 'CD2001', sync_status: 'synced' }));
    await vtStorage.deleteMyData('AB1234', 'delete');
    expect(await vtStorage.getProfileById('a')).toBeNull();
    expect(await vtStorage.getProfileById('b')).not.toBeNull();
    const ops = await vtStorage.getPendingOps();
    expect(ops.map((op) => [op.profile_id, op.operation, op.client_code])).toEqual([
      ['a', 'delete', 'AB1234'],
    ]);
    const { post, done } = run(() => ({ status: 'received' }));
    await done;
    expect(post).toHaveBeenCalledWith('/deletion-requests', {
      body: { client_code: 'AB1234', profile_ids: ['a'], reason: 'delete' },
    });
    expect(await vtStorage.getPendingOps()).toEqual([]);
  });

  it('a profile that was never sent needs no request', async () => {
    await vtStorage.saveProfile(profile('a'));
    await vtStorage.deleteMyData('AB1234', 'delete');
    expect(await vtStorage.getPendingOps()).toEqual([]);
  });

  it('a send that may have reached the server still gets a request', async () => {
    await vtStorage.saveProfile(profile('a'));
    await run(fail(new NetworkError('down'))).done;
    await vtStorage.deleteMyData('AB1234', 'delete');
    const [op] = await vtStorage.getPendingOps();
    expect(op.operation).toBe('delete');
  });

  it('withdrawal records the time and asks with the withdrawal reason', async () => {
    vtStorage.saveDraft({
      consent: {
        consent_version: '1.0',
        language: 'en',
        scope: ['measure'],
        given_at: '2026-10-01T10:00:00Z',
      },
    });
    await vtStorage.saveProfile(profile('a', { sync_status: 'conflict' }));
    await vtStorage.deleteMyData('AB1234', 'withdraw');
    expect(vtStorage.getDraft().consent?.withdrawn_at).toBeTruthy();
    const { post, done } = run(() => ({}));
    await done;
    expect((post.mock.calls[0] as unknown as [string, any])[1].body.reason).toBe(
      'withdraw_consent',
    );
  });

  it('a 404 means nothing is left to delete; a network failure keeps it queued', async () => {
    await vtStorage.saveProfile(profile('a', { sync_status: 'synced' }));
    await vtStorage.deleteMyData('AB1234', 'delete');
    await run(fail(new NetworkError('down'))).done;
    expect((await vtStorage.getPendingOps())[0].attempts).toBe(1);
    await run(fail(new ApiError(404, 'not_found', {}))).done;
    expect(await vtStorage.getPendingOps()).toEqual([]);
  });
});

describe('shared phone', () => {
  it('clears details and sent profiles, and keeps what is unsent until it has gone', async () => {
    vtStorage.saveDraft({ client_code: 'AB1234', height_mm: 1700 });
    await vtStorage.saveProfile(profile('sent', { sync_status: 'synced' }));
    await vtStorage.saveProfile(profile('unsent'));
    expect(await vtStorage.clearClientDetails()).toEqual({ keptUnsent: 1 });
    expect(vtStorage.getDraft().client_code).toBeUndefined();
    expect(await vtStorage.getProfileById('sent')).toBeNull();
    expect(await vtStorage.getProfileById('unsent')).not.toBeNull();
    await run(() => ({})).done;
    expect(await vtStorage.getProfileById('unsent')).toBeNull();
  });
});

describe('draft', () => {
  it('survives a reload through the database', async () => {
    vtStorage.saveDraft({ client_code: 'AB1234', height_mm: 1650 });
    await vi.waitFor(async () => {
      expect(await vtStorage.db.settings.get('draft')).toBeDefined();
    });
    (vtStorage as unknown as { draft: null }).draft = null;
    expect((await vtStorage.loadDraft()).height_mm).toBe(1650);
  });
});

describe('review findings: shared phone and deletion', () => {
  const draft = { capture_mode: 'self', clothing_fit: 'fitted' } as const;

  it('delete my data removes the code, height and sex from the draft', async () => {
    await vtStorage.loadDraft();
    vtStorage.saveDraft({ ...draft, client_code: 'AB1234', height_mm: 1700, sex: 'female' });
    await vtStorage.saveProfile(profile('a'));
    await vtStorage.deleteMyData('AB1234', 'delete');
    const after = vtStorage.getDraft();
    expect(after.client_code).toBeUndefined();
    expect(after.height_mm).toBeUndefined();
    expect(after.sex).toBeUndefined();
  });

  it('withdrawing keeps only the withdrawn consent record', async () => {
    await vtStorage.loadDraft();
    vtStorage.saveDraft({
      ...draft,
      client_code: 'AB1234',
      height_mm: 1700,
      consent: { consent_version: '1.0' } as never,
    });
    await vtStorage.deleteMyData('AB1234', 'withdraw');
    const after = vtStorage.getDraft();
    expect(after.client_code).toBeUndefined();
    expect(after.consent?.withdrawn_at).toBeTruthy();
  });

  it('clearing keeps a rejected profile, and counts it as unsent', async () => {
    await vtStorage.saveProfile(profile('r', { sync_status: 'rejected' }));
    await vtStorage.saveProfile(profile('p'));
    await vtStorage.saveProfile(profile('s', { sync_status: 'synced' }));
    expect(await vtStorage.countUnsent()).toBe(2);
    await vtStorage.clearClientDetails();
    expect(await status('r')).toBe('rejected');
    expect(await status('s')).toBeUndefined();
  });

  it('a later client is not purged when the earlier one has been', async () => {
    await vtStorage.saveProfile(profile('a'));
    await vtStorage.clearClientDetails();
    await vtStorage.saveProfile(profile('b', { client_code: 'CD5678' }));
    await run(() => ({})).done;
    expect(await status('a')).toBeUndefined();
    expect(await status('b')).toBe('synced');
  });

  it.each([
    [409, 'conflict'],
    [404, 'rejected'],
  ])('a left-behind profile ending %i is purged too', async (code) => {
    await vtStorage.saveProfile(profile('a'));
    await vtStorage.clearClientDetails();
    await run(fail(new ApiError(code, 'x', {}))).done;
    expect(await status('a')).toBeUndefined();
    await vtStorage.saveProfile(profile('b'));
    await run(() => ({})).done;
    expect(await status('b')).toBe('synced');
  });

  it('a left-behind unsent profile is hidden from the next client', async () => {
    await vtStorage.saveProfile(profile('a'));
    await vtStorage.clearClientDetails();
    expect((await vtStorage.getVisibleProfiles()).map((p) => p.profile_id)).toEqual([]);
    await vtStorage.saveProfile(profile('b'));
    expect((await vtStorage.getVisibleProfiles()).map((p) => p.profile_id)).toEqual(['b']);
  });

  it('deleting while the first send is in flight still asks the server to delete', async () => {
    await vtStorage.saveProfile(profile('a'));
    const post = vi.fn(async (path: unknown) => {
      if (path === '/profiles') await vtStorage.deleteMyData('AB1234', 'delete');
      return {};
    });
    await runSync({ api: { post } as never, now: () => (clock += 86_400_000), online: () => true });
    const ops = await vtStorage.getPendingOps();
    expect(ops.map((op) => op.operation)).toEqual(['delete']);
  });

  it('a corrected code gets the next version under that code', async () => {
    await vtStorage.saveProfile(profile('old', { client_code: 'CD5678', sync_status: 'synced' }));
    await vtStorage.saveProfile(profile('a', { sync_status: 'rejected' }));
    await vtStorage.changeProfileCode('a', 'CD5678');
    expect((await vtStorage.getProfileById('a'))?.version).toBe(2);
  });

  it('success clears the needs-help mark', async () => {
    await vtStorage.saveProfile(profile('a', { needs_help: true }));
    await run(() => ({})).done;
    expect((await vtStorage.getProfileById('a'))?.needs_help).toBe(false);
  });

  it('coming back online ignores the backoff wait', async () => {
    await vtStorage.saveProfile(profile('a'));
    const op = (await vtStorage.getPendingOps())[0];
    await vtStorage.updateOp(op.op_id!, {
      next_attempt_at: new Date(NOW + 3_600_000).toISOString(),
    });
    const post = vi.fn(async () => ({}));
    await runSync({ api: { post } as never, now: () => NOW, online: () => true });
    expect(post).not.toHaveBeenCalled();
    await runSync({
      api: { post } as never,
      now: () => NOW,
      online: () => true,
      ignoreBackoff: true,
    });
    expect(post).toHaveBeenCalledOnce();
  });
});
