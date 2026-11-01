import React, { useState } from 'react';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { AuditAction, hintClass, inputClass, labelClass, Loading, Title, useDates, useLoad } from './common';
import { useTailorText } from './tailorText';

const ACTIONS: AuditAction[] = [
  'login', 'profile_view', 'code_issue', 'code_rotate', 'code_reset', 'claim_review', 'client_update',
  'conflict_resolve', 'order_create', 'order_update', 'order_delete', 'status_change', 'override',
  'export', 'share', 'deletion', 'settings_change',
];
const PAGE_SIZE = 25;

export const AuditView: React.FC<{ onNavigate: (path: string) => void }> = () => {
  const tx = useTailorText();
  const { time } = useDates();
  const [action, setAction] = useState<AuditAction | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pages, setPages] = useState(1);
  const { data, failed, reload } = useLoad(
    () =>
      apiClient.get('/audit', {
        query: {
          action: action || undefined,
          from: from ? `${from}T00:00:00+03:00` : undefined,
          to: to ? `${to}T23:59:59+03:00` : undefined,
          page_size: PAGE_SIZE * pages,
        },
      }),
    [action, from, to, pages],
  );

  return (
    <div className="flex flex-col gap-4 max-w-4xl mx-auto">
      <div>
        <Title>{tx('auditTitle')}</Title>
        <p className={hintClass}>{tx('auditIntro')}</p>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="audit-action" className={labelClass}>{tx('auditAction')}</label>
          <select id="audit-action" value={action} onChange={(e) => setAction(e.target.value as AuditAction | '')} className={inputClass}>
            <option value="">{tx('auditAll')}</option>
            {ACTIONS.map((name) => <option key={name} value={name}>{name.replaceAll('_', ' ')}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="audit-from" className={labelClass}>{tx('auditFrom')}</label>
          <input id="audit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="audit-to" className={labelClass}>{tx('auditTo')}</label>
          <input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </div>
      </div>
      {!data ? (
        <Loading failed={failed} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <p className="p-8 text-center text-sm rounded-2xl border border-[var(--vt-line)] bg-white">{tx('auditEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.items.map((row) => (
            <li key={row.log_id} className="p-3 rounded-xl border border-[var(--vt-line)] bg-white">
              <p className="text-sm font-semibold">{row.summary}</p>
              <p className={hintClass}>{time(row.occurred_at)} · {row.entity_type}</p>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > data.items.length && (
        <Button variant="outline" onClick={() => setPages((count) => count + 1)}>{tx('loadMore')}</Button>
      )}
    </div>
  );
};
