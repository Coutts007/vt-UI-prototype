// The Body, Ease and Finished table, for a new order and for editing one (frontend-spec 13.6).
import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/feedback';
import { FlagBadge } from '../../components/ui/FlagBadge';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';
import {
  EaseSuggestion,
  formatLength,
  hintClass,
  inputClass,
  labelClass,
  OrderItemInput,
  SiteCode,
  toMm,
  toUnit,
  Unit,
} from './common';
import { finishedMm, Measured } from './orderForm';
import { useTailorText } from './tailorText';

const MAX_EASE_MM = 300;

export const OrderItemsTable: React.FC<{
  items: OrderItemInput[];
  measurements: Measured[];
  suggestions?: EaseSuggestion[];
  unit: Unit;
  onChange: (items: OrderItemInput[]) => void;
}> = ({ items, measurements, suggestions = [], unit, onChange }) => {
  const tx = useTailorText();
  const { t } = useI18n();
  const [overriding, setOverriding] = useState<SiteCode | null>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [easeText, setEaseText] = useState<Partial<Record<SiteCode, string>>>({});

  const siteName = (site: SiteCode) => t(`site_${site}` as TranslationKey);
  const change = (site: SiteCode, patch: Partial<OrderItemInput>) =>
    onChange(items.map((item) => (item.site_code === site ? { ...item, ...patch } : item)));

  const setEase = (site: SiteCode, text: string) => {
    setEaseText((all) => ({ ...all, [site]: text }));
    const mm = text.trim() === '' ? 0 : toMm(Number(text), unit);
    if (Number.isFinite(mm) && mm >= 0 && mm <= MAX_EASE_MM) change(site, { ease_mm: mm });
  };
  const easeInvalid = (site: SiteCode) => {
    const text = easeText[site];
    if (text === undefined || text.trim() === '') return false;
    const mm = toMm(Number(text), unit);
    return !Number.isFinite(mm) || mm < 0 || mm > MAX_EASE_MM;
  };

  const applyOverride = () => {
    if (!overriding) return;
    change(overriding, {
      body_mm: toMm(Number(value), unit),
      overridden: true,
      override_reason: reason.trim() || undefined,
      pending_fitting: false,
    });
    setOverriding(null);
  };
  const overrideMm = value.trim() ? toMm(Number(value), unit) : NaN;
  const overrideValid = overrideMm >= 100 && overrideMm <= 3000;

  const source = (site: SiteCode) => {
    const found = suggestions.find((row) => row.site_code === site);
    if (!found) return null;
    if (found.source === 'history') return tx('fromHistory', { count: found.n });
    return tx(found.source === 'preset' ? 'fromPreset' : 'fromDefault');
  };

  return (
    <>
      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const row = measurements.find((m) => m.site_code === item.site_code);
          const flag = row?.confidence_flag ?? 'pass';
          const finished = finishedMm(item);
          const text = easeText[item.site_code] ?? String(toUnit(item.ease_mm, unit));
          return (
            <li key={item.site_code} className="border-t border-[var(--vt-line)] pt-3" data-testid={`item-${item.site_code}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sm">{siteName(item.site_code)}</span>
                {flag !== 'pass' && <FlagBadge flag={flag} reasons={row?.flag_reasons ?? []} />}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2 items-end">
                <div>
                  <span className={labelClass}>{tx('bodyColumn')}</span>
                  <div className="flex items-center gap-1 min-h-[48px]">
                    <span className="text-sm font-semibold">{formatLength(item.body_mm, unit)}</span>
                    <button
                      type="button"
                      aria-label={tx('overrideButton', { site: siteName(item.site_code) })}
                      onClick={() => {
                        setValue(item.body_mm === null ? '' : String(toUnit(item.body_mm, unit)));
                        setReason(item.override_reason ?? '');
                        setOverriding(item.site_code);
                      }}
                      className="w-12 h-12 inline-flex items-center justify-center cursor-pointer"
                    >
                      <Pencil aria-hidden="true" className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor={`ease-${item.site_code}`} className={labelClass}>{tx('easeColumn')}</label>
                  <input
                    id={`ease-${item.site_code}`}
                    inputMode="decimal"
                    value={text}
                    aria-invalid={easeInvalid(item.site_code)}
                    onChange={(event) => setEase(item.site_code, event.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <span className={labelClass}>{tx('finishedColumn')}</span>
                  <p className="min-h-[48px] flex items-center text-sm font-bold" data-testid={`finished-${item.site_code}`}>
                    {formatLength(finished, unit)}
                  </p>
                </div>
              </div>
              {easeInvalid(item.site_code) && <p role="alert" className="text-sm text-rose-800">{tx('easeRange')}</p>}
              {source(item.site_code) && <p className={hintClass}>{source(item.site_code)}</p>}
              {flag !== 'pass' && !item.overridden && (
                <div className="mt-1">
                  <p className="text-xs text-amber-900">
                    {tx('flaggedHelper', { reason: (row?.flag_reasons ?? []).join(', ') || tx('flaggedNoReason') })}
                  </p>
                  {flag === 'check' ? (
                    <label className="flex items-center gap-2 min-h-[48px] text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-5 h-5"
                        checked={Boolean(item.flag_confirmed)}
                        onChange={(event) => change(item.site_code, { flag_confirmed: event.target.checked })}
                      />
                      {tx('confirmed')}
                    </label>
                  ) : (
                    <label className="flex items-center gap-2 min-h-[48px] text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-5 h-5"
                        checked={Boolean(item.pending_fitting)}
                        onChange={(event) => change(item.site_code, { pending_fitting: event.target.checked })}
                      />
                      {tx('measureAtFitting')}
                    </label>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Dialog
        open={overriding !== null}
        title={overriding ? tx('overrideTitle', { site: siteName(overriding) }) : ''}
        onClose={() => setOverriding(null)}
      >
        <label htmlFor="override-value" className={labelClass}>{tx('overrideValue', { unit })}</label>
        <input id="override-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={`${inputClass} mb-3`} />
        <label htmlFor="override-reason" className={labelClass}>{tx('overrideReason')}</label>
        <input id="override-reason" maxLength={256} value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputClass} mb-2`} />
        <p className={`${hintClass} mb-4`}>{tx('overrideNote')}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => setOverriding(null)}>{tx('cancel')}</Button>
          <Button disabled={!overrideValid} onClick={applyOverride}>{tx('overrideApply')}</Button>
        </div>
      </Dialog>
    </>
  );
};
