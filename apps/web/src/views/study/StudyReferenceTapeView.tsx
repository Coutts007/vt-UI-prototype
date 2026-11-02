// Reference tape entry (frontend-spec 15.2). Blind: this screen never asks for, receives or shows a system
// value. It posts the measurer's own readings, which lock on save; a typo goes to the admin's correction.
import React, { useCallback, useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { ApiError, NetworkError } from '../../api/http';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { QueuedReading, vtStorage } from '../../db/storage';
import { Page, SiteValues, TAPE_SITES, problemKey } from '../admin/adminCommon';
import { AdminKey, useAdminText } from '../admin/adminText';
import { Card, chipClass, hintClass, inputClass, labelClass } from '../tailor/common';

/** Plausible adult ranges in cm. Outside them the measurer confirms, never is refused. */
export const TAPE_RANGE: Record<keyof SiteValues, [number, number]> = {
  stature: [120, 220], shoulder: [28, 60], chest: [60, 160], waist: [50, 160], hip: [60, 170],
  sleeve: [40, 85], outleg: [70, 130], inleg: [55, 100], neck: [28, 55],
};

/** "86.4" becomes 864 mm; anything that is not a number to 0.1 cm is null. */
export function tapeMm(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (!/^\d{2,3}(\.\d)?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 10);
}

type Receipt = { code: string; n: number; outOfOrder: boolean } | { queued: true };

async function send(reading: QueuedReading) {
  return apiClient.post('/study/reference-readings', {
    body: {
      participant_code: reading.participant_code,
      reading_no: reading.reading_no,
      values: reading.values,
      taken_at: reading.taken_at,
    },
  });
}

export const StudyReferenceTapeView: React.FC<{ measurerCode: string; onNavigate: (path: string) => void }> = ({
  measurerCode,
}) => {
  const ax = useAdminText();
  const [code, setCode] = useState('');
  const [readingNo, setReadingNo] = useState<1 | 2>(1);
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<AdminKey | null>(null);
  const [confirming, setConfirming] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);

  const countPending = useCallback(async () => {
    setPending((await vtStorage.queuedReadings(measurerCode).catch(() => [])).length);
  }, [measurerCode]);

  const flush = useCallback(async () => {
    for (const reading of await vtStorage.queuedReadings(measurerCode).catch(() => [])) {
      try {
        await send(reading);
        await vtStorage.removeQueuedReading(reading.id!);
      } catch (problem) {
        // Already saved (a retry after a lost reply): nothing left to send. Anything else stays queued.
        if (problem instanceof ApiError && problem.code === 'reading_locked') {
          await vtStorage.removeQueuedReading(reading.id!);
        } else break;
      }
    }
    await countPending();
  }, [measurerCode, countPending]);

  useEffect(() => {
    void flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [flush]);

  const values = Object.fromEntries(TAPE_SITES.map((site) => [site, tapeMm(entries[site] ?? '')]));
  const complete = /^P\d{3}$/.test(code) && TAPE_SITES.every((site) => values[site] !== null);

  const submit = async (confirmed: boolean) => {
    setError(null);
    if (!complete) return setError('checkFields');
    const outside = TAPE_SITES.filter((site) => {
      const cm = values[site]! / 10;
      return cm < TAPE_RANGE[site][0] || cm > TAPE_RANGE[site][1];
    });
    if (outside.length > 0 && !confirmed) return setConfirming(outside);
    setConfirming([]);
    const reading: QueuedReading = {
      participant_code: code,
      reading_no: readingNo,
      values: values as unknown as SiteValues,
      taken_at: new Date().toISOString(),
      measurer_code: measurerCode,
    };
    setBusy(true);
    try {
      const saved = await send(reading);
      setReceipt({ code: saved.participant_code, n: saved.reading_no, outOfOrder: saved.out_of_order });
      setEntries({});
    } catch (problem) {
      if (problem instanceof NetworkError) {
        await vtStorage.queueReading(reading);
        setReceipt({ queued: true });
        setEntries({});
        await countPending();
      } else {
        const notFound = problem instanceof ApiError && problem.code === 'not_found';
        setError(notFound ? 'notStudyParticipant' : problemKey(problem));
      }
    } finally {
      setBusy(false);
    }
  };

  if (receipt) {
    return (
      <Page title={ax('tapeTitle')}>
        <Card>
          <p role="status" className="text-base font-semibold">
            {'queued' in receipt
              ? ax('queued')
              : ax('savedReadings', { code: receipt.code, n: receipt.n, measurer: measurerCode })}
          </p>
          {'outOfOrder' in receipt && receipt.outOfOrder && <p className={hintClass}>{ax('outOfOrderNote')}</p>}
          <Button onClick={() => setReceipt(null)}>{ax('enterAnother')}</Button>
        </Card>
      </Page>
    );
  }

  return (
    <Page title={ax('tapeTitle')} intro={ax('tapeIntro', { code: measurerCode })}>
      {pending > 0 && (
        <div role="status" className="flex items-center justify-between gap-3 p-3 rounded-xl border border-amber-300 bg-amber-50">
          <span className="text-sm font-semibold">{ax('pendingCount', { n: pending })}</span>
          <Button size="sm" variant="outline" onClick={() => void flush()}>{ax('sendNow')}</Button>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(false);
        }}
        className="flex flex-col gap-4"
      >
        <Card>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="tape-code" className={labelClass}>{ax('participantCode')}</label>
              <input id="tape-code" value={code} maxLength={4} autoComplete="off" onChange={(e) => setCode(e.target.value.toUpperCase())} className={`${inputClass} font-mono`} />
            </div>
            <fieldset>
              <legend className={labelClass}>{ax('readingNumber')}</legend>
              <div className="flex gap-2">
                {([1, 2] as const).map((n) => (
                  <button key={n} type="button" aria-pressed={readingNo === n} className={chipClass(readingNo === n)} onClick={() => setReadingNo(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </Card>
        <Card>
          <ul className="flex flex-col gap-3" data-testid="tape-sites">
            {TAPE_SITES.map((site) => {
              const name = ax(`site_${site}` as AdminKey);
              const entered = entries[site] ?? '';
              const bad = entered !== '' && tapeMm(entered) === null;
              return (
                <li key={site}>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label htmlFor={`tape-${site}`} className={labelClass}>{name} (cm)</label>
                      <input
                        id={`tape-${site}`}
                        inputMode="decimal"
                        autoComplete="off"
                        aria-invalid={bad}
                        value={entered}
                        onChange={(e) => setEntries({ ...entries, [site]: e.target.value })}
                        className={`${inputClass} font-mono ${bad ? 'border-rose-500' : ''}`}
                      />
                    </div>
                    <button
                      type="button"
                      aria-expanded={open === site}
                      aria-label={ax('showHow', { site: name })}
                      onClick={() => setOpen(open === site ? null : site)}
                      className="min-h-[48px] min-w-[48px] rounded-xl border border-[var(--vt-line)] flex items-center justify-center cursor-pointer"
                    >
                      <Info aria-hidden="true" className="w-5 h-5" />
                    </button>
                  </div>
                  {open === site && <p className={`${hintClass} mt-1`}>{ax(`how_${site}` as AdminKey)}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
        {confirming.length > 0 && (
          <div role="alertdialog" aria-labelledby="tape-confirm" className="p-3 rounded-xl border border-amber-300 bg-amber-50 flex flex-col gap-2">
            <div id="tape-confirm">
              {confirming.map((site) => (
                <p key={site} className="text-sm font-semibold">
                  {ax('outOfRange', { value: (values[site]! / 10).toFixed(1), site: ax(`site_${site}` as AdminKey) })}
                </p>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void submit(true)}>{ax('yes')}</Button>
              <Button size="sm" variant="outline" onClick={() => setConfirming([])}>{ax('no')}</Button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-rose-700">{ax(error)}</p>}
        <Button type="submit" size="xl" className="w-full" disabled={busy || !complete}>{ax('submitReadings')}</Button>
      </form>
    </Page>
  );
};
