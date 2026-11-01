import React, { useEffect, useState } from 'react';
import { ApiError } from '../../api/http';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import {
  addDays,
  ALL_SITES,
  BackLink,
  Card,
  currentUnit,
  EaseSuggestion,
  GARMENT_SITES,
  GARMENTS,
  GarmentType,
  hintClass,
  inputClass,
  labelClass,
  Loading,
  nairobiToday,
  OrderItemInput,
  Profile,
  ProfileSummary,
  Title,
  useDates,
  useLoad,
} from './common';
import { OrderItemsTable } from './OrderItemsTable';
import { buildItems, unanswered } from './orderForm';
import { TailorKey, useTailorText } from './tailorText';

export const NewOrderView: React.FC<{ initialProfileId?: string; onNavigate: (path: string) => void }> = ({
  initialProfileId,
  onNavigate,
}) => {
  const tx = useTailorText();
  const { date } = useDates();
  const unit = currentUnit();
  const today = nairobiToday();
  const latestDue = addDays(today, 180);

  const clients = useLoad(() => apiClient.get('/clients', { query: { page_size: 100, sort: 'code' } }), []);
  const [clientId, setClientId] = useState('');
  const [summaries, setSummaries] = useState<ProfileSummary[]>([]);
  const [profileId, setProfileId] = useState(initialProfileId ?? '');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [garment, setGarment] = useState<GarmentType>('shirt');
  const [showAll, setShowAll] = useState(false);
  const [dueDate, setDueDate] = useState(addDays(today, 14));
  const [notes, setNotes] = useState('');
  const [suggested, setSuggested] = useState<EaseSuggestion[]>([]);
  const [items, setItems] = useState<OrderItemInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opened from a profile: that profile decides the client.
  useEffect(() => {
    if (!initialProfileId) return;
    void apiClient
      .get('/profiles/{profile_id}', { path: { profile_id: initialProfileId } })
      .then((row) => {
        setClientId(row.client_id);
        setProfile(row);
      })
      .catch(() => setError(tx('loadFailed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProfileId]);

  useEffect(() => {
    if (!clientId && clients.data?.items[0] && !initialProfileId) setClientId(clients.data.items[0].client_id);
  }, [clients.data, clientId, initialProfileId]);

  useEffect(() => {
    if (!clientId) return;
    void apiClient
      .get('/clients/{client_id}/profiles', { path: { client_id: clientId } })
      .then((rows) => {
        const usable = rows.filter((row) => row.status === 'final');
        setSummaries(usable);
        setProfileId((current) => (usable.some((row) => row.profile_id === current) ? current : usable[0]?.profile_id ?? ''));
      })
      .catch(() => setError(tx('loadFailed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (!profileId) {
      setProfile(null);
      return;
    }
    if (profile?.profile_id === profileId) return;
    setItems([]);
    void apiClient
      .get('/profiles/{profile_id}', { path: { profile_id: profileId } })
      .then(setProfile)
      .catch(() => setError(tx('loadFailed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  useEffect(() => {
    if (!profile) return;
    void apiClient
      .get('/ease-suggestions', {
        query: { client_id: profile.client_id, profile_id: profile.profile_id, garment_type: garment },
      })
      .then((rows) => {
        setSuggested(rows);
        // A new garment starts again, so an ease typed for a shirt never reaches a skirt unseen.
        setItems(buildItems(showAll ? ALL_SITES : GARMENT_SITES[garment], profile.measurements, rows));
      })
      .catch(() => setError(tx('loadFailed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.profile_id, garment]);

  useEffect(() => {
    if (profile)
      setItems((kept) =>
        buildItems(showAll ? ALL_SITES : GARMENT_SITES[garment], profile.measurements, suggested, kept),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll]);

  if (!clients.data) return <Loading failed={clients.failed} onRetry={clients.reload} />;

  const open = profile ? unanswered(items, profile.measurements) : [];
  const dueBad = dueDate < today || dueDate > latestDue;
  const canSave = Boolean(profile) && items.length > 0 && open.length === 0 && !dueBad;

  const save = async () => {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      const order = await apiClient.post('/orders', {
        body: {
          client_id: profile.client_id,
          profile_id: profile.profile_id,
          garment_type: garment,
          due_date: dueDate,
          notes,
          items,
        },
      });
      onNavigate(`/t/orders/${order.order_id}`);
    } catch (problem) {
      setError(tx('orderSavedError', { reason: problem instanceof ApiError ? problem.code : tx('loadFailed') }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto pb-12">
      <BackLink onClick={() => onNavigate('/t/orders')} label={tx('ordersQueue')} />
      <Title>{tx('newOrder')}</Title>
      <Card>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="order-client" className={labelClass}>{tx('pickClient')}</label>
            <select id="order-client" value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputClass}>
              {clients.data.items.map((row) => (
                <option key={row.client_id} value={row.client_id}>
                  {row.client_code} {row.display_name ? `(${row.display_name})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="order-profile" className={labelClass}>{tx('pickProfile')}</label>
            <select id="order-profile" value={profileId} onChange={(e) => setProfileId(e.target.value)} className={inputClass}>
              {summaries.map((row) => (
                <option key={row.profile_id} value={row.profile_id}>
                  v{row.version} · {date(row.captured_at)}
                </option>
              ))}
            </select>
            {summaries.length === 0 && <p className={hintClass}>{tx('noProfiles')}</p>}
          </div>
          <div>
            <label htmlFor="order-garment" className={labelClass}>{tx('garmentLabel')}</label>
            <select id="order-garment" value={garment} onChange={(e) => setGarment(e.target.value as GarmentType)} className={inputClass}>
              {GARMENTS.map((name) => (
                <option key={name} value={name}>{tx(`garment_${name}` as TailorKey)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="order-due" className={labelClass}>{tx('dueDateLabel')}</label>
            <input id="order-due" type="date" min={today} max={latestDue} value={dueDate} aria-invalid={dueBad} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
            {dueBad && <p role="alert" className="text-sm text-rose-800">{tx('dueDatePast')}</p>}
          </div>
        </div>
      </Card>

      {profile && (
        <Card>
          <label className="flex items-center gap-2 min-h-[48px] text-sm cursor-pointer">
            <input type="checkbox" className="w-5 h-5" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            {tx('showAllSites')}
          </label>
          <OrderItemsTable items={items} measurements={profile.measurements} suggestions={suggested} unit={unit} onChange={setItems} />
        </Card>
      )}

      <Card>
        <label htmlFor="order-notes" className={labelClass}>{tx('notesLabel')}</label>
        <textarea id="order-notes" rows={3} maxLength={1000} value={notes} placeholder={tx('notesPlaceholder')} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} py-2`} />
      </Card>

      {open.length > 0 && <p className="text-sm text-amber-900">{tx('saveBlocked')}</p>}
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
      <div className="flex gap-2">
        <Button size="lg" loading={busy} disabled={!canSave} onClick={save} className="flex-1">{tx('saveOrder')}</Button>
        <Button
          size="lg"
          variant="outline"
          onClick={() => {
            if (!notes && !items.some((item) => item.overridden) && !busy) onNavigate('/t/orders');
            else if (window.confirm(tx('confirmLeave'))) onNavigate('/t/orders');
          }}
        >
          {tx('cancel')}
        </Button>
      </div>
    </div>
  );
};
