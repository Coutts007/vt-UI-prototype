import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Copy, MapPin, Phone, Search } from 'lucide-react';
import type { components } from '@vt/contracts';
import { ApiError } from '../../api/http';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { Field, Select } from '../../components/ui/forms';
import { SPECIALTIES, Specialty, specialtyKey } from '../../config/specialties';
import { vtStorage } from '../../db/storage';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';

type Listing = components['schemas']['TailorListing'];
type Issued = components['schemas']['DirectoryCodeIssued'];

const PAGE_SIZE = 20;
const CARD = 'rounded-2xl border border-[var(--vt-line)] bg-white p-4';

const CodeCard: React.FC<{ issued: Issued; onBack: () => void; onNavigate: (path: string) => void }> = ({
  issued,
  onBack,
  onNavigate,
}) => {
  const { t } = useI18n();
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle');

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(issued.client_code);
      setCopy('done');
    } catch {
      setCopy('failed');
    }
  };

  return (
    <main className="max-w-xl mx-auto w-full px-4 py-6 flex flex-col gap-4">
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
        {t('directoryCodeFor', { name: issued.tailor_business_name })}
      </h1>
      <p data-testid="issued-code" className={`${CARD} text-center text-4xl font-mono font-bold tracking-widest`}>
        {issued.client_code}
      </p>
      <p className="text-sm">{t('directoryCodeNote')}</p>
      <Button
        variant="outline"
        size="lg"
        onClick={() => void copyCode()}
        icon={copy === 'done' ? <Check aria-hidden="true" className="w-4 h-4" /> : <Copy aria-hidden="true" className="w-4 h-4" />}
      >
        {t('directoryCopy')}
      </Button>
      <p role="status" className="text-sm font-medium min-h-5">
        {copy === 'done' ? t('directoryCopied') : copy === 'failed' ? t('directoryCopyFailed') : ''}
      </p>
      <Button
        size="xl"
        className="w-full"
        onClick={() => onNavigate(`/start?code=${issued.client_code}`)}
        icon={<ArrowRight aria-hidden="true" className="w-5 h-5" />}
      >
        {t('continue')}
      </Button>
      <Button variant="text" size="lg" onClick={onBack}>
        {t('directoryBack')}
      </Button>
    </main>
  );
};

export const BusinessDirectoryView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [words, setWords] = useState('');
  const [specialty, setSpecialty] = useState<Specialty | ''>('');
  const [area, setArea] = useState('');
  const [rows, setRows] = useState<Listing[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [issuing, setIssuing] = useState<string | null>(null);
  const [issueError, setIssueError] = useState<{ id: string; key: TranslationKey } | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setWords(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const ask = ++latest.current;
    if (page === 1) setState('loading');
    apiClient
      .get('/tailors', {
        query: { search: words, area, specialty: specialty || undefined, page, page_size: PAGE_SIZE },
      })
      .then((reply) => {
        if (ask !== latest.current) return;
        setRows((old) => (page === 1 ? reply.items : [...old, ...reply.items]));
        setTotal(reply.total);
        setAreas(reply.areas);
        setState('ready');
      })
      .catch(() => {
        if (ask === latest.current) setState('failed');
      });
  }, [words, area, specialty, page, attempt]);

  const getCode = async (listing: Listing) => {
    setIssuing(listing.listing_id);
    setIssueError(null);
    try {
      const reply = await apiClient.post('/tailors/{listing_id}/codes', {
        path: { listing_id: listing.listing_id },
      });
      // Read the phone's draft first, because getDraft alone is empty after a reload.
      // A new code is a new tailor, so consent given for the last one does not carry over.
      const { consent: _earlier, ...draft } = await vtStorage.loadDraft();
      await vtStorage.saveDraft({ ...draft, client_code: reply.client_code, code_verified: true });
      setIssued(reply);
      window.scrollTo(0, 0);
    } catch (error) {
      const limited = error instanceof ApiError && error.status === 429;
      setIssueError({ id: listing.listing_id, key: limited ? 'directoryRateLimited' : 'directoryIssueError' });
    } finally {
      setIssuing(null);
    }
  };

  if (issued) return <CodeCard issued={issued} onBack={() => setIssued(null)} onNavigate={onNavigate} />;

  return (
    <main className="max-w-3xl mx-auto w-full px-4 py-6 flex flex-col gap-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t('directoryTitle')}</h1>
        <p className="mt-1">{t('directorySubtitle')}</p>
      </div>

      <div className={`${CARD} flex flex-col gap-3`}>
        <Field label={t('directorySearch')}>
          {(field) => (
            <div className="relative">
              <Search aria-hidden="true" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                {...field}
                type="search"
                maxLength={60}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full h-12 pl-9 pr-3 rounded-xl border border-[var(--vt-line)] bg-white"
              />
            </div>
          )}
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('directorySpecialty')}>
            {(field) => (
              <Select
                {...field}
                value={specialty}
                onChange={(event) => {
                  setSpecialty(event.target.value as Specialty | '');
                  setPage(1);
                }}
              >
                <option value="">{t('directoryAll')}</option>
                {SPECIALTIES.map((value) => (
                  <option key={value} value={value}>
                    {t(specialtyKey(value))}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('directoryArea')}>
            {(field) => (
              <Select
                {...field}
                value={area}
                onChange={(event) => {
                  setArea(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">{t('directoryAll')}</option>
                {areas.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>

      {state === 'loading' && <Skeleton />}
      {state === 'failed' && (
        <ErrorState message={t('directoryLoadError')} onRetry={() => setAttempt((n) => n + 1)} />
      )}
      {state === 'ready' && rows.length === 0 && <EmptyState title={t('directoryEmpty')} />}
      {state !== 'loading' && rows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.listing_id} className={`${CARD} flex flex-col gap-2`}>
              <h2 className="text-lg font-bold">{row.business_name}</h2>
              {row.area && (
                <p className="flex items-center gap-1.5 text-sm">
                  <MapPin aria-hidden="true" className="w-4 h-4 shrink-0" />
                  {row.area}
                </p>
              )}
              {row.specialties.length > 0 && (
                <p className="text-sm font-medium">
                  {row.specialties.map((value) => t(specialtyKey(value))).join(', ')}
                </p>
              )}
              {row.description && <p className="text-sm">{row.description}</p>}
              {row.phone && (
                <a
                  href={`tel:${row.phone}`}
                  className="inline-flex items-center gap-1.5 min-h-12 text-sm font-medium underline"
                >
                  <Phone aria-hidden="true" className="w-4 h-4 shrink-0" />
                  {row.phone}
                </a>
              )}
              {issueError?.id === row.listing_id && (
                <p role="alert" className="text-sm font-medium text-[var(--vt-fail)]">
                  {t(issueError.key)}
                </p>
              )}
              <Button
                size="lg"
                className="w-full sm:w-auto sm:self-start"
                loading={issuing === row.listing_id}
                disabled={issuing !== null}
                aria-label={`${t('directoryGetCode')}: ${row.business_name}`}
                onClick={() => void getCode(row)}
              >
                {t('directoryGetCode')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {state === 'ready' && rows.length < total && (
        <Button variant="outline" size="lg" onClick={() => setPage((n) => n + 1)}>
          {t('directoryMore')}
        </Button>
      )}
    </main>
  );
};
