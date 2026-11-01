// In-memory copy of packages/seed/seed.json, the single demo seed. Used only in dev and tests.
import seed from '../../../packages/seed/seed.json';

type Row = Record<string, any>;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;
const DAY_MS = 86_400_000;

/** Move every date by (today - anchor_date), so the one overdue order stays overdue. */
export function shiftDates<T>(value: T, days: number): T {
  if (typeof value === 'string') {
    if (DATE_ONLY.test(value)) {
      return new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY_MS)
        .toISOString()
        .slice(0, 10) as T;
    }
    if (DATE_TIME.test(value)) {
      return new Date(Date.parse(value) + days * DAY_MS).toISOString().replace('.000Z', 'Z') as T;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => shiftDates(item, days)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, shiftDates(item, days)]),
    ) as T;
  }
  return value;
}

export interface MockDb {
  today: string;
  users: Row[];
  clients: Row[];
  listings: Row[];
  profiles: Row[];
  conflicts: Row[];
  orders: Row[];
  easePresets: Record<string, Row[]>;
  audit: Row[];
  participants: Row[];
  readings: Row[];
  deletionRequests: Row[];
  clientSecrets: Record<string, string>;
  settings: Row;
  rules: Row[];
  sheets: Row[];
  passwords: Record<string, string>;
}

export function createDb(rulesArtifact: Row, now = new Date()): MockDb {
  const anchor = Date.parse(`${seed.anchor_date}T00:00:00Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const data = shiftDates(
    structuredClone(seed) as unknown as Row,
    Math.round((today - anchor) / DAY_MS),
  );
  const users: Row[] = data.users;
  return {
    today: now.toISOString().slice(0, 10),
    users,
    clients: data.clients,
    listings: data.directory_listings,
    profiles: data.profiles,
    conflicts: data.conflicts,
    orders: data.orders,
    easePresets: Object.fromEntries(data.ease_presets.map((p: Row) => [p.tailor_id, p.presets])),
    audit: data.audit,
    participants: data.participants,
    readings: data.reference_readings,
    deletionRequests: data.deletion_requests,
    clientSecrets: {},
    settings: data.settings,
    rules: [{ ...rulesArtifact }],
    sheets: [],
    passwords: Object.fromEntries(users.map((u) => [u.email, data.demo_password])),
  };
}
