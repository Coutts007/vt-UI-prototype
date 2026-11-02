import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import {
  chipClass,
  ClientSummary,
  hintClass,
  inputClass,
  labelClass,
  Loading,
  rowClass,
  StaleNote,
  Title,
  useDates,
  useLoad,
} from './common';
import { useTailorText } from './tailorText';

type Filter = 'has_new' | 'has_flags' | 'no_profiles';
type Sort = 'last_capture' | 'code' | 'name';
const PAGE_SIZE = 25;

export const ClientListView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const tx = useTailorText();
  const { date } = useDates();
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter | undefined>();
  const [sort, setSort] = useState<Sort>('last_capture');
  const [pages, setPages] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(typed.trim());
      setPages(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);

  const { data, failed, reload, updatedAt } = useLoad(
    () =>
      apiClient.get('/clients', {
        query: { search: search || undefined, filter, sort, page: 1, page_size: PAGE_SIZE * pages },
      }),
    [search, filter, sort, pages],
  );

  const filters: [Filter | undefined, string][] = [
    [undefined, tx('filterAll')],
    ['has_new', tx('filterHasNew')],
    ['has_flags', tx('filterHasFlags')],
    ['no_profiles', tx('filterNoProfiles')],
  ];
  const rows: ClientSummary[] = data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <Title>{tx('clientsTitle')}</Title>
          <p className={hintClass}>{tx('clientsIntro')}</p>
        </div>
        <Button onClick={() => onNavigate('/t/clients/new')} icon={<Plus aria-hidden="true" className="w-4 h-4" />}>
          {tx('newCode')}
        </Button>
      </div>

      <div className="grid sm:grid-cols-[1fr_auto] gap-3">
        <div>
          <label htmlFor="client-search" className={labelClass}>
            {tx('searchClients')}
          </label>
          <input
            id="client-search"
            type="search"
            maxLength={60}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="client-sort" className={labelClass}>
            {tx('sortBy')}
          </label>
          <select
            id="client-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            className={inputClass}
          >
            <option value="last_capture">{tx('sortLastCapture')}</option>
            <option value="code">{tx('sortCode')}</option>
            <option value="name">{tx('sortName')}</option>
          </select>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {filters.map(([id, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={filter === id}
            onClick={() => {
              setFilter(id);
              setPages(1);
            }}
            className={chipClass(filter === id)}
          >
            {label}
          </button>
        ))}
      </div>

      <StaleNote failed={failed} updatedAt={updatedAt} />
      {!data ? (
        <Loading failed={failed} onRetry={reload} />
      ) : rows.length === 0 ? (
        <p className="p-8 text-center text-sm rounded-2xl border border-[var(--vt-line)] bg-white">
          {search || filter ? tx('clientsNoMatch') : tx('clientsEmpty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.client_id}>
              <button type="button" onClick={() => onNavigate(`/t/clients/${row.client_id}`)} className={rowClass}>
                <span className="min-w-0">
                  <span className="font-mono font-bold text-lg text-[var(--vt-thread)] mr-2">{row.client_code}</span>
                  <span className="text-sm font-semibold">{row.display_name || tx('anonymous')}</span>
                  <span className={`block ${hintClass}`}>
                    {row.last_capture_at ? tx('lastCapture', { date: date(row.last_capture_at) }) : tx('noCapture')}
                    {' · '}
                    {tx('openOrders', { count: row.open_orders })}
                  </span>
                  <span className="flex flex-wrap gap-2 mt-1 text-xs font-semibold">
                    {row.flag_counts && row.flag_counts.check + row.flag_counts.fail > 0 && (
                      <span className="inline-flex items-center gap-1 text-amber-800">
                        <AlertTriangle aria-hidden="true" className="w-3 h-3" />
                        {tx('flagsSummary', { check: row.flag_counts.check, fail: row.flag_counts.fail })}
                      </span>
                    )}
                    {row.has_new && <span className="text-emerald-800">{tx('newMeasurements')}</span>}
                    {row.has_conflict && (
                      <span className="inline-flex items-center gap-1 text-sky-800">
                        <RefreshCw aria-hidden="true" className="w-3 h-3" />
                        {tx('conflictTag')}
                      </span>
                    )}
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className="w-5 h-5 shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > rows.length && (
        <Button variant="outline" onClick={() => setPages((count) => count + 1)}>
          {tx('loadMore')}
        </Button>
      )}
    </div>
  );
};
