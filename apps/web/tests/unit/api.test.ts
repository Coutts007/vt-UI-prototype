import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  buildUrl,
  HttpApiClient,
  NetworkError,
  SessionAuthTransport,
} from '../../src/api/http';

const memory = new Map<string, string>();
const session = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => memory.set(k, v),
  removeItem: (k: string) => memory.delete(k),
};
vi.stubGlobal('sessionStorage', session);

const later = () => new Date(Date.now() + 60_000).toISOString();

describe('buildUrl', () => {
  it('fills the path, encodes it and drops empty query values', () => {
    expect(
      buildUrl('/api/v1', '/clients/{client_id}', { client_id: 'a/b' }, { search: '', page: 2 }),
    ).toBe('/api/v1/clients/a%2Fb?page=2');
  });
});

describe('SessionAuthTransport', () => {
  beforeEach(() => memory.clear());
  it('forgets an expired token', () => {
    memory.set('vt_session', JSON.stringify({ token: 't', expiresAt: '2020-01-01T00:00:00Z' }));
    expect(new SessionAuthTransport().getToken()).toBeNull();
    expect(memory.size).toBe(0);
  });
  it('keeps a live token', () => {
    const auth = new SessionAuthTransport();
    auth.setToken('t', later());
    expect(new SessionAuthTransport().getToken()).toBe('t');
  });
});

describe('HttpApiClient', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    memory.clear();
    vi.stubGlobal('sessionStorage', session);
  });

  it('reports a problem response with its stable code', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify({ code: 'code_not_found' }), { status: 404 }),
    );
    const client = new HttpApiClient('', new SessionAuthTransport());
    await expect(
      client.get('/client-codes/{code}', { path: { code: 'AB1234' } }),
    ).rejects.toMatchObject({
      status: 404,
      code: 'code_not_found',
    });
  });

  it('ends the session on 401 when a token was sent', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }));
    const auth = new SessionAuthTransport();
    auth.setToken('t', later());
    const ended = vi.fn();
    const client = new HttpApiClient('', auth, ended);
    await expect(client.get('/me')).rejects.toBeInstanceOf(ApiError);
    expect(ended).toHaveBeenCalledOnce();
    expect(auth.getToken()).toBeNull();
  });

  it('sets a network error apart', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    const client = new HttpApiClient('', new SessionAuthTransport());
    await expect(client.get('/health')).rejects.toBeInstanceOf(NetworkError);
  });

  it('keeps the session when the current password is wrong', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }));
    const auth = new SessionAuthTransport();
    auth.setToken('t', later());
    const ended = vi.fn();
    const client = new HttpApiClient('', auth, ended);
    await expect(client.post('/me/password', { body: {} } as never)).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(ended).not.toHaveBeenCalled();
    expect(auth.getToken()).toBe('t');
  });

  it('a late 401 from an old token leaves a newer session alone', async () => {
    const auth = new SessionAuthTransport();
    auth.setToken('old', later());
    vi.stubGlobal('fetch', async () => {
      auth.setToken('new', later());
      return new Response('{}', { status: 401 });
    });
    const client = new HttpApiClient('', auth);
    await expect(client.get('/me')).rejects.toBeInstanceOf(ApiError);
    expect(auth.getToken()).toBe('new');
  });

  it('reports a reply that is not JSON', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>', { status: 200 }));
    const client = new HttpApiClient('', new SessionAuthTransport());
    await expect(client.get('/health')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('drops a corrupt or expired session', () => {
    memory.set('vt_session', '{bad');
    expect(new SessionAuthTransport().getToken()).toBeNull();
    const auth = new SessionAuthTransport();
    auth.setToken('t', later());
    memory.set('vt_session', JSON.stringify({ token: 't', expiresAt: '2020-01-01T00:00:00Z' }));
    expect(auth.getToken()).toBeNull();
  });
});
