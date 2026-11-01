// MSW handlers for every endpoint in packages/contracts/openapi.yaml, backed by the demo seed.
import { delay, http, HttpResponse } from 'msw';
import errorCodes from '../../../packages/contracts/error-codes.json';
import rulesArtifact from '../../../packages/rules/rules-0.1-uncalibrated.json';
import { createDb, MockDb } from './store';

type Row = Record<string, any>;
type Code = keyof typeof errorCodes;

interface Ctx {
  url: URL;
  params: Record<string, string>;
  body: any;
  user: Row | null;
  request: Request;
}
type Result = Response | Row | Row[] | null;
type Handler = (ctx: Ctx) => Result | Promise<Result>;

const BASE = '/api/v1';

export interface MockOptions {
  /** Added latency in ms. Tests pass 0; dev uses 150 to 600 ms. */
  latency?: () => number;
  /** Failure injected by the dev panel, on top of the ?__fail=409 query. */
  failure?: () => number | null;
  now?: () => Date;
}

function newId(): string {
  return crypto.randomUUID();
}

function problem(code: Code, extra: Row = {}): Response {
  const entry = errorCodes[code];
  return HttpResponse.json(
    { type: 'about:blank', title: entry.title, status: entry.status, code, ...extra },
    {
      status: entry.status,
      headers: {
        'Content-Type': 'application/problem+json',
        ...(entry.status === 429 ? { 'Retry-After': '60' } : {}),
      },
    },
  );
}

