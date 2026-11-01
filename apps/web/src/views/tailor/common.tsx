// What the tailor's screens share: contract types, loading, units and dates in Nairobi time.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '@vt/contracts';
import { ChevronLeft } from 'lucide-react';
import { readSessionUser } from '../../api/session';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n';
import { useTailorText } from './tailorText';

type Schemas = components['schemas'];
export type ClientSummary = Schemas['ClientSummary'];
export type ClientDetail = Schemas['ClientDetail'];
export type ClientClaim = Schemas['ClientClaim'];
export type ProfileSummary = Schemas['ProfileSummary'];
export type Profile = Schemas['MeasurementProfile'];
export type Order = Schemas['Order'];
export type OrderSummary = Schemas['OrderSummary'];
export type OrderItemInput = Schemas['OrderItemInput'];
export type OrderStatus = Schemas['OrderStatus'];
export type GarmentType = Schemas['GarmentType'];
export type SiteCode = Schemas['SiteCode'];
export type Conflict = Schemas['Conflict'];
export type AuditEntry = Schemas['AuditEntry'];
export type AuditAction = Schemas['AuditAction'];
export type EasePreset = Schemas['EasePreset'];
export type EaseSuggestion = Schemas['EaseSuggestion'];
export type Unit = 'cm' | 'in';

export const STATUSES: OrderStatus[] = ['new', 'cutting', 'fitting', 'ready', 'collected'];
export const GARMENTS: GarmentType[] = ['shirt', 'dress', 'trousers', 'suit_jacket', 'skirt', 'other'];
export const ALL_SITES: SiteCode[] = ['shoulder', 'chest', 'waist', 'hip', 'sleeve', 'outleg', 'inleg', 'neck'];
// Frontend-spec 13.6.
export const GARMENT_SITES: Record<GarmentType, SiteCode[]> = {
  shirt: ['shoulder', 'chest', 'waist', 'sleeve', 'neck'],
  dress: ['shoulder', 'chest', 'waist', 'hip', 'sleeve'],
  trousers: ['waist', 'hip', 'outleg', 'inleg'],
  suit_jacket: ['shoulder', 'chest', 'waist', 'hip', 'sleeve', 'neck'],
  skirt: ['waist', 'hip', 'outleg'],
  other: ALL_SITES,
};

const MM_PER_INCH = 25.4;

export const currentUnit = (): Unit => readSessionUser()?.unit_pref ?? 'cm';

export function formatLength(mm: number | null | undefined, unit: Unit): string {
  if (mm === null || mm === undefined) return '—';
  return unit === 'in' ? `${(mm / MM_PER_INCH).toFixed(1)} in` : `${(mm / 10).toFixed(1)} cm`;
}

export const toUnit = (mm: number, unit: Unit): number =>
  Number((unit === 'in' ? mm / MM_PER_INCH : mm / 10).toFixed(1));

export const toMm = (value: number, unit: Unit): number =>
  Math.round(unit === 'in' ? value * MM_PER_INCH : value * 10);

export function useDates() {
  const { locale } = useI18n();
  const tag = locale === 'sw' ? 'sw-KE' : 'en-KE';
  const zone = 'Africa/Nairobi';
  return {
    date: (value: string) =>
      new Date(value).toLocaleDateString(tag, { day: 'numeric', month: 'short', year: 'numeric', timeZone: zone }),
    time: (value: string | Date) =>
      new Date(value).toLocaleString(tag, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }),
  };
}

/** Today in Nairobi, as the server decides due dates. */
export function nairobiToday(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
}

export function addDays(day: string, days: number): string {
  const moved = new Date(`${day}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** Keeps what was last loaded on screen if a reload fails, as frontend-spec 13 asks. */
export function useLoad<T>(load: () => Promise<T>, keys: React.DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const latest = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    const turn = ++latest.current;
    try {
      const next = await load();
      if (turn !== latest.current) return;
      setData(next);
      setFailed(false);
      setUpdatedAt(new Date());
    } catch {
      if (turn === latest.current) setFailed(true);
    }
  }, keys);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, setData, failed, reload, updatedAt };
}

export const Loading: React.FC<{
  failed: boolean;
  onRetry: () => void;
}> = ({ failed, onRetry }) => {
  const tx = useTailorText();
  return failed ? (
    <div role="alert" className="p-8 text-center text-sm">
      <p className="mb-3">{tx('loadFailed')}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {tx('tryAgain')}
      </Button>
    </div>
  ) : (
    <div role="status" className="p-8 text-center text-sm text-[var(--vt-ink-muted)]">
      {tx('loading')}
    </div>
  );
};

/** A reload failed, so the list below is older than it looks. */
export const StaleNote: React.FC<{ failed: boolean; updatedAt: Date | null }> = ({ failed, updatedAt }) => {
  const tx = useTailorText();
  const { time } = useDates();
  if (!failed || !updatedAt) return null;
  return (
    <p role="status" className="text-xs text-[var(--vt-ink-muted)]">
      {tx('lastUpdated', { time: time(updatedAt) })}
    </p>
  );
};

export const BackLink: React.FC<{ onClick: () => void; label: string }> = ({ onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    className="min-h-[48px] text-sm text-[var(--vt-ink-muted)] hover:text-[var(--vt-ink)] flex items-center gap-1 self-start cursor-pointer"
  >
    <ChevronLeft aria-hidden="true" className="w-4 h-4" />
    <span>{label}</span>
  </button>
);

export const Title: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink)] tracking-tight">{children}</h1>
);

export const Card: React.FC<{ title?: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="p-4 sm:p-5 rounded-2xl border border-[var(--vt-line)] bg-white flex flex-col gap-3">
    {title && <h2 className="text-sm font-bold text-[var(--vt-ink)]">{title}</h2>}
    {children}
  </section>
);

export const inputClass =
  'w-full min-h-[48px] px-3 rounded-xl border border-[var(--vt-line)] bg-white text-sm outline-none focus:border-[var(--vt-thread)]';
export const labelClass = 'text-sm font-semibold text-[var(--vt-ink)] block mb-1';
export const hintClass = 'text-xs text-[var(--vt-ink-muted)]';
export const rowClass =
  'w-full text-left p-4 rounded-xl border border-[var(--vt-line)] bg-white hover:border-[var(--vt-thread)] cursor-pointer flex items-center justify-between gap-3 min-h-[48px]';
export const chipClass = (active: boolean) =>
  `px-3 min-h-[48px] rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer ${
    active
      ? 'bg-[var(--vt-thread)] text-white'
      : 'bg-white border border-[var(--vt-line)] text-[var(--vt-ink-muted)]'
  }`;

// Sunlight mode: the phone's preference, read before the tailor's screens draw (M9).
const SUNLIGHT_KEY = 'vt_sunlight';
export function readSunlight(): boolean {
  try {
    return localStorage.getItem(SUNLIGHT_KEY) === '1';
  } catch {
    return false;
  }
}
export function applySunlight(on: boolean, remember = false): void {
  if (on) document.documentElement.dataset.contrast = 'high';
  else delete document.documentElement.dataset.contrast;
  if (!remember) return;
  try {
    localStorage.setItem(SUNLIGHT_KEY, on ? '1' : '0');
  } catch {
    // Only a preference: it still applies until the page closes.
  }
}
