// The mock follows the server's claim, deletion and refusal rules (D45, D46).
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import seed from '../../../../packages/seed/seed.json';
import { createHandlers } from '../../mocks/handlers';

const BASE = 'http://localhost/api/v1';
const SECRET = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);
const EMPTY = 'AB1008';
const HAS_DATA = 'AB1004';
const clientOf = (code: string) => seed.clients.find((c) => c.client_code === code)!;
const template = seed.profiles.find((p) => p.client_id === clientOf(HAS_DATA).client_id)!;
let id = 0;
const body = (code = EMPTY, version = 1): Record<string, any> => {
  const { client_id: _c, received_at: _r, server_checks: _s, ...rest } = template as any;
  id += 1;
  const copy = JSON.parse(JSON.stringify(rest));
  return {
    ...copy,
    client_code: code,
    version,
    profile_id: `00000000-0000-5000-8000-${String(id).padStart(12, '0')}`,
    session: {
      ...copy.session,
      session_id: `00000000-0000-5000-8001-${String(id).padStart(12, '0')}`,
    },
  };
};
const upload = (profile: Record<string, any>, secret: string | null = SECRET) =>
  fetch(`${BASE}/profiles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': profile.profile_id,
      ...(secret ? { 'X-Client-Secret': secret } : {}),
    },
    body: JSON.stringify(profile),
  });
const remove = (code = EMPTY, secret: string | null = SECRET) =>
  fetch(`${BASE}/deletion-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-Client-Secret': secret } : {}),
    },
    body: JSON.stringify({ client_code: code, reason: 'delete' }),
  });
const codeOf = async (reply: Response) => ((await reply.json()) as { code: string }).code;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => server.resetHandlers(...createHandlers()));
afterAll(() => server.close());

it('a malformed secret cannot claim', async () => {
  for (const secret of ['short', 'AB'.repeat(32), null]) {
    expect(await codeOf(await upload(body(), secret))).toBe('client_secret_refused');
  }
});

it('a code that holds data cannot be claimed by an upload', async () => {
  expect(await codeOf(await upload(body(HAS_DATA, 99)))).toBe('client_secret_refused');
});

it('refuses an override and a value finer than a tenth', async () => {
  const override = body();
  override.measurements[0].method = 'override';
  expect((await upload(override)).status).toBe(422);
  const fine = body();
  const row = fine.silhouette_side.half_depth_mm;
  row[row.findIndex((v: number | null) => v !== null)] += 3.3e-8;
  expect((await upload(fine)).status).toBe(422);
});

it('a deleted profile answers 410 to its owner', async () => {
  const mine = body();
  expect((await upload(mine)).status).toBe(201);
  expect((await remove()).status).toBe(202);
  expect((await upload(mine)).status).toBe(410);
});

// The tailor's side of a claim (D45, M9), with the same rules as the server's.
const signIn = async () => {
  const reply = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'wanjiru@vt.test', password: 'vt-demo-2026' }),
  });
  return {
    Authorization: `Bearer ${((await reply.json()) as any).access_token}`,
    'Content-Type': 'application/json',
  };
};
const claimOf = async (code: string, headers: Record<string, string>) =>
  (
    await fetch(`${BASE}/clients/${clientOf(code).client_id}/claim`, { headers })
  ).json() as Promise<any>;
const free = (code: string, headers: Record<string, string>) =>
  fetch(`${BASE}/clients/${clientOf(code).client_id}/claim/free`, { method: 'POST', headers });
const fresh = body;

it('deleting an empty unclaimed code is done, and claims nothing', async () => {
  const headers = await signIn();
  const issued = await fetch(`${BASE}/clients`, { method: 'POST', headers, body: '{}' });
  const code = ((await issued.json()) as any).client_code;
  const reply = await remove(code, null);
  expect(reply.status).toBe(202);
  expect(((await reply.json()) as { status: string }).status).toBe('done');
  expect((await upload(body(code), OTHER)).status).toBe(201);
});

it('after a tailor frees a code the next phone reaches only its own rows', async () => {
  const headers = await signIn();
  expect((await upload(fresh())).status).toBe(201);
  expect((await claimOf(EMPTY, headers)).claimed).toBe(true);
  await free(EMPTY, headers);
  expect((await claimOf(EMPTY, headers)).claimed).toBe(false);
  expect((await upload(fresh(EMPTY, 2), OTHER)).status).toBe(201);
  const view = await claimOf(EMPTY, headers);
  expect(view.claimed).toBe(true);
  expect(view.profiles.map((p: any) => p.claim_round)).toEqual([0, 1]);
  const access = await fetch(`${BASE}/data-requests/access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Secret': OTHER },
    body: JSON.stringify({ client_code: EMPTY }),
  });
  expect(((await access.json()) as any).profiles).toHaveLength(1);
});

it('a deletion on an unclaimed code that holds data goes to the tailor and changes nothing', async () => {
  const headers = await signIn();
  const reply = await remove(HAS_DATA, null);
  expect(reply.status).toBe(202);
  expect(((await reply.json()) as any).status).toBe('received');
  const before = await claimOf(HAS_DATA, headers);
  expect(before.profiles.length).toBeGreaterThan(0);
  expect(before.deletion_requests[0].status).toBe('received');
  const closed = await fetch(`${BASE}/clients/${clientOf(HAS_DATA).client_id}/claim/review`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ close_request_ids: [before.deletion_requests[0].request_id] }),
  });
  expect(((await closed.json()) as any).deletion_requests[0].status).toBe('rejected');
});

it('review is refused while a phone holds the code', async () => {
  const headers = await signIn();
  await upload(fresh());
  const reply = await fetch(`${BASE}/clients/${clientOf(EMPTY).client_id}/claim/review`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ close_request_ids: [] }),
  });
  expect(reply.status).toBe(422);
});

it('a withdrawal blocks the next upload until the tailor clears it', async () => {
  const headers = await signIn();
  await upload(fresh());
  const gone = await fetch(`${BASE}/deletion-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Secret': SECRET },
    body: JSON.stringify({ client_code: EMPTY, reason: 'withdraw_consent' }),
  });
  expect(gone.status).toBe(202);
  await free(EMPTY, headers);
  expect(await codeOf(await upload(fresh(EMPTY, 2), OTHER))).toBe('consent_missing');
  const view = await claimOf(EMPTY, headers);
  await fetch(`${BASE}/clients/${clientOf(EMPTY).client_id}/claim/review`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ clear_consent_ids: view.withdrawals.map((w: any) => w.consent_id) }),
  });
  expect((await upload(fresh(EMPTY, 2), OTHER)).status).toBe(201);
});

it('a reused session id, and the eleventh upload in an hour, are refused', async () => {
  const first = fresh();
  await upload(first);
  const again = fresh(EMPTY, 2);
  again.session = first.session;
  expect((await upload(again)).status).toBe(422);
  for (let n = 2; n <= 10; n += 1) expect((await upload(fresh(EMPTY, n))).status).toBe(201);
  expect(await codeOf(await upload(fresh(EMPTY, 11)))).toBe('rate_limited');
});
