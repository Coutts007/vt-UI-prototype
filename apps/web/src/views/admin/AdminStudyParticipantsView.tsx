// Participants (frontend-spec 15.1, A9): enrol by code only, see each one's completeness.
import React, { useState } from 'react';
import type { components } from '@vt/contracts';
import { Camera } from 'lucide-react';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { Card, chipClass, hintClass, inputClass, labelClass, useLoad } from '../tailor/common';
import { AdminLoading, ApprovalsBanner, Cohort, Page, Participant, isTaken, problemKey } from './adminCommon';
import { AdminKey, useAdminText } from './adminText';

type Sex = components['schemas']['Sex'];
type AgeBand = components['schemas']['AgeBand'];
const SEXES: { value: Sex; label: AdminKey }[] = [
  { value: 'female', label: 'sexFemale' },
  { value: 'male', label: 'sexMale' },
  { value: 'unspecified', label: 'sexUnspecified' },
];
const AGE_BANDS: AgeBand[] = ['18-24', '25-34', '35-44', '45-54', '55+'];
export const COHORT: Record<Cohort, AdminKey> = { pilot: 'cohortPilot', calibration: 'cohortCalibration', test: 'cohortTest' };

/** The next free P### after the highest one used. */
export function nextParticipantCode(rows: readonly { participant_code: string }[]): string {
  const highest = rows.reduce((top, row) => Math.max(top, Number(row.participant_code.slice(1)) || 0), 0);
  return `P${String(Math.min(highest + 1, 999)).padStart(3, '0')}`;
}

export const AdminStudyParticipantsView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const ax = useAdminText();
  const list = useLoad(() => apiClient.get('/study/participants'), []);
  const settings = useLoad(() => apiClient.get('/admin/settings'), []);
  const [code, setCode] = useState('');
  const [sex, setSex] = useState<Sex>('female');
  const [ageBand, setAgeBand] = useState<AgeBand>('25-34');
  const [venue, setVenue] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows: Participant[] = list.data ?? [];
  const suggested = nextParticipantCode(rows);
  const enrol = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const made = await apiClient.post('/study/participants', {
        body: { participant_code: code || suggested, sex, age_band: ageBand, venue: venue.trim() },
      });
      setNotice(ax('enrolled', { code: made.participant_code, cohort: ax(COHORT[made.cohort]), client: made.client_code }));
      setCode('');
      void list.reload();
    } catch (problem) {
      setNotice(ax(isTaken(problem) ? 'codeTaken' : problemKey(problem)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={ax('participantsTitle')} intro={ax('participantsIntro')}>
      <ApprovalsBanner missing={settings.data?.approvals_missing ?? []} />
      <Card>
        <form
          className="grid sm:grid-cols-2 gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void enrol();
          }}
        >
          <div>
            <label htmlFor="p-code" className={labelClass}>{ax('participantCode')}</label>
            <input
              id="p-code"
              value={code}
              placeholder={suggested}
              pattern="P[0-9]{3}"
              maxLength={4}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label htmlFor="p-age" className={labelClass}>{ax('ageBand')}</label>
            <select id="p-age" value={ageBand} onChange={(e) => setAgeBand(e.target.value as AgeBand)} className={inputClass}>
              {AGE_BANDS.map((band) => <option key={band} value={band}>{band}</option>)}
            </select>
          </div>
          <fieldset>
            <legend className={labelClass}>{ax('sex')}</legend>
            <div className="flex flex-wrap gap-2">
              {SEXES.map(({ value, label }) => (
                <button key={value} type="button" aria-pressed={sex === value} className={chipClass(sex === value)} onClick={() => setSex(value)}>
                  {ax(label)}
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="p-venue" className={labelClass}>{ax('venue')}</label>
            <input id="p-venue" value={venue} required maxLength={80} onChange={(e) => setVenue(e.target.value)} className={inputClass} />
          </div>
          <div className="sm:col-span-2 flex flex-col gap-2">
            {notice && <p role="status" className="text-sm font-semibold">{notice}</p>}
            <Button type="submit" disabled={busy || !venue.trim()}>{ax('enrol')}</Button>
          </div>
        </form>
      </Card>
      {!list.data ? (
        <AdminLoading failed={list.failed} onRetry={() => void list.reload()} />
      ) : rows.length === 0 ? (
        <p className={hintClass}>{ax('participantsEmpty')}</p>
      ) : (
        <ul className="rounded-2xl border border-[var(--vt-line)] bg-white divide-y divide-[var(--vt-line)]">
          {rows.map((row) => (
            <li key={row.participant_id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="font-bold">
                  <span className="font-mono">{row.participant_code}</span> · {ax(COHORT[row.cohort])}
                  {row.withdrawn && (
                    <span className="ml-2 px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-xs font-bold">{ax('withdrawn')}</span>
                  )}
                </p>
                <p className={hintClass}>
                  {row.age_band} · {row.venue} · {ax('setsCaptured', { n: row.sets_captured })} ·{' '}
                  {ax('readingsEntered', { n: row.readings_entered })}
                </p>
              </div>
              {!row.withdrawn && row.sets_captured < 3 && (
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Camera className="w-4 h-4" />}
                  onClick={() => onNavigate(`/study/capture?participant=${row.participant_code}`)}
                >
                  {ax('startCapture')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
};
