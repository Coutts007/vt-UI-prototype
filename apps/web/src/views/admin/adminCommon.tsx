// What the admin and study screens share: contract types, loading, CSV saving and error words.
import React from 'react';
import type { components } from '@vt/contracts';
import { ApiError } from '../../api/http';
import { Button } from '../../components/ui/Button';
import { AdminKey, useAdminText } from './adminText';

type Schemas = components['schemas'];
export type Account = Schemas['Account'];
export type AccountStatus = Schemas['AccountStatus'];
export type AdminSettings = Schemas['AdminSettings'];
export type Approvals = Schemas['Approvals'];
export type DeletionRequest = Schemas['DeletionRequest'];
export type Participant = Schemas['Participant'];
export type SiteValues = Schemas['SiteValues'];
export type Cohort = Schemas['Cohort'];

/** Appendix C order, the order the measurer reads the tape in. */
export const TAPE_SITES: (keyof SiteValues)[] = [
  'stature', 'shoulder', 'chest', 'waist', 'hip', 'sleeve', 'outleg', 'inleg', 'neck',
];

/** The word for an error code the admin and study screens can meet. */
export function problemKey(problem: unknown): AdminKey {
  const code = problem instanceof ApiError ? problem.code : '';
  if (code === 'approvals_missing') return 'errApprovals';
  if (code === 'study_mode_off') return 'errStudyOff';
  if (code === 'consent_missing') return 'errWithdrawn';
  if (code === 'reading_locked') return 'readingLocked';
  if (code === 'cohort_locked') return 'cohortLocked';
  if (code === 'validation_failed') return 'errInvalid';
  return 'saveFailed';
}

/** The server says a value is already used (422 with an error of code "taken"). */
export function isTaken(problem: unknown): boolean {
  if (!(problem instanceof ApiError) || problem.code !== 'validation_failed') return false;
  const errors = problem.problem.errors;
  return Array.isArray(errors) && errors.some((item) => (item as { code?: string }).code === 'taken');
}

export function saveText(text: string, name: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export const AdminLoading: React.FC<{ failed: boolean; onRetry: () => void }> = ({ failed, onRetry }) => {
  const ax = useAdminText();
  return failed ? (
    <div role="alert" className="p-8 text-center text-sm">
      <p className="mb-3">{ax('loadFailed')}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {ax('tryAgain')}
      </Button>
    </div>
  ) : (
    <div role="status" className="p-8 text-center text-sm text-[var(--vt-ink-muted)]">
      {ax('loading')}
    </div>
  );
};

/** A9: what is missing, shown on every study screen while collection is blocked. */
export const ApprovalsBanner: React.FC<{ missing: string[] }> = ({ missing }) => {
  const ax = useAdminText();
  if (missing.length === 0) return null;
  return (
    <p role="alert" className="p-3 rounded-xl border border-amber-300 bg-amber-50 text-sm text-amber-900">
      {ax('approvalsBanner', { fields: missing.join(', ') })}
    </p>
  );
};

export const Page: React.FC<{ title: string; intro?: string; children: React.ReactNode }> = ({
  title,
  intro,
  children,
}) => (
  <main className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-5">
    <div>
      <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink)] tracking-tight">{title}</h1>
      {intro && <p className="text-sm text-[var(--vt-ink-muted)] mt-1">{intro}</p>}
    </div>
    {children}
  </main>
);
