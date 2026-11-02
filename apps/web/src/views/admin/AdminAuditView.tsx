// The admin's audit log (frontend-spec 14.2): every account, filters, and a CSV the server writes and audits.
import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { AuditAction, hintClass, inputClass, labelClass, useDates, useLoad } from '../tailor/common';
import { AdminLoading, Page, saveText } from './adminCommon';
import { useAdminText } from './adminText';

// A record keyed by the contract's enum, so a new action fails the typecheck until it is listed here.
const EVERY: Record<AuditAction, true> = {
  register: true, login: true, login_failed: true, logout: true, settings_change: true,
  profile_ingest: true, client_code_claim: true, profile_view: true, deletion_request: true,
  access_request: true, deletion: true, code_issue: true, code_rotate: true, code_reset: true,
  retention: true, claim_review: true, client_update: true, conflict_resolve: true,
  order_create: true, order_update: true, order_delete: true, status_change: true, override: true,
  export: true, share: true, approve: true, account_reject: true, account_disable: true,
  account_enable: true, account_create: true, rules_register: true, rules_freeze: true,
  rederive: true, participant_create: true, participant_update: true, reference_entry: true,
  reference_correction: true,
};
const ACTIONS = Object.keys(EVERY) as AuditAction[];
const PAGE_SIZE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const AdminAuditView: React.FC<{ onNavigate: (path: string) => void }> = () => {
  const ax = useAdminText();
  const { time } = useDates();
  const [action, setAction] = useState<AuditAction | ''>('');
  const [entity, setEntity] = useState('');
  const [user, setUser] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pages, setPages] = useState(1);
  const [exportFailed, setExportFailed] = useState(false);
  const filters = {
    action: action || undefined,
    user: UUID.test(user.trim()) ? user.trim() : undefined,
    from: from ? `${from}T00:00:00+03:00` : undefined,
    to: to ? `${to}T23:59:59+03:00` : undefined,
  };
  const { data, failed, reload } = useLoad(
    () =>
      apiClient.get('/audit', {
        query: { ...filters, entity_type: entity.trim() || undefined, page_size: Math.min(100, PAGE_SIZE * pages) },
      }),
    [action, entity, user, from, to, pages],
  );

  const exportCsv = async () => {
    setExportFailed(false);
    try {
      const query = Object.fromEntries(Object.entries(filters).filter((pair): pair is [string, string] => !!pair[1]));
      saveText(await apiClient.text('/admin/audit.csv', query), 'audit.csv');
    } catch {
      setExportFailed(true);
    }
  };

  return (
    <Page title={ax('auditTitle')} intro={ax('auditIntro')}>
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="audit-action" className={labelClass}>{ax('auditAction')}</label>
          <select id="audit-action" value={action} onChange={(e) => setAction(e.target.value as AuditAction | '')} className={inputClass}>
            <option value="">{ax('auditAll')}</option>
            {ACTIONS.map((name) => <option key={name} value={name}>{name.replaceAll('_', ' ')}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="audit-entity" className={labelClass}>{ax('auditEntity')}</label>
          <input id="audit-entity" value={entity} maxLength={40} onChange={(e) => setEntity(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="audit-user" className={labelClass}>{ax('auditUser')}</label>
          <input id="audit-user" value={user} maxLength={36} onChange={(e) => setUser(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="audit-from" className={labelClass}>{ax('auditFrom')}</label>
          <input id="audit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="audit-to" className={labelClass}>{ax('auditTo')}</label>
          <input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </div>
        <div className="flex items-end">
          <Button variant="outline" className="w-full" icon={<Download className="w-4 h-4" />} onClick={() => void exportCsv()}>
            {ax('exportCsv')}
          </Button>
        </div>
      </div>
      {exportFailed && <p role="alert" className="text-sm text-rose-700">{ax('exportFailed')}</p>}
      {!data ? (
        <AdminLoading failed={failed} onRetry={() => void reload()} />
      ) : data.items.length === 0 ? (
        <p className="p-8 text-center text-sm rounded-2xl border border-[var(--vt-line)] bg-white">{ax('auditEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.items.map((row) => (
            <li key={row.log_id} className="p-3 rounded-xl border border-[var(--vt-line)] bg-white">
              <p className="text-sm font-semibold">{row.summary}</p>
              <p className={hintClass}>
                {time(row.occurred_at)} · {row.user_email ?? row.actor_type} · {row.action.replaceAll('_', ' ')} · {row.entity_type}
              </p>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > data.items.length && data.items.length < 100 && (
        <Button variant="outline" onClick={() => setPages((count) => count + 1)}>{ax('loadMore')}</Button>
      )}
    </Page>
  );
};
