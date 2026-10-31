import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n';
import { Order, OrderStatus } from '../../types/api';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { FlagBadge } from '../../components/ui/FlagBadge';
import {
  ClipboardList,
  Plus,
  Calendar,
  AlertTriangle,
  ChevronRight,
  FileText,
  Clock,
} from 'lucide-react';

interface OrderQueueViewProps {
  onNavigate: (path: string) => void;
}

export const OrderQueueView: React.FC<OrderQueueViewProps> = ({ onNavigate }) => {
  const { t } = useI18n();

  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<OrderStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const data = await api.getOrders(activeTab === 'all' ? undefined : activeTab);
      setOrders(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [activeTab]);

  const statuses: { id: OrderStatus | 'all'; label: string }[] = [
    { id: 'all', label: 'All Orders' },
    { id: 'new', label: 'New' },
    { id: 'cutting', label: 'Cutting' },
    { id: 'fitting', label: 'Fitting' },
    { id: 'ready', label: 'Ready' },
    { id: 'collected', label: 'Collected' },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
            {t('orderQueue')}
          </h1>
          <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mt-0.5">
            Track garment production from measurement intake to collection
          </p>
        </div>

        <Button
          onClick={() => onNavigate('/t/orders/new')}
          icon={<Plus className="w-4 h-4" />}
          size="md"
        >
          {t('newOrder')}
        </Button>
      </div>

      {/* Status Segmented Filter Chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {statuses.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveTab(s.id)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
              activeTab === s.id
                ? 'bg-[var(--vt-thread,#2E3A87)] text-white shadow-2xs'
                : 'bg-white border border-[var(--vt-line,#DDD5C8)] text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)]'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="p-12 text-center text-sm text-slate-600">Loading orders queue…</div>
      ) : orders.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white">
          <ClipboardList className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <h2 className="text-base font-bold text-[var(--vt-ink,#1F1C18)] mb-1">
            No orders in this stage
          </h2>
          <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] mb-6">
            Create an order from a client profile to begin cutting and tailoring.
          </p>
          <Button onClick={() => onNavigate('/t/orders/new')} size="sm">
            {t('newOrder')}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5">
          {orders.map((ord) => {
            const isOverdue = new Date(ord.due_date) < new Date() && ord.status !== 'collected';
            const hasFlag = ord.items.some((i) => i.confidence_flag !== 'pass');

            return (
              <div
                key={ord.order_id}
                onClick={() => onNavigate(`/t/orders/${ord.order_id}`)}
                className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white hover:border-[var(--vt-thread,#2E3A87)] transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs group"
              >
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-mono font-bold text-base text-[var(--vt-thread,#2E3A87)]">
                      {ord.order_no}
                    </span>
                    <span className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] capitalize">
                      {ord.garment_type.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-[var(--vt-ink-muted,#5C554C)]">
                      · {ord.client_code} ({ord.display_name || 'Anonymous'})
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--vt-ink-muted,#5C554C)]">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-600" />
                      <span>Due: {ord.due_date}</span>
                    </span>

                    {isOverdue && (
                      <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded font-bold border border-rose-200">
                        Overdue
                      </span>
                    )}

                    {hasFlag && (
                      <span className="text-amber-800 bg-amber-50 px-2 py-0.5 rounded font-semibold border border-amber-200 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        1 Flagged Site
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center">
                  <span className="text-xs uppercase font-bold tracking-wider px-3 py-1 rounded-lg bg-[#FAF8F5] border border-[var(--vt-line,#DDD5C8)] text-[var(--vt-ink,#1F1C18)]">
                    {ord.status}
                  </span>
                  <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-[var(--vt-thread,#2E3A87)] transition-colors" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
