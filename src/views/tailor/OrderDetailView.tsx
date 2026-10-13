import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n';
import { Order, OrderStatus } from '../../types/api';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { FlagBadge } from '../../components/ui/FlagBadge';
import {
  ChevronLeft,
  FileText,
  Calendar,
  Clock,
  CheckCircle2,
  Share2,
} from 'lucide-react';

interface OrderDetailViewProps {
  orderId: string;
  onNavigate: (path: string) => void;
}

export const OrderDetailView: React.FC<OrderDetailViewProps> = ({
  orderId,
  onNavigate,
}) => {
  const { t } = useI18n();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOrder();
  }, [orderId]);

  const loadOrder = async () => {
    setLoading(true);
    try {
      const data = await api.getOrderById(orderId);
      setOrder(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (newStatus: OrderStatus) => {
    if (!order) return;
    try {
      const updated = await api.updateOrderStatus(order.order_id, newStatus);
      setOrder(updated);
    } catch {
      // ignore
    }
  };

  if (loading || !order) {
    return <div className="p-8 text-center text-sm text-slate-400">Loading order details…</div>;
  }

  const statusSteps: OrderStatus[] = ['new', 'cutting', 'fitting', 'ready', 'collected'];
  const currentStepIdx = statusSteps.indexOf(order.status);

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto pb-12">
      <button
        onClick={() => onNavigate('/t/orders')}
        className="text-xs text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)] flex items-center gap-1 cursor-pointer font-medium"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Back to orders</span>
      </button>

      {/* Header */}
      <div className="p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="font-mono font-black text-2xl text-[var(--vt-thread,#2E3A87)]">
              {order.order_no}
            </span>
            <span className="text-base font-bold capitalize text-[var(--vt-ink,#1F1C18)]">
              {order.garment_type.replace('_', ' ')}
            </span>
          </div>

          <div className="text-xs text-[var(--vt-ink-muted,#5C554C)] flex items-center gap-2">
            <span>Client: {order.client_code} ({order.display_name || 'Anonymous'})</span>
            <span>·</span>
            <span>Due: {order.due_date}</span>
          </div>
        </div>

        <Button
          onClick={() => onNavigate(`/t/orders/${order.order_id}/sheet`)}
          icon={<FileText className="w-4 h-4" />}
          size="md"
        >
          {t('specSheet')} &amp; Share
        </Button>
      </div>

      {/* Status Stepper Progression */}
      <div className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs">
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-3">
          Garment Production Status
        </span>

        <div className="grid grid-cols-5 gap-2 mb-4">
          {statusSteps.map((s, idx) => {
            const isCompleted = idx <= currentStepIdx;
            const isCurrent = idx === currentStepIdx;

            return (
              <button
                key={s}
                onClick={() => handleUpdateStatus(s)}
                className={`py-2 px-1 rounded-xl text-xs font-bold text-center capitalize transition-all cursor-pointer ${
                  isCurrent
                    ? 'bg-[var(--vt-thread,#2E3A87)] text-white shadow-sm ring-2 ring-[var(--vt-thread,#2E3A87)]/20'
                    : isCompleted
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-[#FAF8F5] text-[var(--vt-ink-muted,#5C554C)] border border-[var(--vt-line,#DDD5C8)] hover:bg-[#F3EFE8]'
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>

        <div className="text-[11px] text-[var(--vt-ink-muted,#5C554C)]">
          Tap any stage above to advance or update order progress.
        </div>
      </div>

      {/* Measurement Items Table */}
      <div className="rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white overflow-hidden shadow-2xs">
        <div className="p-4 bg-[#FAF8F5] border-b border-[var(--vt-line,#DDD5C8)]">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--vt-ink,#1F1C18)]">
            Tailoring Dimensions
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-[var(--vt-line,#DDD5C8)] text-xs text-[var(--vt-ink-muted,#5C554C)]">
                <th className="p-3.5 font-semibold">Site</th>
                <th className="p-3.5 font-semibold text-right">Body Size</th>
                <th className="p-3.5 font-semibold text-right">Ease</th>
                <th className="p-3.5 font-semibold text-right">Finished Size</th>
                <th className="p-3.5 font-semibold text-center">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--vt-line,#DDD5C8)]/50">
              {order.items.map((item) => (
                <tr key={item.site_code} className="hover:bg-[#FAF8F5]">
                  <td className="p-3.5 font-bold capitalize text-[var(--vt-ink,#1F1C18)]">
                    {item.site_code}
                    {item.overridden && (
                      <span className="block text-[10px] text-amber-700 font-mono">
                        override: {item.override_reason}
                      </span>
                    )}
                  </td>
                  <td className="p-3.5 text-right font-mono tabular-nums text-[var(--vt-ink-muted,#5C554C)]">
                    {item.body_mm ? `${(item.body_mm / 10).toFixed(1)} cm` : '—'}
                  </td>
                  <td className="p-3.5 text-right font-mono tabular-nums text-[var(--vt-ink-muted,#5C554C)]">
                    +{(item.ease_mm / 10).toFixed(1)} cm
                  </td>
                  <td className="p-3.5 text-right font-mono font-bold text-base text-[var(--vt-thread,#2E3A87)] tabular-nums">
                    {item.finished_mm ? `${(item.finished_mm / 10).toFixed(1)} cm` : 'Pending fitting'}
                  </td>
                  <td className="p-3.5 text-center">
                    <FlagBadge flag={item.confidence_flag} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Workshop Notes */}
      {order.notes && (
        <div className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
            Workshop Notes
          </span>
          <p className="text-sm text-[var(--vt-ink,#1F1C18)] whitespace-pre-wrap">{order.notes}</p>
        </div>
      )}
    </div>
  );
};
