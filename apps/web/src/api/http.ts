// The one way the app reaches the API. Types come from the contract, so a mismatch fails the build.
import type { paths } from '@vt/contracts';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Op<P extends keyof paths, M extends Method> = paths[P][M] extends object ? paths[P][M] : never;
type OpsWith<M extends Method> = {
  [P in keyof paths]: paths[P][M] extends object ? P : never;
}[keyof paths];

type Success<O> = O extends { responses: infer R }
  ? R extends { 200: { content: { 'application/json': infer B } } }
    ? B
    : R extends { 201: { content: { 'application/json': infer B } } }
      ? B
      : R extends { 202: { content: { 'application/json': infer B } } }
        ? B
        : undefined
  : never;

type Body<O> = O extends { requestBody: { content: { 'application/json': infer B } } } ? B : never;
type Parameters_<O> = O extends { parameters: infer P } ? P : never;

export interface RequestOptions<O> {
  path?: Parameters_<O> extends { path: infer X } ? X : never;
  query?: Parameters_<O> extends { query?: infer X } ? X : never;
  headers?: Record<string, string>;
  body?: Body<O>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly problem: Record<string, unknown>,
  ) {
    super(code);
  }
}

export class NetworkError extends Error {}

export interface AuthTransport {
  getToken(): string | null;
  setToken(token: string, expiresAt: string): void;
  clear(): void;
}

/** Bearer token in memory and sessionStorage, never localStorage or IndexedDB (D7). */
export class SessionAuthTransport implements AuthTransport {
  private static KEY = 'vt_session';
  private token: string | null = null;

  getToken(): string | null {
    const stored = sessionStorage.getItem(SessionAuthTransport.KEY);
    if (!stored) {
      this.token = null;
      return null;
    }
    let session: { token: string; expiresAt: string };
    try {
      session = JSON.parse(stored);
    } catch {
      this.clear();
      return null;
    }
    const { token, expiresAt } = session;
    if (Date.parse(expiresAt) <= Date.now()) {
      this.clear();
      return null;
    }
    this.token = token;
    return token;
  }

  setToken(token: string, expiresAt: string): void {
    this.token = token;
    sessionStorage.setItem(SessionAuthTransport.KEY, JSON.stringify({ token, expiresAt }));
  }

  clear(): void {
    this.token = null;
    sessionStorage.removeItem(SessionAuthTransport.KEY);
  }
}

export interface ApiClient {
  get<P extends OpsWith<'get'>>(path: P, options?: RequestOptions<Op<P, 'get'>>): Promise<Success<Op<P, 'get'>>>;
  post<P extends OpsWith<'post'>>(path: P, options?: RequestOptions<Op<P, 'post'>>): Promise<Success<Op<P, 'post'>>>;
  put<P extends OpsWith<'put'>>(path: P, options?: RequestOptions<Op<P, 'put'>>): Promise<Success<Op<P, 'put'>>>;
  patch<P extends OpsWith<'patch'>>(path: P, options?: RequestOptions<Op<P, 'patch'>>): Promise<Success<Op<P, 'patch'>>>;
  delete<P extends OpsWith<'delete'>>(path: P, options?: RequestOptions<Op<P, 'delete'>>): Promise<Success<Op<P, 'delete'>>>;
  text(path: string, query?: Record<string, string>): Promise<string>;
  readonly auth: AuthTransport;
}

export function buildUrl(
  base: string,
  template: string,
  path: Record<string, unknown> = {},
  query: Record<string, unknown> = {},
): string {
  const filled = template.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(String(path[key])));
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const suffix = search.toString();
  return `${base}${filled}${suffix ? `?${suffix}` : ''}`;
}

export class HttpApiClient implements ApiClient {
  constructor(
    private readonly base: string,
    readonly auth: AuthTransport,
    private readonly onSessionEnded: () => void = () => {},
  ) {}

  protected ready(): Promise<void> {
    return Promise.resolve();
  }

  private async send(method: string, template: string, options: RequestOptions<any> = {}): Promise<Response> {
    await this.ready();
    const headers: Record<string, string> = { ...options.headers };
    const token = this.auth.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetch(buildUrl(this.base, template, options.path as any, options.query as any), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      throw new NetworkError(String(error));
    }
    if (response.ok) return response;
    const problem = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    // A wrong password is not a dead session, and a late reply must not end a newer one.
    const checksCredentials = template === '/auth/login' || template === '/me/password';
    if (response.status === 401 && token && !checksCredentials && this.auth.getToken() === token) {
      this.auth.clear();
      this.onSessionEnded();
    }
    throw new ApiError(response.status, String(problem.code ?? 'unknown'), problem);
  }

  private async json(method: string, template: string, options?: RequestOptions<any>): Promise<any> {
    const response = await this.send(method, template, options);
    if (response.status === 204) return undefined;
    return response.json().catch(() => {
      throw new ApiError(response.status, 'invalid_response', {});
    });
  }

  get: ApiClient['get'] = (path, options) => this.json('GET', path as string, options as any);
  post: ApiClient['post'] = (path, options) => this.json('POST', path as string, options as any);
  put: ApiClient['put'] = (path, options) => this.json('PUT', path as string, options as any);
  patch: ApiClient['patch'] = (path, options) => this.json('PATCH', path as string, options as any);
  delete: ApiClient['delete'] = (path, options) => this.json('DELETE', path as string, options as any);

  async text(path: string, query?: Record<string, string>): Promise<string> {
    const response = await this.send('GET', path, { query } as any);
    return response.text();
  }
}

/** The same client, talking to MSW, which is never in a production build. */
export class MockApiClient extends HttpApiClient {
  private started: Promise<void> | null = null;

  protected override ready(): Promise<void> {
    this.started ??= import('../../mocks/browser').then((m) => m.startMockWorker());
    return this.started;
  }
}

export function createApiClient(onSessionEnded?: () => void): ApiClient {
  const base = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
  const auth = new SessionAuthTransport();
  return import.meta.env.VITE_API_MODE === 'mock'
    ? new MockApiClient(base, auth, onSessionEnded)
    : new HttpApiClient(base, auth, onSessionEnded);
}
