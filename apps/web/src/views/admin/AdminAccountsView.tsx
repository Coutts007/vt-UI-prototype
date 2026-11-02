// Accounts (frontend-spec 14.1): approve new tailors, reject with a reason the server never stores.
import React, { useState } from 'react';
import { Check, X } from 'lucide-react';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { chipClass, inputClass, useDates, useLoad } from '../tailor/common';
import { Account, AccountStatus, AdminLoading, Page, problemKey } from './adminCommon';
import { AdminKey, useAdminText } from './adminText';

const TABS: { status: AccountStatus; label: AdminKey }[] = [
  { status: 'pending', label: 'tabPending' },
  { status: 'active', label: 'tabActive' },
  { status: 'disabled', label: 'tabDisabled' },
  { status: 'rejected', label: 'tabRejected' },
];
const ROLE: Record<Account['role'], AdminKey> = { tailor: 'roleTailor', admin: 'roleAdmin', measurer: 'roleMeasurer' };

export const AdminAccountsView: React.FC<{ onNavigate: (path: string) => void }> = () => {
  const ax = useAdminText();
  const { date } = useDates();
  const [tab, setTab] = useState<AccountStatus>('pending');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<AdminKey | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, failed, reload } = useLoad(
    () => apiClient.get('/admin/accounts', { query: { status: tab, page_size: 100 } }),
    [tab],
  );

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setRejecting(null);
      setReason('');
    } catch (problem) {
      setError(problemKey(problem));
    } finally {
      setBusy(false);
      void reload();
    }
  };
  const path = (account: Account) => ({ path: { user_id: account.user_id } });
  const approveAll = () =>
    act(async () => {
      for (const account of data?.items ?? []) await apiClient.post('/admin/accounts/{user_id}/approve', path(account));
    });

  return (
    <Page title={ax('accountsTitle')} intro={ax('accountsIntro')}>
      <div role="tablist" className="flex flex-wrap gap-2">
        {TABS.map(({ status, label }) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={tab === status}
            className={chipClass(tab === status)}
            onClick={() => setTab(status)}
          >
            {ax(label)}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {ax(error)}
        </p>
      )}
      {!data ? (
        <AdminLoading failed={failed} onRetry={() => void reload()} />
      ) : data.items.length === 0 ? (
        <p className="p-6 text-center text-sm text-[var(--vt-ink-muted)]">{ax('accountsEmpty')}</p>
      ) : (
        <>
          {tab === 'pending' && data.items.length > 1 && (
            <Button size="sm" disabled={busy} onClick={() => void approveAll()} icon={<Check className="w-4 h-4" />}>
              {ax('approveAll')}
            </Button>
          )}
          <ul className="rounded-2xl border border-[var(--vt-line)] bg-white divide-y divide-[var(--vt-line)]">
            {data.items.map((account) => (
              <li key={account.user_id} className="p-4 flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-[var(--vt-ink)]">
                      {account.business_name || account.email}{' '}
                      <span className="text-xs font-semibold text-[var(--vt-ink-muted)]">
                        {ax(ROLE[account.role])}
                        {account.measurer_code ? ` ${account.measurer_code}` : ''}
                      </span>
                    </p>
                    <p className="text-xs text-[var(--vt-ink-muted)]">
                      {[account.email, account.phone, account.area].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-xs text-[var(--vt-ink-muted)]">
                      {ax('registered', { date: date(account.created_at) })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {account.status === 'pending' && (
                      <>
                        <Button
                          size="sm"
                          disabled={busy}
                          icon={<Check className="w-4 h-4" />}
                          onClick={() => void act(() => apiClient.post('/admin/accounts/{user_id}/approve', path(account)))}
                        >
                          {ax('approve')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          icon={<X className="w-4 h-4" />}
                          onClick={() => setRejecting(account.user_id)}
                        >
                          {ax('reject')}
                        </Button>
                      </>
                    )}
                    {account.status === 'active' && account.role !== 'admin' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void act(() => apiClient.post('/admin/accounts/{user_id}/disable', path(account)))}
                      >
                        {ax('disable')}
                      </Button>
                    )}
                    {account.status === 'disabled' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void act(() => apiClient.post('/admin/accounts/{user_id}/enable', path(account)))}
                      >
                        {ax('enable')}
                      </Button>
                    )}
                  </div>
                </div>
                {rejecting === account.user_id && (
                  <form
                    className="flex flex-col sm:flex-row gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void act(() =>
                        apiClient.post('/admin/accounts/{user_id}/reject', { ...path(account), body: { reason } }),
                      );
                    }}
                  >
                    <label className="sr-only" htmlFor={`reason-${account.user_id}`}>
                      {ax('rejectReason')}
                    </label>
                    <input
                      id={`reason-${account.user_id}`}
                      className={inputClass}
                      value={reason}
                      maxLength={256}
                      required
                      placeholder={ax('rejectReason')}
                      onChange={(event) => setReason(event.target.value)}
                    />
                    <Button size="sm" variant="danger" type="submit" disabled={busy || !reason.trim()}>
                      {ax('reject')}
                    </Button>
                    <Button size="sm" variant="text" type="button" onClick={() => setRejecting(null)}>
                      {ax('cancel')}
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  );
};
