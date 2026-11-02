// Admin settings (frontend-spec 14.3, A9): retention, study mode, rules, approvals and the deletion queue.
import React, { useEffect, useState } from 'react';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { Card, hintClass, inputClass, labelClass, useDates, useLoad } from '../tailor/common';
import { AdminLoading, AdminSettings, Approvals, DeletionRequest, Page, problemKey } from './adminCommon';
import { AdminKey, useAdminText } from './adminText';

/** App listens for this, so the study screens appear or go without a reload. */
export const STUDY_MODE_EVENT = 'vt:study-mode';

const APPROVAL_FIELDS: { key: keyof Approvals; label: AdminKey; type: 'text' | 'date' }[] = [
  { key: 'ierc_ref', label: 'ierc', type: 'text' },
  { key: 'nacosti_licence_no', label: 'nacosti', type: 'text' },
  { key: 'dpia_submitted_on', label: 'dpiaSubmitted', type: 'date' },
  { key: 'approvals_confirmed_by', label: 'confirmedBy', type: 'text' },
  { key: 'confirmed_at', label: 'confirmedAt', type: 'date' },
  { key: 'odpc_response_on', label: 'odpcOn', type: 'date' },
  { key: 'odpc_response_ref', label: 'odpcRef', type: 'text' },
];
const STATUS: Record<DeletionRequest['status'], AdminKey> = {
  received: 'statusReceived',
  partially_done: 'statusPartial',
  done: 'statusDone',
  rejected: 'statusRejected',
};

type Form = Omit<AdminSettings, 'approvals_missing' | 'earliest_collection_date' | 'consent_version'>;

