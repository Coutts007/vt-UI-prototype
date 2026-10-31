import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n';
import { ClientRecord, MeasurementProfile, Order } from '../../types/api';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { SyncBadge } from '../../components/ui/SyncBadge';
import { FlagBadge } from '../../components/ui/FlagBadge';
import {
  ChevronLeft,
  Ruler,
  Plus,
  Layers,
  ClipboardList,
  ChevronRight,
  AlertTriangle,
  Trash2,
} from 'lucide-react';

interface ClientDetailViewProps {
  clientId: string;
  onNavigate: (path: string) => void;
}

export const ClientDetailView: React.FC<ClientDetailViewProps> = ({ clientId, onNavigate }) => {
  const { t } = useI18n();

  const [client, setClient] = useState<ClientRecord | null>(null);
  const [profiles, setProfiles] = useState<MeasurementProfile[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [clientId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const c = await api.getClientById(clientId);
      if (c) {
        setClient(c);
        const [profList, ordList] = await Promise.all([
          api.getProfilesForClient(c.client_code),
          api.getOrders(),
        ]);
        setProfiles(profList);
        setOrders(ordList.filter((o) => o.client_id === c.client_id));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  if (loading || !client) {
    return <div className="p-8 text-center text-sm text-slate-400">Loading client details…</div>;
  }

  const latestProfile = profiles[0];

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      <button
        onClick={() => onNavigate('/t/clients')}
        className="text-xs text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)] flex items-center gap-1 cursor-pointer font-medium"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>All clients</span>
      </button>

      {/* Header Info Card */}
      <div className="p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="font-mono font-black text-2xl text-[var(--vt-thread,#2E3A87)]">
              {client.client_code}
            </span>
            <span className="text-base font-bold text-[var(--vt-ink,#1F1C18)]">
              {client.display_name || '— (Anonymous Customer)'}
            </span>
          </div>

          <div className="text-xs text-[var(--vt-ink-muted,#5C554C)] flex items-center gap-2">
            <span>Created {new Date(client.created_at).toLocaleDateString('en-KE')}</span>
            {client.height_mm && (
              <>
                <span>·</span>
                <span>Height: {client.height_mm / 10} cm</span>
              </>
            )}
          </div>
        </div>

        {latestProfile && (
          <Button
            size="md"
            onClick={() => onNavigate(`/t/orders/new?profileId=${latestProfile.profile_id}`)}
            icon={<Plus className="w-4 h-4" />}
          >
            New order from profile
          </Button>
        )}
      </div>

      {/* Profiles History */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)]">
            Measurement Profiles ({profiles.length})
          </h2>
        </div>

        {profiles.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white text-xs text-[var(--vt-ink-muted,#5C554C)]">
            No measurements received yet. Client has been issued code {client.client_code}.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {profiles.map((p) => {
              const passCount = p.measurements.filter((m) => m.confidence_flag === 'pass').length;
              const checkCount = p.measurements.filter((m) => m.confidence_flag === 'check').length;

              return (
                <div
                  key={p.profile_id}
                  onClick={() => onNavigate(`/t/clients/${client.client_id}/profiles/${p.profile_id}`)}
                  className="p-4 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white hover:border-[var(--vt-thread,#2E3A87)] transition-all cursor-pointer flex items-center justify-between shadow-2xs group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 text-[var(--vt-thread,#2E3A87)] flex items-center justify-center font-bold text-sm">
                      v{p.version}
                    </div>

                    <div>
                      <span className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] block">
                        Captured {new Date(p.captured_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-xs text-[var(--vt-ink-muted,#5C554C)]">
                        Mode: {p.session.capture_mode} · {passCount} passed{checkCount > 0 ? ` · ${checkCount} check` : ''}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <SyncBadge status={p.sync_status} />
                    <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-[var(--vt-thread,#2E3A87)]" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Orders for this Client */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)]">
          Orders ({orders.length})
        </h2>

        {orders.length === 0 ? (
          <div className="p-6 text-center rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white text-xs text-[var(--vt-ink-muted,#5C554C)]">
            No orders created for this client yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5">
            {orders.map((ord) => (
              <div
                key={ord.order_id}
                onClick={() => onNavigate(`/t/orders/${ord.order_id}`)}
                className="p-4 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white hover:border-[var(--vt-thread,#2E3A87)] transition-all cursor-pointer flex items-center justify-between shadow-2xs"
              >
                <div>
                  <span className="font-mono font-bold text-sm text-[var(--vt-thread,#2E3A87)]">
                    {ord.order_no}
                  </span>
                  <span className="text-sm font-semibold capitalize text-[var(--vt-ink,#1F1C18)] ml-2">
                    {ord.garment_type.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] block mt-0.5">
                    Due: {ord.due_date} · Status: <strong>{ord.status.toUpperCase()}</strong>
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
