import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n';
import { ClientRecord } from '../../types/api';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Search, Plus, User, AlertTriangle, Layers, ChevronRight, RefreshCw } from 'lucide-react';

interface ClientListViewProps {
  onNavigate: (path: string) => void;
}

export const ClientListView: React.FC<ClientListViewProps> = ({ onNavigate }) => {
  const { t } = useI18n();

  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'flags' | 'conflicts' | 'no_measurements'>('all');
  const [loading, setLoading] = useState(true);

  const fetchClients = async () => {
    setLoading(true);
    try {
      const data = await api.getClients(search, filter);
      setClients(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, [search, filter]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
            {t('clientList')}
          </h1>
          <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mt-0.5">
            Manage your tailoring clients, issued codes, and body measurement profiles
          </p>
        </div>

        <Button
          onClick={() => onNavigate('/t/clients/new')}
          icon={<Plus className="w-4 h-4" />}
          size="md"
        >
          {t('issueNewCode')}
        </Button>
      </div>

      {/* Search & Filter Strip */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-600 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code (e.g. AB1234) or client name…"
            className="w-full h-12 pl-10 pr-4 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white text-sm outline-none focus:border-[var(--vt-thread,#2E3A87)]"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          {[
            { id: 'all', label: 'All Clients' },
            { id: 'flags', label: 'Has Flags' },
            { id: 'conflicts', label: 'Conflicts' },
            { id: 'no_measurements', label: 'No Profiles' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                filter === f.id
                  ? 'bg-[var(--vt-thread,#2E3A87)] text-white shadow-2xs'
                  : 'bg-white border border-[var(--vt-line,#DDD5C8)] text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Clients Table / Cards */}
      {loading ? (
        <div className="p-12 text-center text-sm text-slate-600">Loading clients…</div>
      ) : clients.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white">
          <User className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <h2 className="text-base font-bold text-[var(--vt-ink,#1F1C18)] mb-1">No clients found</h2>
          <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] mb-6">
            Issue a client code and send it on WhatsApp to get started.
          </p>
          <Button onClick={() => onNavigate('/t/clients/new')} size="sm">
            {t('issueNewCode')}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {clients.map((c) => (
            <div
              key={c.client_id}
              onClick={() => onNavigate(`/t/clients/${c.client_id}`)}
              className="p-4 sm:p-5 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white hover:border-[var(--vt-thread,#2E3A87)] transition-all cursor-pointer flex items-center justify-between shadow-2xs group"
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                <div>
                  <span className="font-mono font-bold text-lg text-[var(--vt-thread,#2E3A87)]">
                    {c.client_code}
                  </span>
                  <span className="text-sm font-semibold text-[var(--vt-ink,#1F1C18)] block sm:inline sm:ml-3">
                    {c.display_name || '— (Anonymous)'}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs text-[var(--vt-ink-muted,#5C554C)]">
                  <span>
                    Profiles: <strong>{c.profiles_count}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    Active orders: <strong>{c.open_orders_count}</strong>
                  </span>
                  {c.has_flags && (
                    <span className="inline-flex items-center gap-1 text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      <AlertTriangle className="w-3 h-3" />
                      Flags
                    </span>
                  )}
                  {c.sync_conflict && (
                    <span className="inline-flex items-center gap-1 text-sky-700 font-semibold bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                      <RefreshCw className="w-3 h-3" />
                      Conflict
                    </span>
                  )}
                </div>
              </div>

              <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-[var(--vt-thread,#2E3A87)] transition-colors shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
