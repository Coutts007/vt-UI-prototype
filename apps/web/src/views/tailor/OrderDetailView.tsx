import React, { useState } from 'react';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/feedback';
import {
  addDays,
  BackLink,
  Card,
  currentUnit,
  formatLength,
  hintClass,
  inputClass,
  labelClass,
  Loading,
  nairobiToday,
  OrderItemInput,
  OrderStatus,
  STATUSES,
  Title,
  useDates,
  useLoad,
} from './common';
import { OrderItemsTable } from './OrderItemsTable';
import { TailorKey, useTailorText } from './tailorText';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';
import { unanswered } from './orderForm';

export const OrderDetailView: React.FC<{ orderId: string; onNavigate: (path: string) => void }> = ({ orderId, onNavigate }) => {
  const tx = useTailorText();
  const { t } = useI18n();
  const { date, time } = useDates();
  const unit = currentUnit();
  const path = { order_id: orderId };
  const { data, failed, reload } = useLoad(async () => {
    const order = await apiClient.get('/orders/{order_id}', { path });
    const profile = await apiClient.get('/profiles/{profile_id}', { path: { profile_id: order.profile_id } });
    return { order, measurements: profile.measurements };
  }, [orderId]);
  const [notes, setNotes] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [items, setItems] = useState<OrderItemInput[] | null>(null);
  const [dialog, setDialog] = useState<'delete' | 'edit' | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!data) return <Loading failed={failed} onRetry={reload} />;
  const { order, measurements } = data;
  const today = nairobiToday();
  const statusName = (name: OrderStatus) => tx(`status_${name}` as TailorKey);

  const send = async (body: Parameters<typeof apiClient.patch<'/orders/{order_id}'>>[1]) => {
    setBusy(true);
    setError(false);
    try {
      await apiClient.patch('/orders/{order_id}', { path, ...body });
      await reload();
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const move = (next: OrderStatus) => {
    const back = STATUSES.indexOf(next) < STATUSES.indexOf(order.status);
    if (back && !window.confirm(tx('backwardsConfirm', { status: statusName(next) }))) return;
    void send({ body: { status: next } });
  };

  const beginEdit = () =>
    setItems(
      order.items.map((item) => ({
        site_code: item.site_code,
        body_mm: item.body_mm,
        ease_mm: item.ease_mm,
        overridden: item.overridden,
        override_reason: item.override_reason ?? undefined,
        flag_confirmed: item.flag_confirmed ?? false,
        pending_fitting: item.pending_fitting ?? false,
      })),
    );

  const remove = async () => {
    setBusy(true);
    try {
      await apiClient.delete('/orders/{order_id}', { path });
      onNavigate('/t/orders');
    } catch {
      setError(true);
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  const open = items ? unanswered(items, measurements) : [];
  const dueNow = due ?? order.due_date;
  const notesNow = notes ?? order.notes;
  const dueBad = dueNow !== order.due_date && (dueNow < today || dueNow > addDays(today, 180));

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto">
      <BackLink onClick={() => onNavigate('/t/orders')} label={tx('ordersQueue')} />
      <Title>
        <span className="font-mono">{order.order_no}</span> · {tx(`garment_${order.garment_type}` as TailorKey)}
      </Title>
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" className="underline min-h-[48px] cursor-pointer" onClick={() => onNavigate(`/t/clients/${order.client_id}`)}>
          {tx('clientLink', { code: order.client_code })}
        </button>
        <button type="button" className="underline min-h-[48px] cursor-pointer" onClick={() => onNavigate(`/t/clients/${order.client_id}/profiles/${order.profile_id}`)}>
          {tx('profileLink', { version: order.profile_version })}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-rose-800">{tx('saveFailed')}</p>}
      <Card title={tx('changeStatus')}>
        <ol className="flex flex-wrap gap-2">
          {STATUSES.map((name) => (
            <li key={name}>
              <Button
                size="sm"
                variant={order.status === name ? 'primary' : 'outline'}
                aria-current={order.status === name ? 'step' : undefined}
                onClick={() => order.status !== name && move(name)}
              >
                {statusName(name)}
              </Button>
            </li>
          ))}
        </ol>
        <h3 className="text-sm font-semibold">{tx('orderHistory')}</h3>
        <ul className={hintClass}>
          {order.status_history.map((step) => (
            <li key={`${step.status}-${step.at}`}>{statusName(step.status)} · {time(step.at)}</li>
          ))}
        </ul>
      </Card>
      <Card title={tx('orderItems')}>
        {items ? (
          <>
            <OrderItemsTable items={items} measurements={measurements} unit={unit} onChange={setItems} />
            {open.length > 0 && <p className="text-sm text-amber-900">{tx('saveBlocked')}</p>}
            <div className="flex gap-2">
              <Button loading={busy} disabled={open.length > 0} onClick={() => void send({ body: { items } }).then((ok) => ok && setItems(null))}>{tx('save')}</Button>
              <Button variant="outline" onClick={() => setItems(null)}>{tx('cancel')}</Button>
            </div>
          </>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th scope="col" className="py-1">{tx('siteColumn')}</th>
                  <th scope="col" className="py-1">{tx('bodyColumn')}</th>
                  <th scope="col" className="py-1">{tx('easeColumn')}</th>
                  <th scope="col" className="py-1">{tx('finishedColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.site_code} className="border-t border-[var(--vt-line)]">
                    <td className="py-2">{t(`site_${item.site_code}` as TranslationKey)}</td>
                    <td className="py-2">{item.pending_fitting ? tx('measureAtFitting') : formatLength(item.body_mm, unit)}</td>
                    <td className="py-2">{formatLength(item.ease_mm, unit)}</td>
                    <td className="py-2 font-bold">{formatLength(item.finished_mm, unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button variant="outline" size="sm" onClick={() => (order.status === 'new' ? beginEdit() : setDialog('edit'))}>{tx('editItems')}</Button>
          </>
        )}
      </Card>
      <Card>
        <label htmlFor="detail-due" className={labelClass}>{tx('dueDateLabel')}</label>
        <input id="detail-due" type="date" value={dueNow} aria-invalid={dueBad} onChange={(e) => setDue(e.target.value)} className={inputClass} />
        <p className={hintClass}>{tx('dueOn', { date: date(order.due_date) })}</p>
        {dueBad && <p role="alert" className="text-sm text-rose-800">{tx('dueDatePast')}</p>}
        <label htmlFor="detail-notes" className={labelClass}>{tx('notesLabel')}</label>
        <textarea id="detail-notes" rows={3} maxLength={1000} value={notesNow} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} py-2`} />
        <Button loading={busy} disabled={dueBad} onClick={() => void send({ body: { due_date: dueNow, notes: notesNow } }).then((ok) => { if (ok) { setDue(null); setNotes(null); } })}>{tx('save')}</Button>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onNavigate(`/t/orders/${orderId}/sheet`)}>{tx('sheet')}</Button>
        {order.status === 'new' && <Button variant="danger" onClick={() => setDialog('delete')}>{tx('deleteOrder')}</Button>}
      </div>
      <Dialog open={dialog === 'edit'} title={tx('editItems')} onClose={() => setDialog(null)}>
        <p className="text-sm mb-4">{tx('editInProgress')}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => setDialog(null)}>{tx('cancel')}</Button>
          <Button onClick={() => { setDialog(null); beginEdit(); }}>{tx('yesChange')}</Button>
        </div>
      </Dialog>
      <Dialog open={dialog === 'delete'} title={tx('deleteOrder')} onClose={() => setDialog(null)}>
        <p className="text-sm mb-4">{tx('deleteOrderWarning', { order: order.order_no })}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => setDialog(null)}>{tx('cancel')}</Button>
          <Button variant="danger" loading={busy} onClick={remove}>{tx('deleteOrder')}</Button>
        </div>
      </Dialog>
    </div>
  );
};
