import React, { useState, useEffect } from 'react';
import { AuditEntry } from '../../types/api';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Download, History, Filter, Search } from 'lucide-react';

interface AdminAuditViewProps {
  onNavigate: (path: string) => void;
}

export const AdminAuditView: React.FC<AdminAuditViewProps> = ({ onNavigate }) => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAuditEntries().then((list) => {
      setEntries(list);
      setLoading(false);
    });
  }, []);

  const handleExportCsv = () => {
    const headers = ['log_id', 'occurred_at', 'user_email', 'role', 'action', 'entity_type', 'summary'];
    const rows = entries.map((e) =>
      [e.log_id, e.occurred_at, e.user_email, e.role, e.action, e.entity_type, `"${e.summary.replace(/"/g, '""')}"`].join(',')
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encoded = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encoded);
    link.setAttribute('download', `vt_audit_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filtered = entries.filter((e) =>
    search.trim() ? e.summary.toLowerCase().includes(search.toLowerCase()) || e.user_email.toLowerCase().includes(search.toLowerCase()) : true
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
            System Audit Trail
          </h1>
          <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mt-0.5">
            Complete compliance event log under Kenya Data Protection Act 2019
          </p>
        </div>

        <Button
          onClick={handleExportCsv}
          icon={<Download className="w-4 h-4" />}
          size="md"
        >
          Export Audit CSV
        </Button>
      </div>

      {/* Search Input */}
      <div className="relative w-full">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter audit entries by user or description…"
          className="w-full h-11 pl-10 pr-4 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white text-sm outline-none"
        />
      </div>

      {/* Audit Log Table */}
      <div className="rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white divide-y divide-[var(--vt-line,#DDD5C8)]/50 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading audit records…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">No records match the filter.</div>
        ) : (
          filtered.map((item) => (
            <div key={item.log_id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[#FAF8F5]">
              <div>
                <span className="text-sm font-semibold text-[var(--vt-ink,#1F1C18)] block">
                  {item.summary}
                </span>
                <span className="text-xs text-[var(--vt-ink-muted,#5C554C)]">
                  {item.user_email} · Role: {item.role} · Action: {item.action}
                </span>
              </div>
              <span className="text-xs font-mono text-[var(--vt-ink-muted,#5C554C)] shrink-0">
                {new Date(item.occurred_at).toLocaleString('en-KE')}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
