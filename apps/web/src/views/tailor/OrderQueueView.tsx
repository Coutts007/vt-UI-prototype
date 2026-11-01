import React, { useState } from 'react';
import { AlertTriangle, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { BottomSheet } from '../../components/ui/feedback';
import {
  chipClass,
  hintClass,
  inputClass,
  labelClass,
  Loading,
  nairobiToday,
  OrderStatus,
  OrderSummary,
  STATUSES,
  StaleNote,
  Title,
  useDates,
  useLoad,
} from './common';
import { TailorKey, useTailorText } from './tailorText';

type Sort = 'due_date' | 'created_at';
const OPEN: OrderStatus[] = ['new', 'cutting', 'fitting', 'ready'];

export const OrderQueueView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const tx = useTailorText();
  const { date } = useDates();
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [showCollected, setShowCollected] = useState(false);
  const [sort, setSort] = useState<Sort>('due_date');
  const [moving, setMoving] = useState<OrderSummary | null>(null);
  const [error, setError] = useState(false);

  const { data, failed, reload, updatedAt } = useLoad(async () => {
    const page = await apiClient.get('/orders', { query: { page_size: 100, sort } });
    return page.items;
  }, [sort]);

  if (!data) return <Loading failed={failed} onRetry={reload} />;
  const today = nairobiToday();
  const visible = data.filter((row) =>
    status ? row.status === status : showCollected || row.status !== 'collected',
  );
  const shownStatuses = showCollected ? STATUSES : OPEN;
  const count = (name: OrderStatus) => data.filter((row) => row.status === name).length;
  const statusName = (name: OrderStatus) => tx(`status_${name}` as TailorKey);

  const move = async (order: OrderSummary, next: OrderStatus) => {
    const backwards = STATUSES.indexOf(next) < STATUSES.indexOf(order.status);
    if (backwards && !window.confirm(tx('backwardsConfirm', { status: statusName(next) }))) return;
    setMoving(null);
    setError(false);
    try {
      await apiClient.patch('/orders/{order_id}', { path: { order_id: order.order_id }, body: { status: next } });
      await reload();
    } catch {
      setError(true);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <Title>{tx('ordersQueue')}</Title>
          <p className={hintClass}>{tx('ordersIntro')}</p>
        </div>
        <Button onClick={() => onNavigate('/t/orders/new')} icon={<Plus aria-hidden="true" className="w-4 h-4" />}>
          {tx('newOrder')}
        </Button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {shownStatuses.map((name) => (
          <button key={name} type="button" aria-pressed={status === name} className={chipClass(status === name)} onClick={() => setStatus(status === name ? null : name)}>
            {statusName(name)} ({count(name)})
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="order-sort" className={labelClass}>{tx('sortBy')}</label>
          <select id="order-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={inputClass}>
            <option value="due_date">{tx('sortDue')}</option>
            <option value="created_at">{tx('sortCreated')}</option>
          </select>
        </div>
        <Button variant="outline" onClick={() => { setShowCollected(!showCollected); setStatus(null); }}>
          {tx(showCollected ? 'hideCollected' : 'showCollected')}
        </Button>
      </div>
      <StaleNote failed={failed} updatedAt={updatedAt} />
      {error && <p role="alert" className="text-sm text-rose-800">{tx('saveFailed')}</p>}
      {visible.length === 0 ? (
        <p className="p-8 text-center text-sm rounded-2xl border border-[var(--vt-line)] bg-white">{tx('queueEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((row) => (
            <li key={row.order_id} className="p-4 rounded-xl border border-[var(--vt-line)] bg-white flex flex-col gap-2">
              <button type="button" className="text-left cursor-pointer flex items-center justify-between gap-2 min-h-[48px]" onClick={() => onNavigate(`/t/orders/${row.order_id}`)}>
                <span>
                  <span className="font-mono font-bold">{row.order_no}</span> · {tx(`garment_${row.garment_type}` as TailorKey)} · <span className="font-mono">{row.client_code}</span>
                  {row.display_name ? ` (${row.display_name})` : ''}
                  <span className={`block ${hintClass}`}>
                    {tx('dueOn', { date: date(row.due_date) })} · {tx('profileVersion', { version: row.profile_version })} · {statusName(row.status)}
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className="w-5 h-5 shrink-0" />
              </button>
              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                {row.due_date < today && row.status !== 'collected' && <span className="text-rose-800">{tx('overdue')}</span>}
                {row.flagged_sites > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-800">
                    <AlertTriangle aria-hidden="true" className="w-3 h-3" />
                    {tx('flaggedSites', { count: row.flagged_sites })}
                  </span>
                )}
                {row.has_conflict && (
                  <span className="inline-flex items-center gap-1 text-sky-800">
                    <RefreshCw aria-hidden="true" className="w-3 h-3" />
                    {tx('queueConflict')}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => onNavigate(`/t/orders/${row.order_id}/sheet`)}>{tx('sheet')}</Button>
                <Button size="sm" variant="outline" onClick={() => setMoving(row)}>{tx('changeStatus')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <BottomSheet open={moving !== null} title={tx('changeStatus')} onClose={() => setMoving(null)}>
        <div className="flex flex-col gap-2">
          {STATUSES.map((name) => (
            <Button key={name} variant={moving?.status === name ? 'primary' : 'outline'} onClick={() => moving && void move(moving, name)}>
              {statusName(name)}
            </Button>
          ))}
        </div>
      </BottomSheet>
    </div>
  );
};
