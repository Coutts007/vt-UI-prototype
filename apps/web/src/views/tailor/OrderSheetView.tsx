import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n';
import { Order, MeasurementProfile } from '../../types/api';
import { api } from '../../api/client';
import { OrderSheetPreview } from '../../components/ui/OrderSheetPreview';
import { ChevronLeft } from 'lucide-react';

interface OrderSheetViewProps {
  orderId: string;
  onNavigate: (path: string) => void;
}

export const OrderSheetView: React.FC<OrderSheetViewProps> = ({ orderId, onNavigate }) => {
  const { t } = useI18n();

  const [order, setOrder] = useState<Order | null>(null);
  const [profile, setProfile] = useState<MeasurementProfile | null>(null);
  const [includeName, setIncludeName] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOrder();
  }, [orderId]);

  const loadOrder = async () => {
    setLoading(true);
    try {
      const ord = await api.getOrderById(orderId);
      if (ord) {
        setOrder(ord);
        const prof = await api.getProfileById(ord.profile_id);
        setProfile(prof);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleShareWhatsApp = async () => {
    if (!order) return;
    const res = await api.generateSpecSheet(order.order_id, includeName);
    await api.logShare(res.sheet_id, 'whatsapp_share');

    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({ text: res.share_text }).catch(() => {});
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(res.share_text)}`, '_blank', 'noopener,noreferrer');
    }
  };

  const handleDownload = async () => {
    if (!order) return;
    const res = await api.generateSpecSheet(order.order_id, includeName);
    await api.logShare(res.sheet_id, 'download');
    window.print();
  };

  const handlePrint = async () => {
    if (!order) return;
    const res = await api.generateSpecSheet(order.order_id, includeName);
    await api.logShare(res.sheet_id, 'print');
    window.print();
  };

  if (loading || !order) {
    return <div className="p-8 text-center text-sm text-slate-600">Loading specification sheet…</div>;
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto pb-12">
      <button
        onClick={() => onNavigate(`/t/orders/${order.order_id}`)}
        className="text-xs text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)] flex items-center gap-1 cursor-pointer font-medium"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Back to order {order.order_no}</span>
      </button>

      <OrderSheetPreview
        order={order}
        profile={profile}
        includeName={includeName}
        onToggleIncludeName={setIncludeName}
        onShareWhatsApp={handleShareWhatsApp}
        onDownload={handleDownload}
        onPrint={handlePrint}
      />
    </div>
  );
};
