import React, { useState, useEffect } from 'react';
import { UserAccount } from '../../types/api';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Check, X, Shield, UserCheck, UserX, Plus } from 'lucide-react';

interface AdminAccountsViewProps {
  onNavigate: (path: string) => void;
}

export const AdminAccountsView: React.FC<AdminAccountsViewProps> = ({ onNavigate }) => {
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [tab, setTab] = useState<'pending' | 'active' | 'disabled'>('pending');
  const [loading, setLoading] = useState(true);

  const loadAccounts = async () => {
    setLoading(true);
    const list = await api.getAccounts();
    setAccounts(list);
    setLoading(false);
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const handleStatusChange = async (userId: string, newStatus: 'active' | 'disabled') => {
    await api.updateAccountStatus(userId, newStatus);
    loadAccounts();
  };

  const filtered = accounts.filter((a) => a.status === tab);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
            Account Management &amp; Approvals
          </h1>
          <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mt-0.5">
            Administer tailoring workshop registrations and validation study measurers
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[var(--vt-line,#DDD5C8)] pb-2">
        {(['pending', 'active', 'disabled'] as const).map((tName) => {
          const count = accounts.filter((a) => a.status === tName).length;
          return (
            <button
              key={tName}
              onClick={() => setTab(tName)}
              className={`px-4 py-2 rounded-xl text-xs font-bold capitalize transition-colors cursor-pointer ${
                tab === tName
                  ? 'bg-[var(--vt-thread,#2E3A87)] text-white'
                  : 'text-[var(--vt-ink-muted,#5C554C)] hover:bg-black/5'
              }`}
            >
              {tName} ({count})
            </button>
          );
        })}
      </div>

      {/* Accounts List */}
      <div className="rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white divide-y divide-[var(--vt-line,#DDD5C8)]/50 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-600">Loading accounts…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-600">No {tab} accounts found.</div>
        ) : (
          filtered.map((acc) => (
            <div
              key={acc.user_id}
              className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[#FAF8F5]"
            >
              <div>
                <div className="flex items-center gap-2.5 mb-1">
                  <span className="font-bold text-base text-[var(--vt-ink,#1F1C18)]">
                    {acc.business_name || acc.email}
                  </span>
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    {acc.role}
                  </span>
                </div>
                <div className="text-xs text-[var(--vt-ink-muted,#5C554C)] space-x-2">
                  <span>{acc.email}</span>
                  {acc.phone && <span>· {acc.phone}</span>}
                  {acc.area && <span>· {acc.area}</span>}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {acc.status === 'pending' && (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => handleStatusChange(acc.user_id, 'active')}
                      icon={<Check className="w-3.5 h-3.5" />}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleStatusChange(acc.user_id, 'disabled')}
                      icon={<X className="w-3.5 h-3.5" />}
                    >
                      Reject
                    </Button>
                  </>
                )}

                {acc.status === 'active' && acc.role !== 'admin' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleStatusChange(acc.user_id, 'disabled')}
                    className="text-rose-600 border-rose-200 hover:bg-rose-50"
                  >
                    Deactivate
                  </Button>
                )}

                {acc.status === 'disabled' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleStatusChange(acc.user_id, 'active')}
                  >
                    Re-enable
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
