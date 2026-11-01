// Calls every endpoint in the contract through the mock and checks each reply against its schema.
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createHandlers } from '../../mocks/handlers';
import { shiftDates } from '../../mocks/store';
import seed from '../../../../packages/seed/seed.json';

const contract = parse(readFileSync('../../packages/contracts/openapi.yaml', 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(contract, 'contract');

const BASE = 'http://localhost/api/v1';
const server = setupServer(...createHandlers());
const tokens: Record<string, string> = {};

const wanjiruClient = seed.clients.find((c) => c.client_code === 'AB1004')!;
const emptyClient = seed.clients.find((c) => c.client_code === 'AB1008')!;
const profileOf = (id: string) => seed.profiles.find((p) => p.client_id === id)!;
const wanjiru = seed.users.find((u) => u.email === 'wanjiru@vt.test')!;
const order = seed.orders.find((o) => o.order_no === 'ORD-0001' && o.client_code.startsWith('AB'))!;
const newOrder = seed.orders.find((o) => o.status === 'new' && o.order_no === 'ORD-0002')!;
const conflict = seed.conflicts[0];
const pending = seed.users.find((u) => u.status === 'pending')!;
const participant = seed.participants[0];
const reading = seed.reference_readings[0];
const later = new Date(Date.now() + 864e6).toISOString().slice(0, 10);
const values = {
  stature: 1700,
  shoulder: 420,
  chest: 900,
  waist: 740,
  hip: 960,
  sleeve: 600,
  outleg: 1040,
  inleg: 800,
  neck: 360,
};
const presets = [{ garment_type: 'shirt', site_code: 'chest', ease_mm: 80 }];
const item = { site_code: 'chest', body_mm: 900, ease_mm: 80, overridden: false };

const MOCK_SECRET = 'ab'.repeat(32);

const {
  client_id: _c,
  received_at: _r,
  server_checks: _s,
  ...payload
} = {
  ...profileOf(wanjiruClient.client_id),
  profile_id: '00000000-0000-5000-8000-000000000001',
  session: {
    ...profileOf(wanjiruClient.client_id).session,
    session_id: '00000000-0000-5000-8000-000000000002',
  },
  client_code: emptyClient.client_code,
  version: 9,
  status: 'final',
} as Record<string, any>;

interface Case {
  role?: 'tailor' | 'admin' | 'measurer';
  path?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
}

const CASES: Record<string, Case> = {
  getHealth: {},
  getReady: {},
  getPublicSettings: {},
  getCurrentRules: {},
  getRules: { path: { version: '0.1-uncalibrated' } },
  verifyClientCode: { path: { code: 'AB1001' } },
  syncProfile: {
    body: payload,
    headers: { 'Idempotency-Key': payload.profile_id, 'X-Client-Secret': MOCK_SECRET },
  },
  requestDeletion: {
    body: {
      client_code: payload.client_code,
      reason: 'delete',
    },
    headers: { 'X-Client-Secret': MOCK_SECRET },
  },
  requestDataAccess: {
    body: { client_code: payload.client_code },
    headers: { 'X-Client-Secret': MOCK_SECRET },
  },
  register: {
    body: {
      email: 'new@vt.test',
      password: 'long-enough-1',
      business_name: 'New',
      phone: '0712345678',
      area: 'CBD',
      locale: 'en',
    },
  },
  login: { body: { email: 'wanjiru@vt.test', password: seed.demo_password } },
  logout: { role: 'measurer' },
  getMe: { role: 'tailor' },
  updateMe: { role: 'tailor', body: { area: 'Gikomba' } },
  changePassword: {
    role: 'admin',
    body: { current_password: seed.demo_password, new_password: seed.demo_password },
  },
  getEasePresets: { role: 'tailor' },
  putEasePresets: { role: 'tailor', body: presets },
  listClients: { role: 'tailor' },
  createClient: { role: 'tailor', body: { display_name: 'Test' } },
  getClient: { role: 'tailor', path: { client_id: wanjiruClient.client_id } },
  updateClient: {
    role: 'tailor',
    path: { client_id: wanjiruClient.client_id },
    body: { display_name: 'A' },
  },
  deleteClient: { role: 'tailor', path: { client_id: emptyClient.client_id } },
  rotateClientCode: { role: 'tailor', path: { client_id: seed.clients[1].client_id } },
  getClientClaim: { role: 'tailor', path: { client_id: wanjiruClient.client_id } },
  freeClientClaim: { role: 'tailor', path: { client_id: wanjiruClient.client_id } },
  reviewClientClaim: {
    role: 'tailor',
    path: { client_id: wanjiruClient.client_id },
    body: { close_request_ids: [] },
  },
  listClientProfiles: { role: 'tailor', path: { client_id: wanjiruClient.client_id } },
  getProfile: {
    role: 'tailor',
    path: { profile_id: profileOf(wanjiruClient.client_id).profile_id },
  },
  listConflicts: { role: 'tailor' },
  resolveConflict: {
    role: 'tailor',
    path: { conflict_id: conflict.conflict_id },
    body: { keep: 'server' },
  },
  listOrders: { role: 'tailor' },
  createOrder: {
    role: 'tailor',
    body: {
      client_id: wanjiruClient.client_id,
      profile_id: profileOf(wanjiruClient.client_id).profile_id,
      garment_type: 'shirt',
      due_date: later,
      items: [item],
    },
  },
  getOrder: { role: 'tailor', path: { order_id: order.order_id } },
  updateOrder: { role: 'tailor', path: { order_id: order.order_id }, body: { notes: 'x' } },
  deleteOrder: { role: 'tailor', path: { order_id: newOrder.order_id } },
  getEaseSuggestions: {
    role: 'tailor',
    query: {
      client_id: wanjiruClient.client_id,
      profile_id: profileOf(wanjiruClient.client_id).profile_id,
      garment_type: 'shirt',
    },
  },
  createSheet: {
    role: 'tailor',
    path: { order_id: order.order_id },
    body: { include_name: false },
  },
  getSheetFile: {
    path: { sheet_file: '00000000-0000-5000-8000-000000000002.png' },
    query: { exp: String(Math.floor(Date.now() / 1000) + 60), sig: '0'.repeat(64) },
  },
  logShare: { role: 'tailor', path: { sheet_id: '__sheet__' }, body: { via: 'download' } },
  listAudit: { role: 'tailor' },
  exportAudit: { role: 'admin' },
  listAccounts: { role: 'admin' },
  approveAccount: { role: 'admin', path: { user_id: pending.user_id } },
  rejectAccount: { role: 'admin', path: { user_id: pending.user_id }, body: { reason: 'No' } },
  disableAccount: { role: 'admin', path: { user_id: pending.user_id } },
  enableAccount: { role: 'admin', path: { user_id: pending.user_id } },
  createMeasurer: {
    role: 'admin',
    body: {
      email: 'c@vt.test',
      password: 'long-enough-1',
      measurer_code: 'C',
      trained_on: '2026-01-01',
    },
  },
  getAdminSettings: { role: 'admin' },
  putAdminSettings: { role: 'admin', body: { retention_months: 24 } },
  listDeletionRequests: { role: 'admin' },
  listRules: { role: 'admin' },
  registerRules: {
    role: 'admin',
    body: {
      rules_version: '0.2-test',
      status: 'draft',
      checksum: `sha256:${'a'.repeat(64)}`,
      created_at: '2026-01-01T00:00:00Z',
      parent: null,
    },
  },
  freezeRules: { role: 'admin', path: { version: '0.2-test' } },
  rederive: { role: 'admin', query: { rules_version: '0.2-test', cohort: 'pilot' } },
  listReferenceReadings: { role: 'admin', query: { participant_code: 'P001' } },
  correctReferenceReading: {
    role: 'admin',
    path: { ref_id: reading.ref_id },
    body: { value_mm: 900, reason: 'Typo' },
  },
  listParticipants: { role: 'admin' },
  enrolParticipant: {
    role: 'admin',
    body: { participant_code: 'P099', sex: 'female', age_band: '25-34', venue: 'Synthetic' },
  },
  updateParticipant: {
    role: 'admin',
    path: { participant_id: participant.participant_id },
    body: { venue: 'Elsewhere' },
  },
  submitReferenceReadings: {
    role: 'measurer',
    body: { participant_code: 'P005', reading_no: 1, values, taken_at: '2026-01-01T00:00:00Z' },
  },
  listMyReferenceReadings: { role: 'measurer', query: { participant_code: 'P001' } },
  listTailors: { query: { search: 'bespoke' } },
  issueDirectoryCode: { path: { listing_id: seed.directory_listings[0].listing_id } },
  listDirectoryClients: { role: 'tailor' },
  removeUnusedDirectoryClients: { role: 'tailor' },
  exportCaptures: { role: 'admin' },
  exportReference: { role: 'admin' },
};

const operations = Object.entries(contract.paths as Record<string, Record<string, any>>).flatMap(
  ([path, item]) =>
    Object.entries(item)
      .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
      .map(([method, op]) => ({ path, method, op })),
);

async function call(path: string, method: string, c: Case, token?: string) {
  const filled = path.replace(/\{(\w+)\}/g, (_, key) => c.path?.[key] ?? 'missing');
  const query = c.query ? `?${new URLSearchParams(c.query)}` : '';
  return fetch(`${BASE}${filled}${query}`, {
    method: method.toUpperCase(),
    headers: {
      ...(c.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...c.headers,
    },
    body: c.body === undefined ? undefined : JSON.stringify(c.body),
  });
}

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  for (const [role, email] of [
    ['tailor', 'wanjiru@vt.test'],
    ['admin', 'admin@vt.test'],
    ['measurer', 'measurer-a@vt.test'],
  ]) {
    const response = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: seed.demo_password }),
    });
    tokens[role] = (await response.json()).access_token;
  }
});
afterAll(() => server.close());

