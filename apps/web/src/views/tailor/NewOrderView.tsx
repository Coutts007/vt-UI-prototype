import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n';
import {
  GarmentType,
  SiteCode,
  OrderItemInput,
  MeasurementProfile,
  ClientRecord,
} from '../../types/api';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { FlagBadge } from '../../components/ui/FlagBadge';
import {
  ChevronLeft,
  Calendar,
  Edit2,
  AlertTriangle,
  CheckCircle2,
  Info,
} from 'lucide-react';

interface NewOrderViewProps {
  initialProfileId?: string;
  onNavigate: (path: string) => void;
}

export const NewOrderView: React.FC<NewOrderViewProps> = ({
  initialProfileId,
  onNavigate,
}) => {
  const { t } = useI18n();

  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [profiles, setProfiles] = useState<MeasurementProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<MeasurementProfile | null>(null);

  const [garmentType, setGarmentType] = useState<GarmentType>('shirt');
  const [showAllSites, setShowAllSites] = useState<boolean>(false);
  const [dueDate, setDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().split('T')[0];
  });
  const [notes, setNotes] = useState<string>('');
  const [items, setItems] = useState<OrderItemInput[]>([]);

  // Override dialog
  const [overrideModalSite, setOverrideModalSite] = useState<SiteCode | null>(null);
  const [overrideValCm, setOverrideValCm] = useState<number>(0);
  const [overrideReason, setOverrideReason] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Garment mapping from Section 13.6
  const garmentSitesMap: Record<GarmentType, SiteCode[]> = {
    shirt: ['shoulder', 'chest', 'waist', 'sleeve', 'neck'],
    dress: ['shoulder', 'chest', 'waist', 'hip', 'sleeve'],
    trousers: ['waist', 'hip', 'outleg', 'inleg'],
    suit_jacket: ['shoulder', 'chest', 'waist', 'hip', 'sleeve', 'neck'],
    skirt: ['waist', 'hip', 'outleg'],
    other: ['shoulder', 'chest', 'waist', 'hip', 'sleeve', 'outleg', 'inleg', 'neck'],
  };

  useEffect(() => {
    void (async () => {
      const list = await api.getClients();
      setClients(list);
      const chosen = initialProfileId ? await api.getProfileById(initialProfileId) : null;
      const owner = list.find((c) => c.client_code === chosen?.client_code);
      if (owner ?? list[0]) setSelectedClientId((owner ?? list[0]).client_id);
    })();
  }, [initialProfileId]);

  useEffect(() => {
    if (selectedClientId) {
      const client = clients.find((c) => c.client_id === selectedClientId);
      if (client) {
        api.getProfilesForClient(client.client_code).then((pList) => {
          setProfiles(pList);
          if (initialProfileId) {
            const found = pList.find((p) => p.profile_id === initialProfileId);
            if (found) setSelectedProfile(found);
            else if (pList.length > 0) setSelectedProfile(pList[0]);
          } else if (pList.length > 0) {
            setSelectedProfile(pList[0]);
          }
        });
      }
    }
  }, [selectedClientId, clients, initialProfileId]);

  // Sync items when profile or garment type changes
  useEffect(() => {
    if (!selectedProfile) return;
    const requiredSites = showAllSites
      ? (['shoulder', 'chest', 'waist', 'hip', 'sleeve', 'outleg', 'inleg', 'neck'] as SiteCode[])
      : garmentSitesMap[garmentType];

    const newItems: OrderItemInput[] = requiredSites.map((site) => {
      const m = selectedProfile.measurements.find((x) => x.site_code === site);
      const isFlagged = m && m.confidence_flag !== 'pass';
      return {
        site_code: site,
        body_mm: m?.value_mm ?? null,
        ease_mm: 20, // default 2.0 cm ease
        overridden: false,
        flag_confirmed: !isFlagged,
      };
    });

    setItems(newItems);
  }, [selectedProfile, garmentType, showAllSites]);

  const handleEaseChange = (siteCode: SiteCode, easeCm: number) => {
    const easeMm = Math.max(0, Math.min(300, Math.round(easeCm * 10)));
    setItems((prev) =>
      prev.map((i) => (i.site_code === siteCode ? { ...i, ease_mm: easeMm } : i))
    );
  };

  const handleConfirmFlag = (siteCode: SiteCode) => {
    setItems((prev) =>
      prev.map((i) => (i.site_code === siteCode ? { ...i, flag_confirmed: true } : i))
    );
  };

  const handleApplyOverride = () => {
    if (!overrideModalSite) return;
    const newMm = Math.round(overrideValCm * 10);
    setItems((prev) =>
      prev.map((i) =>
        i.site_code === overrideModalSite
          ? {
              ...i,
              body_mm: newMm,
              overridden: true,
              override_reason: overrideReason || 'Manual workshop override',
              flag_confirmed: true,
            }
          : i
      )
    );
    setOverrideModalSite(null);
  };

  // Flag confirmation gating: all flagged items must be confirmed or overridden!
  const unconfirmedFlags = items.filter((i) => {
    const m = selectedProfile?.measurements.find((x) => x.site_code === i.site_code);
    return m && m.confidence_flag !== 'pass' && !i.flag_confirmed && !i.overridden;
  });

  const canSave = unconfirmedFlags.length === 0 && selectedProfile && dueDate;

  const handleSaveOrder = async () => {
    if (!selectedProfile) return;
    setErrorMsg(null);
    setSaving(true);

    try {
      const created = await api.createOrder({
        client_id: selectedClientId,
        profile_id: selectedProfile.profile_id,
        garment_type: garmentType,
        due_date: dueDate,
        notes,
        items,
      });

      onNavigate(`/t/orders/${created.order_id}`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error saving order');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto pb-12">
      <button
        onClick={() => onNavigate('/t/orders')}
        className="text-xs text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)] flex items-center gap-1 cursor-pointer font-medium"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Back to orders</span>
      </button>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
        {t('newOrder')}
      </h1>

      {/* Client and Profile Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs">
        <div>
          <label htmlFor="neworderview-1" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
            Client
          </label>
          <select id="neworderview-1"
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white text-sm font-semibold text-[var(--vt-ink,#1F1C18)]"
          >
            {clients.map((c) => (
              <option key={c.client_id} value={c.client_id}>
                {c.client_code} {c.display_name ? `(${c.display_name})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="neworderview-2" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
            Measurement Profile
          </label>
          <select id="neworderview-2"
            value={selectedProfile?.profile_id || ''}
            onChange={(e) => {
              const p = profiles.find((x) => x.profile_id === e.target.value);
              if (p) setSelectedProfile(p);
            }}
            className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white text-sm font-semibold text-[var(--vt-ink,#1F1C18)]"
          >
            {profiles.map((p) => (
              <option key={p.profile_id} value={p.profile_id}>
                Version {p.version} · {new Date(p.captured_at).toLocaleDateString('en-KE')}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Garment Selection & Due Date */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs">
        <div>
          <label htmlFor="neworderview-3" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
            Garment Type
          </label>
          <select id="neworderview-3"
            value={garmentType}
            onChange={(e) => setGarmentType(e.target.value as GarmentType)}
            className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white text-sm font-semibold text-[var(--vt-ink,#1F1C18)] capitalize"
          >
            <option value="shirt">Shirt</option>
            <option value="dress">Dress</option>
            <option value="trousers">Trousers</option>
            <option value="suit_jacket">Suit Jacket</option>
            <option value="skirt">Skirt</option>
            <option value="other">Other / Full Body</option>
          </select>
        </div>

        <div>
          <label htmlFor="neworderview-4" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
            Target Due Date
          </label>
          <input id="neworderview-4"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white text-sm font-semibold text-[var(--vt-ink,#1F1C18)]"
          />
        </div>

        <div className="flex items-end">
          <label className="flex items-center gap-2 text-xs font-semibold text-[var(--vt-ink-muted,#5C554C)] pb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showAllSites}
              onChange={(e) => setShowAllSites(e.target.checked)}
              className="w-4 h-4 rounded text-[var(--vt-thread,#2E3A87)]"
            />
            <span>Show all 8 measurements</span>
          </label>
        </div>
      </div>

      {/* Measurements Table: Body · Ease · Finished */}
      <div className="rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white overflow-hidden shadow-2xs">
        <div className="p-4 bg-[#FAF8F5] border-b border-[var(--vt-line,#DDD5C8)] flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--vt-ink,#1F1C18)]">
            Measurements &amp; Ease Allowance
          </h2>
          <span className="text-xs text-[var(--vt-ink-muted,#5C554C)]">
            Finished = Body + Ease
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-[var(--vt-line,#DDD5C8)] text-xs text-[var(--vt-ink-muted,#5C554C)]">
                <th className="p-3.5 font-semibold">Site</th>
                <th className="p-3.5 font-semibold">Body Size</th>
                <th className="p-3.5 font-semibold">Ease (+cm)</th>
                <th className="p-3.5 font-semibold">Finished</th>
                <th className="p-3.5 font-semibold">Flag Gate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--vt-line,#DDD5C8)]/50">
              {items.map((item) => {
                const orig = selectedProfile?.measurements.find((m) => m.site_code === item.site_code);
                const flag = orig?.confidence_flag || 'pass';
                const bodyCm = item.body_mm ? (item.body_mm / 10).toFixed(1) : null;
                const easeCm = (item.ease_mm / 10).toFixed(1);
                const finishedCm =
                  item.body_mm !== null
                    ? ((item.body_mm + item.ease_mm) / 10).toFixed(1) + ' cm'
                    : 'Pending fitting';

                const needsConfirm = flag !== 'pass' && !item.flag_confirmed && !item.overridden;

                return (
                  <tr key={item.site_code} className="hover:bg-[#FAF8F5]">
                    <td className="p-3.5 font-bold capitalize text-[var(--vt-ink,#1F1C18)]">
                      {item.site_code}
                      {item.overridden && (
                        <span className="block text-[10px] text-amber-700 font-mono">
                          overridden: {item.override_reason}
                        </span>
                      )}
                    </td>

                    {/* Body Size + Override Pencil */}
                    <td className="p-3.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold tabular-nums">
                          {bodyCm ? `${bodyCm} cm` : '—'}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setOverrideModalSite(item.site_code);
                            setOverrideValCm(item.body_mm ? item.body_mm / 10 : 90);
                            setOverrideReason('');
                          }}
                          className="p-1 rounded text-slate-600 hover:text-[var(--vt-thread,#2E3A87)] hover:bg-black/5 cursor-pointer"
                          title="Override Body Measurement"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>

                    {/* Ease Input */}
                    <td className="p-3.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          aria-label={`${t('easeForSite')}: ${item.site_code}`}
                          type="number"
                          step="0.5"
                          min="0"
                          max="30"
                          value={easeCm}
                          onChange={(e) =>
                            handleEaseChange(item.site_code, parseFloat(e.target.value) || 0)
                          }
                          className="w-18 h-9 px-2 rounded-lg border border-[var(--vt-line,#DDD5C8)] bg-white text-xs font-mono font-semibold text-center outline-none focus:border-[var(--vt-thread,#2E3A87)]"
                        />
                        <span className="text-xs text-[var(--vt-ink-muted,#5C554C)]">cm</span>
                      </div>
                    </td>

                    {/* Finished */}
                    <td className="p-3.5 font-mono font-bold text-[var(--vt-thread,#2E3A87)] text-base tabular-nums">
                      {finishedCm}
                    </td>

                    {/* Flag Gate */}
                    <td className="p-3.5">
                      {flag === 'pass' ? (
                        <FlagBadge flag="pass" />
                      ) : (
                        <div className="flex flex-col gap-1">
                          <FlagBadge flag={flag} reasons={orig?.flag_reasons} />
                          {needsConfirm ? (
                            <button
                              type="button"
                              onClick={() => handleConfirmFlag(item.site_code)}
                              className="text-[11px] font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded cursor-pointer mt-1"
                            >
                              Click to Confirm Flag
                            </button>
                          ) : (
                            <span className="text-[10px] text-emerald-700 font-semibold flex items-center gap-0.5">
                              <CheckCircle2 className="w-3 h-3" /> Confirmed
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Notes Field */}
      <div className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs">
        <label className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
          Workshop Notes &amp; Extra Measurements
        </label>
        <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] block mb-2">
          Fabric specifications, pocket styles, custom cuffs, or extra lengths.
        </span>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          placeholder="Fabric, lining, collar style, pockets…"
          className="w-full p-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white text-sm outline-none focus:border-[var(--vt-thread,#2E3A87)]"
        />
      </div>

      {/* Error Message */}
      {errorMsg && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
          {errorMsg}
        </div>
      )}

      {/* Save Button */}
      <div className="flex flex-col gap-2">
        <Button
          onClick={handleSaveOrder}
          disabled={!canSave}
          loading={saving}
          size="xl"
          className="w-full"
        >
          Save Order
        </Button>

        {!canSave && unconfirmedFlags.length > 0 && (
          <span className="text-xs text-center text-amber-800 bg-amber-50 py-1.5 rounded-lg border border-amber-200">
            Please confirm or override all flagged measurements before saving the order.
          </span>
        )}
      </div>

      {/* Override Dialog Modal */}
      {overrideModalSite && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-[var(--vt-line,#DDD5C8)]">
            <h3 className="text-base font-bold text-[var(--vt-ink,#1F1C18)] mb-1 capitalize">
              Override {overrideModalSite} Measurement
            </h3>
            <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] mb-4">
              Enter the replacement value in centimetres. This change will be audited and marked on the specification sheet.
            </p>

            <div className="space-y-3 mb-6">
              <div>
                <label htmlFor="neworderview-5" className="text-xs font-semibold block mb-1">New Size (cm)</label>
                <input id="neworderview-5"
                  type="number"
                  step="0.1"
                  value={overrideValCm}
                  onChange={(e) => setOverrideValCm(parseFloat(e.target.value) || 0)}
                  className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] font-mono text-base font-bold"
                />
              </div>

              <div>
                <label htmlFor="neworderview-6" className="text-xs font-semibold block mb-1">Reason for Override</label>
                <input id="neworderview-6"
                  type="text"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. Measured at fitting tape check"
                  className="w-full h-10 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-xs"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOverrideModalSite(null)}
                className="flex-1"
              >
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleApplyOverride}
                className="flex-1"
              >
                Apply Override
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
