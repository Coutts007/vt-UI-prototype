// The route map (frontend-spec 7.1). Pure data and matching, so it is easy to test.
export type Role = 'tailor' | 'admin' | 'measurer';
export type Area = 'client' | 'auth' | 'tailor' | 'admin' | 'study' | 'dev';

export interface RouteDef {
  pattern: string;
  area: Area;
  roles?: Role[];
  study?: boolean;
  devOnly?: boolean;
  fullscreen?: boolean;
}

export const ROUTES: RouteDef[] = [
  { pattern: '/', area: 'client' },
  { pattern: '/start', area: 'client' },
  { pattern: '/consent', area: 'client' },
  { pattern: '/check', area: 'client' },
  { pattern: '/sheet', area: 'client' },
  { pattern: '/setup', area: 'client' },
  { pattern: '/capture/front', area: 'client', fullscreen: true },
  { pattern: '/capture/side', area: 'client', fullscreen: true },
  { pattern: '/processing', area: 'client' },
  { pattern: '/review', area: 'client' },
  { pattern: '/saved', area: 'client' },
  { pattern: '/me', area: 'client' },
  { pattern: '/me/:profileId', area: 'client' },
  { pattern: '/help', area: 'client' },
  { pattern: '/privacy', area: 'client' },
  { pattern: '/declined', area: 'client' },
  { pattern: '/login', area: 'auth' },
  { pattern: '/register', area: 'auth' },
  { pattern: '/register/pending', area: 'auth' },
  { pattern: '/t/clients', area: 'tailor', roles: ['tailor'] },
  { pattern: '/t/clients/new', area: 'tailor', roles: ['tailor'] },
  { pattern: '/t/clients/:clientId', area: 'tailor', roles: ['tailor'] },
  { pattern: '/t/clients/:clientId/profiles/:profileId', area: 'tailor', roles: ['tailor'] },
  { pattern: '/t/orders', area: 'tailor', roles: ['tailor'] },
  { pattern: '/t/orders/new', area: 'tailor', roles: ['tailor'] },
  { pattern: '/t/orders/:orderId', area: 'tailor', roles: ['tailor'] },
  { pattern: '/t/orders/:orderId/sheet', area: 'tailor', roles: ['tailor'] },
  { pattern: '/t/conflicts', area: 'tailor', roles: ['tailor'] },
  { pattern: '/t/audit', area: 'tailor', roles: ['tailor'] },
  { pattern: '/t/settings', area: 'tailor', roles: ['tailor'] },
  { pattern: '/admin/accounts', area: 'admin', roles: ['admin'] },
  { pattern: '/admin/audit', area: 'admin', roles: ['admin'] },
  { pattern: '/admin/settings', area: 'admin', roles: ['admin'] },
  { pattern: '/admin/study/participants', area: 'admin', roles: ['admin'], study: true },
  { pattern: '/admin/study/measurers', area: 'admin', roles: ['admin'], study: true },
  { pattern: '/admin/study/export', area: 'admin', roles: ['admin'], study: true },
  { pattern: '/study/capture', area: 'study', roles: ['admin'], study: true },
  { pattern: '/study/reference', area: 'study', roles: ['measurer'], study: true },
  { pattern: '/dev/ui', area: 'dev', devOnly: true },
  { pattern: '/dev/capture-tuning', area: 'dev', devOnly: true },
];

export interface RouteMatch {
  route: RouteDef;
  params: Record<string, string>;
}

/** Exact segments win over :params, so /t/clients/new is never read as a client id. */
export function matchRoute(pathname: string, routes: RouteDef[] = ROUTES): RouteMatch | null {
  const parts = pathname.split('/').filter(Boolean);
  let best: RouteMatch | null = null;
  let bestScore = -1;
  for (const route of routes) {
    const pieces = route.pattern.split('/').filter(Boolean);
    if (pieces.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let score = 0;
    const fits = pieces.every((piece, i) => {
      if (piece.startsWith(':')) {
        try {
          params[piece.slice(1)] = decodeURIComponent(parts[i]);
        } catch {
          return false;
        }
        return true;
      }
      score += 1;
      return piece === parts[i];
    });
    if (fits && score > bestScore) {
      best = { route, params };
      bestScore = score;
    }
  }
  return best;
}

export interface GuardUser {
  role: Role;
  status: string;
}

export type GuardResult = 'ok' | 'login' | 'forbidden' | 'pending' | 'disabled' | 'not-found';

export function guard(
  match: RouteMatch | null,
  user: GuardUser | null,
  context: { studyMode: boolean; dev: boolean },
): GuardResult {
  if (!match) return 'not-found';
  const { route } = match;
  if (route.devOnly && !context.dev) return 'not-found';
  if (route.study && !context.studyMode) return 'not-found';
  if (!route.roles) return 'ok';
  if (!user) return 'login';
  if (user.status === 'pending') return 'pending';
  if (user.status !== 'active') return 'disabled';
  return route.roles.includes(user.role) ? 'ok' : 'forbidden';
}

/** Returns a same-site path to go to after login, or null if `next` points elsewhere. */
export function safeNext(next: string | null, origin: string): string | null {
  if (!next?.startsWith('/') || next.startsWith('//')) return null;
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin || url.pathname.startsWith('//')) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

export function homeFor(role: Role): string {
  if (role === 'tailor') return '/t/orders';
  if (role === 'admin') return '/admin/accounts';
  return '/study/reference';
}