it('has a case for every contract operation', () => {
  expect(operations.map((o) => o.op.operationId).sort()).toEqual(Object.keys(CASES).sort());
});

describe('every endpoint answers as the contract says', () => {
  for (const { path, method, op } of operations) {
    it(`${method.toUpperCase()} ${path}`, async () => {
      const c = CASES[op.operationId];
      if (op.operationId === 'logShare') {
        const made = await call(
          '/orders/{order_id}/sheets',
          'post',
          CASES.createSheet,
          tokens.tailor,
        );
        c.path = { sheet_id: (await made.clone().json()).sheet_id };
      }
      if (op.operationId === 'deleteClient') {
        // Every seeded client has orders or is a participant, so this needs a fresh code.
        const listing = seed.directory_listings.find((l) => l.tailor_id === wanjiru.user_id)!;
        await fetch(`${BASE}/tailors/${listing.listing_id}/codes`, { method: 'POST' });
        const mine = await call('/me/directory-clients', 'get', {}, tokens.tailor);
        c.path = { client_id: (await mine.json()).items[0].client_id };
      }
      const response = await call(path, method, c, c.role ? tokens[c.role] : undefined);
      const declared = op.responses[String(response.status)];
      expect(
        declared,
        `undeclared status ${response.status}: ${await response.clone().text()}`,
      ).toBeTruthy();
      expect(response.status).toBeLessThan(300);
      const type = response.headers.get('Content-Type') ?? '';
      const schema = declared.content?.['application/json']?.schema;
      if (schema && type.includes('json')) {
        const valid = ajv.validate(resolve(schema), await response.json());
        expect(valid, JSON.stringify(ajv.errors?.slice(0, 3))).toBe(true);
      }
    });
  }
});

