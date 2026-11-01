import React, { useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { ApiError } from '../../api/http';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { Banner, Dialog } from '../../components/ui/feedback';
import { ClaimPanel } from './ClaimPanel';
import {
  BackLink,
  Card,
  currentUnit,
  formatLength,
  hintClass,
  inputClass,
  labelClass,
  Loading,
  rowClass,
  Title,
  useDates,
  useLoad,
} from './common';
import { TailorKey, useTailorText } from './tailorText';

const STATUS_KEY: Record<string, TailorKey> = {
  final: 'statusFinal',
  conflict: 'statusConflict',
  superseded: 'statusSuperseded',
  deleted: 'statusDeleted',
};

export const ClientDetailView: React.FC<{ clientId: string; onNavigate: (path: string) => void }> = ({
  clientId,
  onNavigate,
}) => {
  const tx = useTailorText();
  const { date } = useDates();
  const unit = currentUnit();
  const { data, setData, failed, reload } = useLoad(async () => {
    const path = { client_id: clientId };
    const [client, profiles, orders] = await Promise.all([
      apiClient.get('/clients/{client_id}', { path }),
      apiClient.get('/clients/{client_id}/profiles', { path }),
      apiClient.get('/orders', { query: { page_size: 100 } }),
    ]);
    return { client, profiles, orders: orders.items.filter((row) => row.client_id === clientId) };
  }, [clientId]);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [height, setHeight] = useState('');
  const [dialog, setDialog] = useState<'rotate' | 'delete' | null>(null);
  const [typedCode, setTypedCode] = useState('');
  const [error, setError] = useState<TailorKey | null>(null);
  const [busy, setBusy] = useState(false);

  if (!data) return <Loading failed={failed} onRetry={reload} />;
  const { client, profiles, orders } = data;
  const latest = profiles.find((row) => row.status === 'final') ?? null;
  const conflict = profiles.some((row) => row.status === 'conflict');

  const startEditing = () => {
    setName(client.display_name ?? '');
    setHeight(client.height_mm ? String(client.height_mm / 10) : '');
    setEditing(true);
  };

  const centimetres = height.trim() ? Number(height) : null;
  const badHeight = centimetres !== null && !(centimetres >= 120 && centimetres <= 220);

  const saveDetails = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await apiClient.patch('/clients/{client_id}', {
        path: { client_id: clientId },
        body: {
          display_name: name.trim() || null,
          height_mm: centimetres === null ? null : Math.round(centimetres * 10),
        },
      });
      setData({ ...data, client: next });
      setEditing(false);
    } catch {
      setError('saveFailed');
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await apiClient.post('/clients/{client_id}/rotate-code', { path: { client_id: clientId } });
      setData({ ...data, client: { ...client, client_code: next.client_code } });
      setDialog(null);
    } catch {
      setError('saveFailed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.delete('/clients/{client_id}', { path: { client_id: clientId } });
      onNavigate('/t/clients');
    } catch (problem) {
      const code = problem instanceof ApiError ? problem.code : '';
      setError(
        code === 'client_has_orders'
          ? 'deleteHasOrders'
          : code === 'client_records_retained'
            ? 'deleteRetained'
            : 'saveFailed',
      );
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-4xl mx-auto">
      <BackLink onClick={() => onNavigate('/t/clients')} label={tx('codeBackToList')} />
      {client.deletion_requested && <Banner tone="warn">{tx('deletionBanner')}</Banner>}

      <Card>
        <Title>
          <span className="font-mono text-[var(--vt-thread)]" data-testid="client-code">{client.client_code}</span>{' '}
          <span className="text-lg font-bold">{client.display_name || tx('anonymous')}</span>
        </Title>
        <p className={hintClass}>
          {tx('clientCreated', { date: date(client.created_at) })}
          {client.height_mm ? ` · ${tx('clientHeight', { height: formatLength(client.height_mm, unit) })}` : ''}
        </p>
        {editing ? (
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="client-name" className={labelClass}>{tx('nameLabel')}</label>
              <input id="client-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="client-height" className={labelClass}>{tx('heightLabel')}</label>
              <input id="client-height" inputMode="decimal" aria-invalid={badHeight} value={height} onChange={(e) => setHeight(e.target.value)} className={inputClass} />
              <p className={hintClass}>{tx('codeHeightHint')}</p>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button loading={busy} disabled={badHeight} onClick={saveDetails}>{tx('save')}</Button>
              <Button variant="outline" onClick={() => setEditing(false)}>{tx('cancel')}</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={startEditing}>{tx('edit')}</Button>
            {latest && (
              <Button icon={<Plus aria-hidden="true" className="w-4 h-4" />} onClick={() => onNavigate(`/t/orders/new?profileId=${latest.profile_id}`)}>
                {tx('newOrderFromLatest')}
              </Button>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-sm text-rose-800">{tx(error)}</p>}
      </Card>

      <Card title={tx('profilesTitle')}>
        {conflict && <p className="text-sm font-semibold text-sky-800">{tx('conflictBadge')}</p>}
        {profiles.length === 0 ? (
          <p className={hintClass}>{tx('profilesEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {profiles.map((row) => (
              <li key={row.profile_id}>
                <button type="button" className={rowClass} onClick={() => onNavigate(`/t/clients/${clientId}/profiles/${row.profile_id}`)}>
                  <span>
                    <span className="font-bold">v{row.version}</span> · {tx(STATUS_KEY[row.status])}
                    <span className={`block ${hintClass}`}>
                      {tx('profileLine', {
                        date: date(row.captured_at),
                        mode: tx(row.capture_mode === 'self' ? 'modeSelf' : 'modeAssisted'),
                      })}
                      {' · '}
                      {tx('flagsSummary', { check: row.flag_counts.check, fail: row.flag_counts.fail })}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="w-5 h-5 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={tx('ordersTitle')}>
        {orders.length === 0 ? (
          <p className={hintClass}>{tx('ordersEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {orders.map((row) => (
              <li key={row.order_id}>
                <button type="button" className={rowClass} onClick={() => onNavigate(`/t/orders/${row.order_id}`)}>
                  <span>
                    <span className="font-mono font-bold">{row.order_no}</span> · {tx(`garment_${row.garment_type}` as TailorKey)}
                    <span className={`block ${hintClass}`}>
                      {tx('dueOn', { date: date(row.due_date) })} · {tx(`status_${row.status}` as TailorKey)}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="w-5 h-5 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ClaimPanel clientId={clientId} onChanged={() => void reload()} />

      <Card title={tx('actionsTitle')}>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDialog('rotate')}>{tx('rotateCode')}</Button>
          <Button variant="danger" onClick={() => { setTypedCode(''); setDialog('delete'); }}>{tx('deleteClient')}</Button>
        </div>
      </Card>

      <Dialog open={dialog === 'rotate'} title={tx('rotateCode')} onClose={() => setDialog(null)}>
        <p className="text-sm mb-4">{tx('rotateWarning')}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => setDialog(null)}>{tx('cancel')}</Button>
          <Button loading={busy} onClick={rotate}>{tx('rotateConfirm')}</Button>
        </div>
      </Dialog>
      <Dialog open={dialog === 'delete'} title={tx('deleteClient')} onClose={() => setDialog(null)}>
        <label htmlFor="delete-code" className="text-sm block mb-2">{tx('deleteWarning', { code: client.client_code })}</label>
        <input id="delete-code" value={typedCode} onChange={(e) => setTypedCode(e.target.value.toUpperCase())} className={`${inputClass} mb-4 font-mono`} />
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => setDialog(null)}>{tx('cancel')}</Button>
          <Button variant="danger" loading={busy} disabled={typedCode !== client.client_code} onClick={remove}>{tx('deleteConfirm')}</Button>
        </div>
      </Dialog>
    </div>
  );
};
