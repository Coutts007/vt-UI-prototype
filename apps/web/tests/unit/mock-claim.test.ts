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

it('deleting an empty unclaimed code is done, and claims nothing', async () => {
  const reply = await remove(EMPTY, null);
  expect(reply.status).toBe(202);
  expect(((await reply.json()) as { status: string }).status).toBe('done');
  expect((await upload(body(), OTHER)).status).toBe(201);
});

it('deleting a code with data and no claim is refused', async () => {
  expect(await codeOf(await remove(HAS_DATA))).toBe('client_secret_refused');
});