function resolve(schema: any): any {
  return schema.$ref
    ? { $ref: `contract${schema.$ref}` }
    : JSON.parse(JSON.stringify(schema).replaceAll('"#/', '"contract#/'));
}

it('refuses a signed-out caller and the wrong role on every secured endpoint', async () => {
  for (const { path, method, op } of operations) {
    if (!op.security) continue;
    const c = CASES[op.operationId];
    const anon = await call(path, method, c);
    expect(anon.status, `${method} ${path}`).toBe(401);
    const wrong = (['tailor', 'admin', 'measurer'] as const).find(
      (r) => !op['x-roles'].includes(r),
    );
    if (wrong) {
      const refused = await call(path, method, c, tokens[wrong]);
      expect(refused.status, `${method} ${path}`).toBe(403);
    }
  }
});

it('one tailor cannot open another tailor’s client', async () => {
  const otieno = seed.clients.find((c) => c.tailor_id !== wanjiru.user_id)!;
  const response = await call(
    '/clients/{client_id}',
    'get',
    { path: { client_id: otieno.client_id } },
    tokens.tailor,
  );
  expect(response.status).toBe(403);
});

it('injects a failure on request', async () => {
  const response = await fetch(`${BASE}/health?__fail=409`);
  expect(response.status).toBe(409);
});

it('rate-limit failures say when to retry', async () => {
  const response = await fetch(`${BASE}/health?__fail=429`);
  expect(response.headers.get('Retry-After')).toBe('60');
});

