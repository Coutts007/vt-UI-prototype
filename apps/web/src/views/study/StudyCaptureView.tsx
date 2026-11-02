// Study capture (frontend-spec 15.1): the researcher sets one participant's set, then runs the client flow.
// The draft carries the study block and the paper consent; the server accepts that consent only with it.
import React, { useMemo, useState } from 'react';
import type { components } from '@vt/contracts';
import { ArrowRight } from 'lucide-react';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { vtStorage } from '../../db/storage';
import { useI18n } from '../../i18n';
import { ApprovalsBanner, AdminLoading, Page } from '../admin/adminCommon';
import { AdminKey, useAdminText } from '../admin/adminText';
import { Card, chipClass, inputClass, labelClass, useLoad } from '../tailor/common';

type Lighting = components['schemas']['StudyBlock']['lighting'];
type Fit = components['schemas']['ClothingFit'];
const LIGHTS: { value: Lighting; label: AdminKey }[] = [
  { value: 'window', label: 'lightWindow' },
  { value: 'lamp', label: 'lightLamp' },
  { value: 'outdoor', label: 'lightOutdoor' },
];
export const STUDY_CONSENT_VERSION = 'study-paper-1.0';

export const StudyCaptureView: React.FC<{ initialParticipantCode?: string; onNavigate: (path: string) => void }> = ({
  initialParticipantCode,
  onNavigate,
}) => {
  const ax = useAdminText();
  const { locale } = useI18n();
  const list = useLoad(() => apiClient.get('/study/participants'), []);
  const settings = useLoad(() => apiClient.get('/admin/settings'), []);
  const [code, setCode] = useState(initialParticipantCode ?? '');
  const [setNo, setSetNo] = useState(1);
  const [mode, setMode] = useState<'self' | 'assisted'>('self');
  const [lighting, setLighting] = useState<Lighting>('window');
  const [distance, setDistance] = useState('2.2');
  const [fit, setFit] = useState<Fit>('fitted');
  const [stature, setStature] = useState('');
  const [lux, setLux] = useState('');
  const [paper, setPaper] = useState(false);
  const [error, setError] = useState<AdminKey | null>(null);

  const participant = useMemo(() => list.data?.find((row) => row.participant_code === code), [list.data, code]);
  // The next set this participant has not done yet, once the code is known.
  const [seenCode, setSeenCode] = useState('');
  if (participant && seenCode !== participant.participant_code) {
    setSeenCode(participant.participant_code);
    setSetNo(Math.min(3, participant.sets_captured + 1));
  }

  if (!list.data) return <AdminLoading failed={list.failed} onRetry={() => void list.reload()} />;

  const start = async () => {
    const distanceM = Number(distance);
    const statureCm = Number(stature);
    const luxValue = lux.trim() === '' ? undefined : Math.round(Number(lux));
    if (!participant) return setError('unknownParticipant');
    if (participant.withdrawn) return setError('participantWithdrew');
    const valid =
      distanceM >= 1.5 && distanceM <= 3.5 && statureCm >= 100 && statureCm <= 250 &&
      (luxValue === undefined || (luxValue >= 0 && luxValue <= 200000));
    if (!valid || !paper) return setError('checkFields');
    await vtStorage.saveDraft({
      language: locale,
      client_code: participant.client_code,
      code_verified: true,
      height_mm: Math.round(statureCm * 10),
      sex: participant.sex,
      clothing_fit: fit,
      capture_mode: mode,
      consent: {
        consent_version: STUDY_CONSENT_VERSION,
        language: locale,
        scope: ['study_paper', 'measure', 'measurements_only'],
        given_at: new Date().toISOString(),
      },
      study: {
        participant_code: participant.participant_code,
        set_no: setNo,
        lighting,
        distance_m: Math.round(distanceM * 100) / 100,
        clothing_fit_observed: fit,
        ...(luxValue !== undefined && { lux: luxValue }),
      },
    });
    onNavigate('/check');
  };

  return (
    <Page title={ax('captureTitle')} intro={ax('captureIntro')}>
      <ApprovalsBanner missing={settings.data?.approvals_missing ?? []} />
      <Card>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="sc-code" className={labelClass}>{ax('participantCode')}</label>
            <input
              id="sc-code"
              value={code}
              maxLength={4}
              list="sc-codes"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className={`${inputClass} font-mono`}
            />
            <datalist id="sc-codes">
              {list.data.filter((row) => !row.withdrawn).map((row) => <option key={row.participant_id} value={row.participant_code} />)}
            </datalist>
          </div>
          <fieldset>
            <legend className={labelClass}>{ax('setNumber')}</legend>
            <div className="flex gap-2">
              {[1, 2, 3].map((n) => (
                <button key={n} type="button" aria-pressed={setNo === n} className={chipClass(setNo === n)} onClick={() => setSetNo(n)}>
                  {n}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className={labelClass}>{ax('captureMode')}</legend>
            <div className="flex gap-2">
              {(['self', 'assisted'] as const).map((value) => (
                <button key={value} type="button" aria-pressed={mode === value} className={chipClass(mode === value)} onClick={() => setMode(value)}>
                  {ax(value === 'self' ? 'modeSelf' : 'modeAssisted')}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className={labelClass}>{ax('lighting')}</legend>
            <div className="flex flex-wrap gap-2">
              {LIGHTS.map(({ value, label }) => (
                <button key={value} type="button" aria-pressed={lighting === value} className={chipClass(lighting === value)} onClick={() => setLighting(value)}>
                  {ax(label)}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className={labelClass}>{ax('clothingFit')}</legend>
            <div className="flex gap-2">
              {(['fitted', 'loose'] as const).map((value) => (
                <button key={value} type="button" aria-pressed={fit === value} className={chipClass(fit === value)} onClick={() => setFit(value)}>
                  {ax(value === 'fitted' ? 'fitFitted' : 'fitLoose')}
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="sc-distance" className={labelClass}>{ax('distance')}</label>
            <input id="sc-distance" type="number" inputMode="decimal" step="0.1" min={1.5} max={3.5} value={distance} onChange={(e) => setDistance(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="sc-stature" className={labelClass}>{ax('statureCm')}</label>
            <input id="sc-stature" type="number" inputMode="decimal" step="0.1" min={100} max={250} value={stature} onChange={(e) => setStature(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="sc-lux" className={labelClass}>{ax('lux')}</label>
            <input id="sc-lux" type="number" inputMode="numeric" min={0} value={lux} onChange={(e) => setLux(e.target.value)} className={inputClass} />
          </div>
        </div>
        <label className="flex items-center gap-3 min-h-[48px] cursor-pointer">
          <input type="checkbox" className="w-5 h-5" checked={paper} onChange={(e) => setPaper(e.target.checked)} />
          <span className="text-sm font-semibold">{ax('paperConsent', { code: code || '—' })}</span>
        </label>
        {participant?.withdrawn && <p role="alert" className="text-sm text-rose-700">{ax('participantWithdrew')}</p>}
        {error && <p role="alert" className="text-sm text-rose-700">{ax(error)}</p>}
      </Card>
      <Button size="xl" className="w-full" disabled={!paper} icon={<ArrowRight className="w-5 h-5" />} onClick={() => void start()}>
        {ax('startStudyCapture')}
      </Button>
    </Page>
  );
};
