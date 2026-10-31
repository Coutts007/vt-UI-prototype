import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n';
import { AuditEntry } from '../../types/api';
import { api } from '../../api/client';
import { History, Shield, Filter } from 'lucide-react';

interface AuditViewProps {
  onNavigate: (path: string) => void;
}

export const AuditView: React.FC<AuditViewProps> = ({ onNavigate }) => {
  const { t } = useI18n();

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filterAction, setFilterAction] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAuditEntries().then((list) => {
      setEntries(list);
      setLoading(false);
    });
  }, []);

  const filtered = entries.filter((e) =>
    filterAction === 'all' ? true : e.action === filterAction
  );

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
          {t('dashboardAudit')}
        </h1>
        <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mt-0.5">
          Immutable audit trail of all profile views, manual overrides, code issuances, and shares
        </p>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {[
          { id: 'all', label: 'All Actions' },
          { id: 'override', label: 'Overrides' },
          { id: 'profile_view', label: 'Profile Views' },
          { id: 'status_change', label: 'Order Status' },
          { id: 'code_issue', label: 'Code Issuances' },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilterAction(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
              filterAction === f.id
                ? 'bg-[var(--vt-thread,#2E3A87)] text-white shadow-2xs'
                : 'bg-white border border-[var(--vt-line,#DDD5C8)] text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Entries List */}
      <div className="rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white divide-y divide-[var(--vt-line,#DDD5C8)]/50 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-600">Loading audit records…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-600">No audit entries found.</div>
        ) : (
          filtered.map((item) => (
            <div key={item.log_id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[#FAF8F5]">
              <div>
                <span className="text-sm font-semibold text-[var(--vt-ink,#1F1C18)] block">
                  {item.summary}
                </span>
                <span className="text-xs text-[var(--vt-ink-muted,#5C554C)]">
                  User: {item.user_email} · Entity: {item.entity_type}
                </span>
              </div>

              <span className="text-xs font-mono text-[var(--vt-ink-muted,#5C554C)] shrink-0">
                {new Date(item.occurred_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })} · {new Date(item.occurred_at).toLocaleDateString('en-KE')}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