it('keeps exactly one order overdue after shifting dates', () => {
  const shifted = shiftDates(structuredClone(seed.orders), 365);
  const anchor = new Date(Date.parse(`${seed.anchor_date}T00:00:00Z`) + 365 * 864e5)
    .toISOString()
    .slice(0, 10);
  expect(shifted.filter((o) => o.due_date < anchor && o.status !== 'collected')).toHaveLength(1);
});

describe('tailor directory (D27)', () => {
  // Earlier cases approve the pending tailor, so these start from a fresh copy of the seed.
  beforeAll(() => server.use(...createHandlers()));
  afterAll(() => server.resetHandlers());

  const list = async (query = '') => (await fetch(`${BASE}/tailors${query}`)).json();

  it('lists active tailors who opted in, with published fields only', async () => {
    const { items, areas } = await list();
    expect(items.map((row: any) => row.business_name)).not.toContain(pending.business_name);
    expect(areas).not.toContain(pending.area);
    for (const row of items) {
      expect(Object.keys(row).sort()).toEqual(
        ['area', 'business_name', 'description', 'listing_id', 'phone', 'specialties'].sort(),
      );
    }
    const wanjiruRow = items.find((row: any) => row.business_name === wanjiru.business_name);
    expect(wanjiruRow.phone).toBeNull();
  });

  const clientOf = (code: string) => seed.clients.find((c) => c.client_code === code)!;
  const asTailor = (path: string, method = 'GET') =>
    fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${tokens.tailor}` } });

  it('refuses to remove a participant or a client with collected orders', async () => {
    for (const code of ['AB1008', 'AB1006']) {
      const reply = await asTailor(`/clients/${clientOf(code).client_id}`, 'DELETE');
      expect(reply.status, code).toBe(409);
      expect((await reply.json()).code, code).toBe('client_records_retained');
    }
    const active = await asTailor(`/clients/${clientOf('AB1004').client_id}`, 'DELETE');
    expect((await active.json()).code).toBe('client_has_orders');
  });

  it('removes unused directory clients in bulk and counts them', async () => {
    const { items } = await list();
    const mine = items.find((row: any) => row.business_name === wanjiru.business_name);
    for (let i = 0; i < 2; i += 1) {
      await fetch(`${BASE}/tailors/${mine.listing_id}/codes`, { method: 'POST' });
    }
    const before = await (await asTailor('/me/directory-clients')).json();
    expect(before.unused_total).toBe(before.total);
    expect(before.total).toBeGreaterThanOrEqual(2);
    const removed = await (await asTailor('/me/directory-clients/remove-unused', 'POST')).json();
    expect(removed.removed).toBe(before.total);
    const after = await (await asTailor('/me/directory-clients')).json();
    expect([after.total, after.unused_total]).toEqual([0, 0]);
    // Seeded clients came from the tailor, so the bulk action leaves them alone.
    expect((await asTailor(`/clients/${clientOf('AB1008').client_id}`)).status).toBe(200);
  });

  it('a pending tailor issues no code, even when opted in', async () => {
    const listing = seed.directory_listings.find((l) => l.tailor_id === pending.user_id)!;
    const reply = await fetch(`${BASE}/tailors/${listing.listing_id}/codes`, { method: 'POST' });
    expect(reply.status).toBe(404);
  });

  it('filters by words, area and specialty', async () => {
    expect((await list('?area=gikomba')).total).toBe(1);
    expect((await list('?specialty=suits')).total).toBe(1);
    expect((await list('?specialty=uniforms')).total).toBe(0);
    expect((await list('?search=zzz')).total).toBe(0);
  });

  it('issues a new unique code each time, marked as from the directory, then limits', async () => {
    const { items } = await list();
    const reply = await fetch(`${BASE}/tailors/${items[0].listing_id}/codes`, { method: 'POST' });
    const first = (await reply.json()).client_code;
    expect(first).toMatch(/^[A-Z]{2}[0-9]{4}$/);
    const check = await (await fetch(`${BASE}/client-codes/${first}`)).json();
    expect(check.tailor_business_name).toBe(items[0].business_name);
    let last = 201;
    for (let i = 0; i < 12; i += 1) {
      last = (await fetch(`${BASE}/tailors/${items[0].listing_id}/codes`, { method: 'POST' }))
        .status;
    }
    expect(last).toBe(429);
  });
});