function statusProblem(status: number): Response {
  const match = (Object.keys(errorCodes) as Code[]).find((c) => errorCodes[c].status === status);
  if (match) return problem(match);
  return HttpResponse.json(
    { type: 'about:blank', title: 'Injected failure', status, code: 'injected' },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

function csv(text: string): Response {
  return new HttpResponse(text, { headers: { 'Content-Type': 'text/csv' } });
}

function page(url: URL, rows: Row[]): Row {
  const pageNo = Number(url.searchParams.get('page') ?? 1);
  const size = Number(url.searchParams.get('page_size') ?? 25);
  return {
    items: rows.slice((pageNo - 1) * size, pageNo * size),
    page: pageNo,
    page_size: size,
    total: rows.length,
  };
}

function flagCounts(profile: Row): Row {
  const counts = { pass: 0, check: 0, fail: 0 };
  for (const row of profile.measurements)
    counts[row.confidence_flag as 'pass' | 'check' | 'fail'] += 1;
  return counts;
}

function audit(
  db: MockDb,
  user: Row | null,
  action: string,
  type: string,
  id: string,
  summary: string,
): void {
  db.audit.push({
    log_id: `L${String(db.audit.length + 1).padStart(5, '0')}`,
    occurred_at: new Date().toISOString(),
    actor_type: user ? 'user' : 'client',
    user_email: user?.email ?? null,
    role: user?.role ?? null,
    action,
    entity_type: type,
    entity_id: id,
    summary,
  });
}

function toUser(row: Row, listing?: Row): Row {
  const { created_at: _created, trained_on: _trained, ...user } = row;
  if (row.role !== 'tailor') return user;
  return {
    ...user,
    directory_listed: listing?.listed ?? false,
    directory_show_phone: listing?.show_phone ?? false,
    directory_specialties: listing?.specialties ?? [],
    directory_description: listing?.description ?? null,
  };
}

function toAccount(row: Row): Row {
  const { locale: _locale, unit_pref: _unit, ...account } = row;
  return account;
}

const STATUS_RANK = ['new', 'cutting', 'fitting', 'ready', 'collected'];

export function createHandlers(options: MockOptions = {}) {
  const now = options.now ?? (() => new Date());
  const db = createDb(rulesArtifact, now());

  const clientsOf = (user: Row) =>
    user.role === 'admin' ? db.clients : db.clients.filter((c) => c.tailor_id === user.user_id);
  const directoryClients = (user: Row) =>
    clientsOf(user).filter((c) => c.source === 'directory' && !c.deletion_requested);
  const unusedClient = (client: Row) =>
    !db.profiles.some((p) => p.client_id === client.client_id) &&
    !db.orders.some((o) => o.client_id === client.client_id) &&
    !db.participants.some((p) => p.client_code === client.client_code);
  const ownsClient = (user: Row, client: Row) =>
    user.role === 'admin' || client.tailor_id === user.user_id;
  const clientById = (id: string) => db.clients.find((c) => c.client_id === id);
  const clientByCode = (code: string) =>
    db.clients.find((c) => c.client_code === code && !c.deletion_requested);
  const profileById = (id: string) => db.profiles.find((p) => p.profile_id === id);
  const orderOf = (user: Row, id: string) => {
    const order = db.orders.find((o) => o.order_id === id);
    if (!order) return null;
    return clientById(order.client_id)?.tailor_id === user.user_id ? order : null;
  };
  const participant = (code: string) => db.participants.find((p) => p.participant_code === code);
  const listingOf = (tailorId: string) => db.listings.find((l) => l.tailor_id === tailorId);
  const asUser = (row: Row) => toUser(row, listingOf(row.user_id));
  const issued: number[] = [];
  /** Listed means opted in and active (D27): the same rule as the API. */
  const listedRows = () =>
    db.listings.flatMap((listing) => {
      const tailor = db.users.find((u) => u.user_id === listing.tailor_id);
      return listing.listed && tailor?.status === 'active' ? [{ listing, tailor }] : [];
    });
  const newCode = () => {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const pick = () => letters[Math.floor(Math.random() * letters.length)];
    for (;;) {
      const code = `${pick()}${pick()}${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
      if (!db.clients.some((c) => c.client_code === code)) return code;
    }
  };

  function route(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    roles: string[] | null,
    fn: Handler,
  ) {
    return http[method](`*${BASE}${path}`, async ({ request, params }) => {
      const url = new URL(request.url);
      await delay(options.latency?.() ?? 0);
      const injected = Number(url.searchParams.get('__fail')) || options.failure?.() || null;
      if (injected) return statusProblem(injected);

      const token = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
      const user = db.users.find((u) => `mock.${u.user_id}` === token) ?? null;
      if (roles) {
        if (!user) return problem('unauthorized');
        if (!roles.includes(user.role)) return problem('forbidden');
      }
      const type = request.headers.get('Content-Type') ?? '';
      const text = method === 'get' ? '' : await request.text();
      // Like the API: only a body that is really there has to be JSON.
      if (method !== 'delete' && text && !type.includes('json')) {
        return problem('unsupported_media_type');
      }
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        return problem('validation_failed');
      }
      const result = await fn({
        url,
        params: params as Record<string, string>,
        body,
        user,
        request,
      });
      if (result instanceof Response) return result;
      if (result === null) return new HttpResponse(null, { status: 204 });
      return HttpResponse.json(result);
    });
  }

  const created = (row: Row, status = 201) => HttpResponse.json(row, { status });
  const staff = ['tailor', 'admin'];
  const all = ['tailor', 'admin', 'measurer'];

  return [
    route('get', '/health', null, () => ({ status: 'ok' })),
    route('get', '/ready', null, () => ({ status: 'ok' })),
    route('get', '/settings/public', null, () => ({
      study_mode: db.settings.study_mode,
      consent_version: db.settings.consent_version,
      min_app_version: db.settings.min_app_version,
      current_rules_version: db.settings.current_rules_version,
    })),
    route(
      'get',
      '/rules/current',
      null,
      () =>
        db.rules.find((r) => r.rules_version === db.settings.current_rules_version) ?? db.rules[0],
    ),
    route(
      'get',
      '/rules/:version',
      null,
      ({ params }) =>
        db.rules.find((r) => r.rules_version === params.version) ??
        problem('rules_version_unknown'),
    ),
    route('get', '/client-codes/:code', null, ({ params }) => {
      const client = clientByCode(params.code);
      if (!client) return problem('code_not_found');
      const tailor = db.users.find((u) => u.user_id === client.tailor_id);
      return {
        valid: true,
        tailor_business_name: tailor?.business_name ?? '',
        height_mm: client.height_mm,
      };
    }),
    route('get', '/tailors', null, ({ url }) => {
      const words = url.searchParams.get('search')?.trim().toLowerCase() ?? '';
      const area = url.searchParams.get('area')?.trim().toLowerCase() ?? '';
      const specialty = url.searchParams.get('specialty');
      const everyone = listedRows();
      const rows = everyone
        .filter(
          ({ listing, tailor }) =>
            !words ||
            [tailor.business_name, tailor.area, listing.description].some((text) =>
              text?.toLowerCase().includes(words),
            ),
        )
        .filter(({ tailor }) => !area || tailor.area.toLowerCase() === area)
        .filter(({ listing }) => !specialty || listing.specialties.includes(specialty))
        .sort((a, b) => a.tailor.business_name.localeCompare(b.tailor.business_name))
        .map(({ listing, tailor }) => ({
          listing_id: listing.listing_id,
          business_name: tailor.business_name,
          area: tailor.area,
          specialties: listing.specialties,
          description: listing.description,
          phone: listing.show_phone ? tailor.phone : null,
        }));
      return {
        ...page(url, rows),
        areas: [...new Set(everyone.map(({ tailor }) => tailor.area))].filter(Boolean).sort(),
      };
    }),
    route('post', '/tailors/:listing_id/codes', null, ({ params }) => {
      const hit = listedRows().find(({ listing }) => listing.listing_id === params.listing_id);
      if (!hit) return problem('not_found');
      const hourAgo = now().getTime() - 3_600_000;
      while (issued.length && issued[0] < hourAgo) issued.shift();
      if (issued.length >= 10) return problem('rate_limited');
      issued.push(now().getTime());
      const client = {
        client_id: newId(),
        client_code: newCode(),
        tailor_id: hit.tailor.user_id,
        display_name: null,
        height_mm: null,
        created_at: now().toISOString(),
        deletion_requested: false,
        source: 'directory',
      };
      db.clients.push(client);
      audit(db, null, 'code_issue', 'client', client.client_id, 'Code issued from the directory');
      return created({
        client_code: client.client_code,
        tailor_business_name: hit.tailor.business_name,
      });
    }),
    route('post', '/profiles', null, ({ body, request }) => {
      if (request.headers.get('Idempotency-Key') !== body.profile_id)
        return problem('validation_failed');
      if (JSON.stringify(body).includes('data:image')) return problem('image_content_rejected');
      const client = clientByCode(body.client_code);
      if (!client) return problem('code_not_found');
      if (!body.consent?.scope?.includes('measure')) return problem('consent_missing');
      const replay = profileById(body.profile_id);
      if (replay)
        return created({
          profile_id: replay.profile_id,
          version: replay.version,
          server_checks: replay.server_checks,
        });
      const versions = db.profiles
        .filter((p) => p.client_id === client.client_id && p.status === 'final')
        .map((p) => p.version);
      const max = versions.length ? Math.max(...versions) : 0;
      const stored = {
        ...body,
        client_id: client.client_id,
        received_at: new Date().toISOString(),
        server_checks: [],
      };
      audit(db, null, 'profile_ingest', 'profile', body.profile_id, 'Synced');
      if (body.version <= max) {
        const server = db.profiles.find(
          (p) => p.client_id === client.client_id && p.version === max && p.status === 'final',
        )!;
        stored.status = 'conflict';
        db.profiles.push(stored);
        const conflictId = newId();
        const side = (p: Row) => ({
          profile_id: p.profile_id,
          version: p.version,
          captured_at: p.captured_at,
          measurements: p.measurements,
        });
        db.conflicts.push({
          conflict_id: conflictId,
          client_id: client.client_id,
          client_code: client.client_code,
          server_profile: side(server),
          incoming_profile: side(stored),
          created_at: new Date().toISOString(),
          resolved_at: null,
          resolution: null,
        });
        return problem('profile_version_conflict', {
          server_version: max,
          conflict_id: conflictId,
        });
      }
      db.profiles.push(stored);
      return created({ profile_id: body.profile_id, version: body.version, server_checks: [] });
    }),
    route('post', '/deletion-requests', null, ({ body }) => {
      const client = clientByCode(body.client_code);
      const owned =
        client &&
        body.profile_ids.some((id: string) => profileById(id)?.client_id === client.client_id);
      if (!owned) return problem('not_found');
      const request = {
        request_id: newId(),
        reason: body.reason,
        received_at: new Date().toISOString(),
        status: 'received',
        completed_at: null,
      };
      db.deletionRequests.push(request);
      audit(db, null, 'deletion_request', 'client', client.client_id, 'Client asked for deletion');
      return created({ request_id: request.request_id, status: request.status }, 202);
    }),
    route('post', '/data-requests/access', null, ({ body }) => {
      const client = clientByCode(body.client_code);
      const owned =
        client &&
        body.profile_ids.some((id: string) => profileById(id)?.client_id === client.client_id);
      if (!owned) return problem('not_found');
      const profiles = db.profiles.filter((p) => p.client_id === client.client_id);
      audit(db, null, 'access_request', 'client', client.client_id, 'Client asked for a copy');
      return {
        client_code: client.client_code,
        profiles,
        consents: profiles.map((p) => p.consent),
        order_count: db.orders.filter((o) => o.client_id === client.client_id).length,
      };
    }),

    route('post', '/auth/register', null, ({ body }) => {
      if (db.users.some((u) => u.email === body.email)) return problem('validation_failed');
      const user = {
        user_id: newId(),
        email: body.email,
        role: 'tailor',
        status: 'pending',
        locale: body.locale,
        unit_pref: 'cm',
        business_name: body.business_name,
        phone: body.phone,
        area: body.area,
        created_at: new Date().toISOString(),
      };
      db.users.push(user);
      db.passwords[body.email] = body.password;
      audit(db, null, 'register', 'user', user.user_id, 'A tailor registered');
      return created({ status: 'pending' });
    }),
    route('post', '/auth/login', null, ({ body }) => {
      const user = db.users.find((u) => u.email === body.email);
      if (!user || db.passwords[body.email] !== body.password) {
        audit(db, null, 'login_failed', 'user', 'unknown', 'Wrong password');
        return problem('invalid_credentials');
      }
      if (user.status === 'pending') return problem('account_pending');
      if (user.status === 'disabled') return problem('account_disabled');
      if (user.status === 'rejected') return problem('account_rejected');
      audit(db, user, 'login', 'user', user.user_id, 'Signed in');
      return {
        access_token: `mock.${user.user_id}`,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        user: asUser(user),
      };
    }),
    route('post', '/auth/logout', all, ({ user }) => {
      audit(db, user, 'logout', 'user', user!.user_id, 'Signed out');
      return null;
    }),
    route('get', '/me', all, ({ user }) => asUser(user!)),
    route('patch', '/me', all, ({ user, body }) => {
      const {
        directory_listed: listed,
        directory_show_phone: showPhone,
        directory_specialties: specialties,
        directory_description: description,
        ...rest
      } = body;
      const touched = [listed, showPhone, specialties, description].some((v) => v !== undefined);
      if (touched) {
        if (user!.role !== 'tailor') return problem('validation_failed');
        let listing = listingOf(user!.user_id);
        if (!listing) {
          listing = {
            tailor_id: user!.user_id,
            listing_id: newId(),
            listed: false,
            show_phone: false,
            specialties: [],
            description: null,
          };
          db.listings.push(listing);
        }
        if (listed !== undefined) listing.listed = listed;
        if (showPhone !== undefined) listing.show_phone = showPhone;
        if (specialties !== undefined) listing.specialties = specialties;
        if (description !== undefined) listing.description = description.trim() || null;
      }
      Object.assign(user!, rest);
      audit(db, user, 'settings_change', 'user', user!.user_id, 'Changed settings');
      return asUser(user!);
    }),
    route('post', '/me/password', all, ({ user, body }) => {
      if (db.passwords[user!.email] !== body.current_password)
        return problem('invalid_credentials');
      db.passwords[user!.email] = body.new_password;
      audit(db, user, 'settings_change', 'user', user!.user_id, 'Changed password');
      return null;
    }),
    route('get', '/me/ease-presets', ['tailor'], ({ user }) => db.easePresets[user!.user_id] ?? []),
    route('put', '/me/ease-presets', ['tailor'], ({ user, body }) => {
      db.easePresets[user!.user_id] = body;
      audit(db, user, 'settings_change', 'ease_preset', user!.user_id, 'Changed ease presets');
      return body;
    }),

    route('get', '/me/directory-clients', ['tailor'], ({ user, url }) => {
      const rows = directoryClients(user!);
      return {
        ...page(
          url,
          rows
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((c) => ({
              client_id: c.client_id,
              client_code: c.client_code,
              created_at: c.created_at,
              has_profile: db.profiles.some((p) => p.client_id === c.client_id),
            })),
        ),
        unused_total: rows.filter(unusedClient).length,
      };
    }),
    route('post', '/me/directory-clients/remove-unused', ['tailor'], ({ user }) => {
      const rows = directoryClients(user!).filter(unusedClient);
      for (const client of rows) client.deletion_requested = true;
      if (rows.length) {
        audit(
          db,
          user,
          'deletion',
          'tailor',
          user!.user_id,
          `Removed unused codes: ${rows.length}`,
        );
      }
      return { removed: rows.length };
    }),
    route('get', '/clients', staff, ({ user, url }) => {
      const search = url.searchParams.get('search')?.toLowerCase() ?? '';
      const filter = url.searchParams.get('filter');
      const rows = clientsOf(user!)
        .filter((c) => !c.deletion_requested)
        .map((client) => {
          const own = db.profiles
            .filter((p) => p.client_id === client.client_id && p.status !== 'superseded')
            .sort((a, b) => b.captured_at.localeCompare(a.captured_at));
          const latest = own.find((p) => p.status === 'final') ?? own[0];
          const counts = latest ? flagCounts(latest) : null;
          return {
            client_id: client.client_id,
            client_code: client.client_code,
            display_name: client.display_name,
            source: client.source,
            last_capture_at: latest?.captured_at ?? null,
            flag_counts: counts,
            open_orders: db.orders.filter(
              (o) => o.client_id === client.client_id && o.status !== 'collected',
            ).length,
            has_new: Boolean(latest) && !db.orders.some((o) => o.profile_id === latest.profile_id),
            has_conflict: db.conflicts.some(
              (c) => c.client_id === client.client_id && !c.resolved_at,
            ),
          };
        })
        .filter(
          (c) =>
            !search ||
            c.client_code.toLowerCase().includes(search) ||
            c.display_name?.toLowerCase().includes(search),
        )
        .filter((c) => {
          if (filter === 'has_new') return c.has_new;
          if (filter === 'has_flags')
            return Boolean(c.flag_counts && c.flag_counts.check + c.flag_counts.fail);
          if (filter === 'no_profiles') return !c.last_capture_at;
          return true;
        })
        .sort((a, b) => (b.last_capture_at ?? '').localeCompare(a.last_capture_at ?? ''));
      return page(url, rows);
    }),
    route('post', '/clients', ['tailor'], ({ user, body }) => {
      const code = `VT${String(1000 + db.clients.length).slice(-4)}`;
      const client = {
        client_id: newId(),
        client_code: code,
        tailor_id: user!.user_id,
        display_name: body.display_name ?? null,
        height_mm: body.height_mm ?? null,
        created_at: new Date().toISOString(),
        deletion_requested: false,
      };
      db.clients.push(client);
      audit(db, user, 'code_issue', 'client', client.client_id, 'Issued a client code');
      return created({
        client_id: client.client_id,
        client_code: code,
        deep_link: `/start?code=${code}`,
      });
    }),
    route('get', '/clients/:client_id', staff, ({ user, params }) => {
      const client = clientById(params.client_id);
      if (!client) return problem('not_found');
      return ownsClient(user!, client) ? client : problem('forbidden');
    }),
    route('patch', '/clients/:client_id', staff, ({ user, params, body }) => {
      const client = clientById(params.client_id);
      if (!client) return problem('not_found');
      if (!ownsClient(user!, client)) return problem('forbidden');
      Object.assign(client, body);
      audit(db, user, 'client_update', 'client', client.client_id, 'Changed client details');
      return client;
    }),
    route('delete', '/clients/:client_id', staff, ({ user, params }) => {
      const client = clientById(params.client_id);
      if (!client) return problem('not_found');
      if (!ownsClient(user!, client)) return problem('forbidden');
      if (db.orders.some((o) => o.client_id === client.client_id && o.status !== 'collected')) {
        return problem('client_has_orders');
      }
      if (
        db.orders.some((o) => o.client_id === client.client_id) ||
        db.participants.some((p) => p.client_code === client.client_code)
      ) {
        return problem('client_records_retained');
      }
      client.deletion_requested = true;
      audit(db, user, 'deletion', 'client', client.client_id, 'Marked for deletion');
      return null;
    }),
    route('post', '/clients/:client_id/rotate-code', ['tailor'], ({ user, params }) => {
      const client = clientById(params.client_id);
      if (!client) return problem('not_found');
      if (!ownsClient(user!, client)) return problem('forbidden');
      client.client_code = `RT${String(1000 + db.audit.length).slice(-4)}`;
      audit(db, user, 'code_rotate', 'client', client.client_id, 'Replaced a client code');
      return { client_code: client.client_code };
    }),
    route('get', '/clients/:client_id/profiles', staff, ({ user, params }) => {
      const client = clientById(params.client_id);
      if (!client) return problem('not_found');
      if (!ownsClient(user!, client)) return problem('forbidden');
      return db.profiles
        .filter((p) => p.client_id === client.client_id)
        .sort((a, b) => b.captured_at.localeCompare(a.captured_at))
        .map((p) => ({
          profile_id: p.profile_id,
          version: p.version,
          captured_at: p.captured_at,
          status: p.status,
          capture_mode: p.session.capture_mode,
          flag_counts: flagCounts(p),
          server_check_count: p.server_checks.length,
        }));
    }),
    route('get', '/profiles/:profile_id', staff, ({ user, params }) => {
      const profile = profileById(params.profile_id);
      if (!profile) return problem('not_found');
      if (!ownsClient(user!, clientById(profile.client_id)!)) return problem('forbidden');
      audit(db, user, 'profile_view', 'profile', profile.profile_id, 'Opened a profile');
      return profile;
    }),
    route('get', '/conflicts', ['tailor'], ({ user }) =>
      db.conflicts.filter(
        (c) => !c.resolved_at && clientById(c.client_id)?.tailor_id === user!.user_id,
      ),
    ),
    route('post', '/conflicts/:conflict_id/resolve', ['tailor'], ({ user, params, body }) => {
      const conflict = db.conflicts.find((c) => c.conflict_id === params.conflict_id);
      if (!conflict) return problem('not_found');
      if (clientById(conflict.client_id)?.tailor_id !== user!.user_id) return problem('forbidden');
      const server = profileById(conflict.server_profile.profile_id)!;
      const incoming = profileById(conflict.incoming_profile.profile_id)!;
      if (body.keep === 'newer') {
        const [newer, older] =
          incoming.captured_at > server.captured_at ? [incoming, server] : [server, incoming];
        newer.status = 'final';
        newer.version = Math.max(server.version, incoming.version) + 1;
        older.status = 'superseded';
      } else {
        incoming.status = 'superseded';
      }
      conflict.resolved_at = new Date().toISOString();
      conflict.resolution = body.keep;
      audit(db, user, 'conflict_resolve', 'conflict', conflict.conflict_id, `Kept ${body.keep}`);
      return conflict;
    }),

    route('get', '/orders', ['tailor'], ({ user, url }) => {
      const status = url.searchParams.get('status');
      const rows = db.orders
        .filter((o) => clientById(o.client_id)?.tailor_id === user!.user_id)
        .filter((o) => !status || o.status === status)
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
        .map((o) => ({
          order_id: o.order_id,
          order_no: o.order_no,
          client_id: o.client_id,
          client_code: o.client_code,
          display_name: o.display_name,
          profile_version: o.profile_version,
          garment_type: o.garment_type,
          status: o.status,
          due_date: o.due_date,
          flagged_sites: o.items.filter((i: Row) => i.confidence_flag !== 'pass').length,
          has_conflict: db.conflicts.some((c) => c.client_id === o.client_id && !c.resolved_at),
        }));
      return page(url, rows);
    }),
    route('post', '/orders', ['tailor'], ({ user, body }) => {
      const client = clientById(body.client_id);
      const profile = profileById(body.profile_id);
      if (!client || !profile) return problem('not_found');
      if (client.tailor_id !== user!.user_id) return problem('forbidden');
      if (body.due_date < db.today) return problem('due_date_past');
      const flags = Object.fromEntries(
        profile.measurements.map((m: Row) => [m.site_code, m.confidence_flag]),
      );
      const mine = db.orders.filter((o) => clientById(o.client_id)?.tailor_id === user!.user_id);
      const stamp = new Date().toISOString();
      const order = {
        order_id: newId(),
        order_no: `ORD-${String(mine.length + 1).padStart(4, '0')}`,
        client_id: client.client_id,
        client_code: client.client_code,
        display_name: client.display_name,
        profile_id: profile.profile_id,
        profile_version: profile.version,
        garment_type: body.garment_type,
        status: 'new',
        due_date: body.due_date,
        notes: body.notes ?? '',
        items: body.items.map((item: Row) => ({
          ...item,
          finished_mm: item.body_mm === null ? null : item.body_mm + item.ease_mm,
          confidence_flag: flags[item.site_code],
        })),
        created_at: stamp,
        updated_at: stamp,
        status_history: [{ status: 'new', at: stamp }],
      };
      db.orders.push(order);
      audit(db, user, 'order_create', 'order', order.order_id, `Created ${order.order_no}`);
      return created(order);
    }),
    route('get', '/orders/:order_id', ['tailor'], ({ user, params }) => {
      if (!db.orders.some((o) => o.order_id === params.order_id)) return problem('not_found');
      return orderOf(user!, params.order_id) ?? problem('forbidden');
    }),
    route('patch', '/orders/:order_id', ['tailor'], ({ user, params, body }) => {
      if (!db.orders.some((o) => o.order_id === params.order_id)) return problem('not_found');
      const order = orderOf(user!, params.order_id);
      if (!order) return problem('forbidden');
      const stamp = new Date().toISOString();
      if (body.status && body.status !== order.status) {
        order.status_history.push({ status: body.status, at: stamp });
        audit(
          db,
          user,
          'status_change',
          'order',
          order.order_id,
          `${order.order_no} moved to ${body.status}`,
        );
      }
      if (body.items) {
        const flags = Object.fromEntries(
          order.items.map((i: Row) => [i.site_code, i.confidence_flag]),
        );
        body.items = body.items.map((item: Row) => ({
          ...item,
          finished_mm: item.body_mm === null ? null : item.body_mm + item.ease_mm,
          confidence_flag: flags[item.site_code] ?? 'pass',
        }));
      }
      Object.assign(order, body, { updated_at: stamp });
      audit(db, user, 'order_update', 'order', order.order_id, `Changed ${order.order_no}`);
      return order;
    }),
    route('delete', '/orders/:order_id', ['tailor'], ({ user, params }) => {
      if (!db.orders.some((o) => o.order_id === params.order_id)) return problem('not_found');
      const order = orderOf(user!, params.order_id);
      if (!order) return problem('forbidden');
      if (STATUS_RANK.indexOf(order.status) > 0) return problem('validation_failed');
      db.orders.splice(db.orders.indexOf(order), 1);
      audit(db, user, 'order_delete', 'order', order.order_id, `Deleted ${order.order_no}`);
      return null;
    }),
    route('get', '/ease-suggestions', ['tailor'], ({ user, url }) => {
      const presets = db.easePresets[user!.user_id] ?? [];
      const garment = url.searchParams.get('garment_type');
      return presets
        .filter((p) => p.garment_type === garment)
        .map((p) => ({ site_code: p.site_code, ease_mm: p.ease_mm, source: 'preset', n: 0 }));
    }),
    route('post', '/orders/:order_id/sheets', ['tailor'], ({ user, params, body }) => {
      if (!db.orders.some((o) => o.order_id === params.order_id)) return problem('not_found');
      const order = orderOf(user!, params.order_id);
      if (!order) return problem('forbidden');
      const sheetId = newId();
      db.sheets.push({ sheet_id: sheetId, order_id: order.order_id });
      audit(db, user, 'export', 'sheet', sheetId, 'Generated a sheet');
      const expires = Math.floor(Date.now() / 1000) + 600;
      const sig = '0'.repeat(64);
      const name = body.include_name && order.display_name ? `${order.display_name} ` : '';
      return created({
        sheet_id: sheetId,
        png_url: `${BASE}/files/sheets/${sheetId}.png?exp=${expires}&sig=${sig}`,
        pdf_url: `${BASE}/files/sheets/${sheetId}.pdf?exp=${expires}&sig=${sig}`,
        share_text: `Virtual Tailor ${order.order_no} ${name}${order.client_code}`,
        generated_at: new Date().toISOString(),
      });
    }),
    route('get', '/files/sheets/:sheet_file', null, ({ params, url }) => {
      if (Number(url.searchParams.get('exp')) < Date.now() / 1000) return problem('forbidden');
      const type = params.sheet_file.endsWith('.pdf') ? 'application/pdf' : 'image/png';
      return new HttpResponse(new Uint8Array([0]), { headers: { 'Content-Type': type } });
    }),
    route('post', '/sheets/:sheet_id/shares', ['tailor'], ({ user, params, body }) => {
      if (!db.sheets.some((s) => s.sheet_id === params.sheet_id)) return problem('not_found');
      audit(db, user, 'share', 'sheet', params.sheet_id, `Shared by ${body.via}`);
      return null;
    }),

    route('get', '/audit', all, ({ user, url }) => {
      const action = url.searchParams.get('action');
      const rows = db.audit
        .filter((a) => user!.role === 'admin' || a.user_email === user!.email)
        .filter((a) => !action || a.action === action)
        .slice()
        .reverse();
      return page(url, rows);
    }),
    route('get', '/admin/audit.csv', ['admin'], ({ user }) => {
      audit(db, user, 'export', 'audit', 'audit.csv', 'Exported the audit log');
      const lines = db.audit.map((a) =>
        [a.occurred_at, a.user_email ?? '', a.action, a.entity_type, a.entity_id].join(','),
      );
      return csv(['occurred_at,user_email,action,entity_type,entity_id', ...lines].join('\n'));
    }),
    route('get', '/admin/accounts', ['admin'], ({ url }) => {
      const status = url.searchParams.get('status');
      return page(url, db.users.filter((u) => !status || u.status === status).map(toAccount));
    }),
    ...(
      [
        ['approve', 'active', 'approve'],
        ['reject', 'rejected', 'account_reject'],
        ['disable', 'disabled', 'account_disable'],
        ['enable', 'active', 'account_enable'],
      ] as const
    ).map(([verb, status, action]) =>
      route('post', `/admin/accounts/:user_id/${verb}`, ['admin'], ({ user, params }) => {
        const target = db.users.find((u) => u.user_id === params.user_id);
        if (!target) return problem('not_found');
        target.status = status;
        audit(db, user, action, 'user', target.user_id, `Account ${status}`);
        return toAccount(target);
      }),
    ),
    route('post', '/admin/measurers', ['admin'], ({ user, body }) => {
      const account = {
        user_id: newId(),
        email: body.email,
        role: 'measurer',
        status: 'active',
        locale: 'en',
        unit_pref: 'cm',
        measurer_code: body.measurer_code,
        trained_on: body.trained_on,
        created_at: new Date().toISOString(),
      };
      db.users.push(account);
      db.passwords[body.email] = body.password;
      audit(db, user, 'account_create', 'user', account.user_id, 'Added a measurer');
      return created(toAccount(account));
    }),
    route('get', '/admin/settings', ['admin'], () => db.settings),
    route('put', '/admin/settings', ['admin'], ({ user, body }) => {
      Object.assign(db.settings, body);
      if (body.approvals) {
        const required = [
          'ierc_ref',
          'nacosti_licence_no',
          'dpia_submitted_on',
          'approvals_confirmed_by',
          'confirmed_at',
        ];
        db.settings.approvals_missing = required.filter((k) => !db.settings.approvals[k]);
      }
      audit(db, user, 'settings_change', 'settings', 'admin', 'Changed admin settings');
      return db.settings;
    }),
    route('get', '/admin/deletion-requests', ['admin'], () => db.deletionRequests),
    route('get', '/admin/rules', ['admin'], () =>
      db.rules.map((r) => ({
        rules_version: r.rules_version,
        status: r.status,
        checksum: r.checksum,
        parent: r.parent,
        frozen_at: r.frozen_at ?? null,
        created_at: r.created_at,
        is_current: r.rules_version === db.settings.current_rules_version,
      })),
    ),
    route('post', '/admin/rules', ['admin'], ({ user, body }) => {
      db.rules.push(body);
      audit(db, user, 'rules_register', 'rules', body.rules_version, 'Registered rules');
      return created({
        rules_version: body.rules_version,
        status: 'draft',
        checksum: body.checksum,
        parent: body.parent ?? null,
        frozen_at: null,
        created_at: body.created_at ?? new Date().toISOString(),
        is_current: false,
      });
    }),
    route('post', '/admin/rules/:version/freeze', ['admin'], ({ user, params }) => {
      const rules = db.rules.find((r) => r.rules_version === params.version);
      if (!rules) return problem('rules_version_unknown');
      rules.status = 'frozen';
      rules.frozen_at = new Date().toISOString();
      audit(db, user, 'rules_freeze', 'rules', params.version, 'Froze rules');
      return {
        rules_version: rules.rules_version,
        status: rules.status,
        checksum: rules.checksum,
        parent: rules.parent,
        frozen_at: rules.frozen_at,
        created_at: rules.created_at,
        is_current: rules.rules_version === db.settings.current_rules_version,
      };
    }),
    route('post', '/admin/rederive', ['admin'], ({ user, url }) => {
      const version = url.searchParams.get('rules_version')!;
      const cohort = url.searchParams.get('cohort')!;
      const rules = db.rules.find((r) => r.rules_version === version);
      if (!rules) return problem('rules_version_unknown');
      if (rules.status !== 'frozen') return problem('rules_not_frozen');
      audit(db, user, 'rederive', 'rules', version, `Re-derived ${cohort}`);
      return {
        rules_version: version,
        cohort,
        profiles_processed: db.participants.filter((p) => p.cohort === cohort).length,
      };
    }),
    route('get', '/admin/study/reference-readings', ['admin'], ({ url }) => {
      const code = url.searchParams.get('participant_code')!;
      if (!participant(code)) return problem('not_found');
      return db.readings.filter((r) => r.participant_code === code);
    }),
    route(
      'post',
      '/admin/study/reference-readings/:ref_id/corrections',
      ['admin'],
      ({ user, params, body }) => {
        const reading = db.readings.find((r) => r.ref_id === params.ref_id);
        if (!reading) return problem('not_found');
        reading.correction = {
          value_mm: body.value_mm,
          reason: body.reason,
          corrected_at: new Date().toISOString(),
        };
        audit(db, user, 'reference_correction', 'reference', reading.ref_id, 'Corrected a reading');
        return created(reading);
      },
    ),

    route('get', '/study/participants', ['admin'], () =>
      db.settings.study_mode ? db.participants : problem('study_mode_off'),
    ),
    route('post', '/study/participants', ['admin'], ({ user, body }) => {
      if (!db.settings.study_mode) return problem('study_mode_off');
      const client = db.clients.find(
        (c) => !db.participants.some((p) => p.client_code === c.client_code),
      );
      const row = {
        participant_id: newId(),
        participant_code: body.participant_code,
        client_code: client?.client_code ?? 'AB1001',
        sex: body.sex,
        age_band: body.age_band,
        venue: body.venue,
        cohort: 'pilot',
        enrolled_at: new Date().toISOString(),
        sets_captured: 0,
        readings_entered: 0,
      };
      db.participants.push(row);
      audit(
        db,
        user,
        'participant_create',
        'participant',
        row.participant_id,
        'Enrolled a participant',
      );
      return created(row);
    }),
    route('patch', '/study/participants/:participant_id', ['admin'], ({ user, params, body }) => {
      const row = db.participants.find((p) => p.participant_id === params.participant_id);
      if (!row) return problem('not_found');
      if (body.cohort && body.cohort !== row.cohort && row.readings_entered > 0)
        return problem('cohort_locked');
      Object.assign(row, body);
      audit(
        db,
        user,
        'participant_update',
        'participant',
        row.participant_id,
        'Changed a participant',
      );
      return row;
    }),
    route('post', '/study/reference-readings', ['measurer'], ({ user, body }) => {
      if (!db.settings.study_mode) return problem('study_mode_off');
      const row = participant(body.participant_code);
      if (!row) return problem('not_found');
      const taken = db.readings.some(
        (r) =>
          r.participant_code === body.participant_code &&
          r.measurer_code === user!.measurer_code &&
          r.reading_no === body.reading_no,
      );
      if (taken) return problem('reading_locked');
      const outOfOrder =
        body.reading_no === 2 &&
        !db.readings.some(
          (r) =>
            r.participant_code === body.participant_code &&
            r.measurer_code === user!.measurer_code &&
            r.reading_no === 1,
        );
      for (const [site, value] of Object.entries(body.values)) {
        db.readings.push({
          ref_id: newId(),
          participant_code: body.participant_code,
          measurer_code: user!.measurer_code,
          reading_no: body.reading_no,
          site_code: site,
          value_mm: value,
          taken_at: body.taken_at,
          out_of_order: outOfOrder,
          correction: null,
        });
      }
      row.readings_entered += 1;
      audit(db, user, 'reference_entry', 'participant', row.participant_id, 'Saved tape readings');
      return created({
        participant_code: body.participant_code,
        reading_no: body.reading_no,
        measurer_code: user!.measurer_code,
        out_of_order: outOfOrder,
      });
    }),
    route('get', '/study/reference-readings/mine', ['measurer'], ({ user, url }) => {
      const code = url.searchParams.get('participant_code');
      return db.readings
        .filter((r) => r.participant_code === code && r.measurer_code === user!.measurer_code)
        .map((r) => ({
          participant_code: r.participant_code,
          reading_no: r.reading_no,
          site_code: r.site_code,
          value_mm: r.value_mm,
          taken_at: r.taken_at,
        }));
    }),
    route('get', '/study/export/captures.csv', ['admin'], ({ user }) => {
      audit(db, user, 'export', 'study', 'captures.csv', 'Exported captures');
      return csv('participant_code,cohort,set_no\n');
    }),
    route('get', '/study/export/reference.csv', ['admin'], ({ user }) => {
      audit(db, user, 'export', 'study', 'reference.csv', 'Exported tape readings');
      const lines = db.readings.map((r) =>
        [r.participant_code, r.measurer_code, r.reading_no, r.site_code, r.value_mm].join(','),
      );
      return csv(
        ['participant_code,measurer_code,reading_no,site_code,value_mm', ...lines].join('\n'),
      );
    }),
  ];
}