export const AdminSettingsView: React.FC<{ onNavigate: (path: string) => void }> = () => {
  const ax = useAdminText();
  const { date } = useDates();
  const settings = useLoad(() => apiClient.get('/admin/settings'), []);
  const deletions = useLoad(() => apiClient.get('/admin/deletion-requests'), []);
  const [form, setForm] = useState<Form | null>(null);
  const [notice, setNotice] = useState<AdminKey | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    const { approvals_missing: _m, earliest_collection_date: _e, consent_version: _c, ...rest } = settings.data;
    setForm(rest);
  }, [settings.data]);

  if (!settings.data || !form) return <AdminLoading failed={settings.failed} onRetry={() => void settings.reload()} />;
  const current = settings.data;

  const save = async () => {
    if (form.study_mode !== current.study_mode) {
      if (!window.confirm(ax(form.study_mode ? 'studyModeOnConfirm' : 'studyModeOffConfirm'))) return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const approvals = Object.fromEntries(
        Object.entries(form.approvals).map(([key, value]) => [key, value ? value : null]),
      ) as Approvals;
      // The contract keeps a time on confirmed_at; the screen asks for the day only.
      if (approvals.confirmed_at && approvals.confirmed_at.length === 10) {
        approvals.confirmed_at = `${approvals.confirmed_at}T00:00:00+03:00`;
      }
      const saved = await apiClient.put('/admin/settings', { body: { ...form, approvals } });
      settings.setData(saved);
      if (saved.study_mode !== current.study_mode) {
        window.dispatchEvent(new CustomEvent(STUDY_MODE_EVENT, { detail: saved.study_mode }));
      }
      setNotice('saved');
    } catch (problem) {
      setNotice(problemKey(problem));
    } finally {
      setBusy(false);
    }
  };

  const honour = async (request: DeletionRequest) => {
    if (!window.confirm(ax('deletionHonourConfirm', { code: request.client_code ?? '' }))) return;
    try {
      await apiClient.post('/admin/deletion-requests/{request_id}/honour', { path: { request_id: request.request_id } });
    } catch (problem) {
      setNotice(problemKey(problem));
    }
    void deletions.reload();
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value });
  const number = (key: 'retention_months' | 'audit_retention_months', label: AdminKey, min: number) => (
    <div>
      <label htmlFor={`set-${key}`} className={labelClass}>{ax(label)}</label>
      <input
        id={`set-${key}`}
        type="number"
        min={min}
        max={120}
        value={form[key]}
        onChange={(e) => set(key, Number(e.target.value))}
        className={inputClass}
      />
    </div>
  );

  return (
    <Page title={ax('settingsTitle')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Card>
          <div className="grid sm:grid-cols-2 gap-3">
            {number('retention_months', 'retentionMonths', 1)}
            {number('audit_retention_months', 'auditMonths', 12)}
            <div>
              <label htmlFor="set-rules" className={labelClass}>{ax('rulesVersion')}</label>
              <input id="set-rules" value={form.current_rules_version} maxLength={40} onChange={(e) => set('current_rules_version', e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="set-app" className={labelClass}>{ax('minAppVersion')}</label>
              <input id="set-app" value={form.min_app_version} maxLength={32} onChange={(e) => set('min_app_version', e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="set-consent" className={labelClass}>{ax('consentVersion')}</label>
              <input id="set-consent" value={current.consent_version} readOnly className={`${inputClass} bg-[var(--vt-paper)]`} />
            </div>
          </div>
        </Card>
        <Card title={ax('studyMode')}>
          <p className={hintClass}>{ax('studyModeExplain')}</p>
          <label className="flex items-center gap-3 min-h-[48px] cursor-pointer">
            <input type="checkbox" className="w-5 h-5" checked={form.study_mode} onChange={(e) => set('study_mode', e.target.checked)} />
            <span className="text-sm font-semibold">{ax('studyMode')}</span>
          </label>
          <div>
            <label htmlFor="set-end" className={labelClass}>{ax('collectionEnd')}</label>
            <input
              id="set-end"
              type="date"
              value={form.study_collection_end ?? ''}
              onChange={(e) => set('study_collection_end', e.target.value || null)}
              className={inputClass}
            />
          </div>
        </Card>
        <Card title={ax('approvalsTitle')}>
          <p className={hintClass}>{ax('approvalsIntro')}</p>
          {current.approvals_missing.length > 0 ? (
            <p role="alert" className="p-3 rounded-xl border border-amber-300 bg-amber-50 text-sm text-amber-900">
              {ax('approvalsMissing', { fields: current.approvals_missing.join(', ') })}
            </p>
          ) : (
            current.earliest_collection_date && (
              <p role="status" className="p-3 rounded-xl border border-emerald-300 bg-emerald-50 text-sm text-emerald-900">
                {ax('approvalsReady', { date: date(current.earliest_collection_date) })}
              </p>
            )
          )}
          {current.approvals_missing.length > 0 && current.earliest_collection_date && (
            <p className={hintClass}>{ax('approvalsWaiting', { date: date(current.earliest_collection_date) })}</p>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            {APPROVAL_FIELDS.map(({ key, label, type }) => (
              <div key={key}>
                <label htmlFor={`approval-${key}`} className={labelClass}>{ax(label)}</label>
                <input
                  id={`approval-${key}`}
                  type={type}
                  maxLength={80}
                  value={(type === 'date' ? form.approvals[key]?.slice(0, 10) : form.approvals[key]) ?? ''}
                  onChange={(e) => set('approvals', { ...form.approvals, [key]: e.target.value })}
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        </Card>
        {notice && (
          <p role={notice === 'saved' ? 'status' : 'alert'} className="text-sm font-semibold">
            {ax(notice)}
          </p>
        )}
        <Button type="submit" disabled={busy}>{ax('save')}</Button>
      </form>

      <Card title={ax('deletionsTitle')}>
        {!deletions.data ? (
          <AdminLoading failed={deletions.failed} onRetry={() => void deletions.reload()} />
        ) : deletions.data.length === 0 ? (
          <p className={hintClass}>{ax('deletionsEmpty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--vt-line)]">
            {deletions.data.map((request) => (
              <li key={request.request_id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    <span className="font-mono">{request.client_code ?? '—'}</span> ·{' '}
                    {ax(request.reason === 'withdraw_consent' ? 'reasonWithdraw' : 'reasonDelete')} · {ax(STATUS[request.status])}
                  </p>
                  <p className={hintClass}>{ax('deletionReceived', { date: date(request.received_at) })}</p>
                </div>
                {request.client_code && (request.status === 'received' || request.status === 'partially_done') && (
                  <Button size="sm" variant="danger" onClick={() => void honour(request)}>
                    {ax('deletionHonour')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
};
