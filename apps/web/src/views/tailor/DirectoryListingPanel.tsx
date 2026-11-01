// The tailor's directory controls (D27), on the contract client. M9 moves the rest of Settings across.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '@vt/contracts';
import { ApiError } from '../../api/http';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { Checkbox, Field } from '../../components/ui/forms';
import { SPECIALTIES, Specialty, specialtyKey } from '../../config/specialties';
import { useI18n } from '../../i18n';
import { PanelKey, usePanelText } from './directoryPanelText';

type DirectoryClient = components['schemas']['DirectoryClient'];

const PAGE_SIZE = 25;
const CARD = 'p-6 rounded-2xl border border-[var(--vt-line)] bg-white shadow-2xs space-y-4';

export const DirectoryListingPanel: React.FC = () => {
  const { t: words } = useI18n();
  const t = usePanelText();
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<PanelKey | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listed, setListed] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [description, setDescription] = useState('');
  const [clients, setClients] = useState<DirectoryClient[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removeProblem, setRemoveProblem] = useState<PanelKey | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [unused, setUnused] = useState(0);
  const [confirmingUnused, setConfirmingUnused] = useState(false);
  const [removedCount, setRemovedCount] = useState<number | null>(null);
  const latest = useRef(0);

  // Only the last page asked for is shown. A page left empty by a removal falls back to the last one.
  const refreshClients = useCallback(async (wanted = 1): Promise<void> => {
    const ask = ++latest.current;
    const reply = await apiClient.get('/me/directory-clients', {
      query: { page: wanted, page_size: PAGE_SIZE },
    });
    if (ask !== latest.current) return;
    const last = Math.max(1, Math.ceil(reply.total / PAGE_SIZE));
    if (wanted > last) return refreshClients(last);
    setClients(reply.items);
    setPage(wanted);
    setTotal(reply.total);
    setUnused(reply.unused_total);
  }, []);

  useEffect(() => {
    let live = true;
    void Promise.all([apiClient.get('/me'), refreshClients()])
      .then(([me]) => {
        if (!live) return;
        setListed(me.directory_listed ?? false);
        setShowPhone(me.directory_show_phone ?? false);
        setSpecialties(me.directory_specialties ?? []);
        setDescription(me.directory_description ?? '');
        setReady(true);
      })
      .catch((error: unknown) => {
        if (!live) return;
        const signedOut = error instanceof ApiError && error.status === 401;
        setProblem(signedOut ? 'listingSignIn' : 'listingError');
      });
    return () => {
      live = false;
    };
  }, [refreshClients]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setProblem(null);
    try {
      await apiClient.patch('/me', {
        body: {
          directory_listed: listed,
          directory_show_phone: showPhone,
          directory_specialties: specialties,
          directory_description: description,
        },
      });
      setSaved(true);
    } catch {
      setProblem('listingError');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (client: DirectoryClient) => {
    setRemoveProblem(null);
    try {
      await apiClient.delete('/clients/{client_id}', { path: { client_id: client.client_id } });
      setConfirming(null);
      await refreshClients(page);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : '';
      setRemoveProblem(
        code === 'client_has_orders'
          ? 'directoryClientHasOrders'
          : code === 'client_records_retained'
            ? 'directoryClientRetained'
            : 'listingError',
      );
    }
  };

  const removeUnused = async () => {
    setRemoveProblem(null);
    setRemovedCount(null);
    try {
      const reply = await apiClient.post('/me/directory-clients/remove-unused');
      setConfirmingUnused(false);
      setRemovedCount(reply.removed);
      await refreshClients(page);
    } catch {
      setRemoveProblem('listingError');
    }
  };

  const turnTo = async (wanted: number) => {
    setRemoveProblem(null);
    setConfirming(null);
    try {
      await refreshClients(wanted);
    } catch {
      setRemoveProblem('listingError');
    }
  };

  const pages = Math.ceil(total / PAGE_SIZE);

  if (!ready) {
    return (
      <section className={CARD} aria-labelledby="listing-title">
        <h2 id="listing-title" className="text-lg font-bold">
          {t('listingTitle')}
        </h2>
        {problem && <p role="alert">{t(problem)}</p>}
      </section>
    );
  }

  return (
    <>
      <section className={CARD} aria-labelledby="listing-title">
        <h2 id="listing-title" className="text-lg font-bold">
          {t('listingTitle')}
        </h2>
        <p className="text-sm">{t('listingIntro')}</p>
        <Checkbox label={t('listingOptIn')} checked={listed} onChange={setListed} />
        <Checkbox label={t('listingShowPhone')} checked={showPhone} onChange={setShowPhone} />
        <fieldset>
          <legend className="font-semibold">{t('listingSpecialties')}</legend>
          <div className="grid sm:grid-cols-2">
            {SPECIALTIES.map((value) => (
              <Checkbox
                key={value}
                label={words(specialtyKey(value))}
                checked={specialties.includes(value)}
                onChange={(on) =>
                  setSpecialties((old) => (on ? [...old, value] : old.filter((item) => item !== value)))
                }
              />
            ))}
          </div>
        </fieldset>
        <Field label={t('listingDescription')} hint={t('listingDescriptionHint')}>
          {(field) => (
            <textarea
              {...field}
              rows={3}
              maxLength={240}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full p-3 rounded-xl border border-[var(--vt-line)] bg-white"
            />
          )}
        </Field>
        <Button size="lg" loading={saving} onClick={() => void save()}>
          {t('listingSave')}
        </Button>
        <p role="status" className="text-sm font-medium min-h-5">
          {saved ? t('listingSaved') : ''}
        </p>
        {problem && (
          <p role="alert" className="text-sm font-medium text-[var(--vt-fail)]">
            {t(problem)}
          </p>
        )}
      </section>

      <section className={CARD} aria-labelledby="directory-clients-title">
        <h2 id="directory-clients-title" className="text-lg font-bold">
          {t('directoryClientsTitle')}
        </h2>
        <p className="text-sm">{t('directoryClientsHint')}</p>
        {clients.length === 0 && <p className="text-sm">{t('directoryClientsEmpty')}</p>}
        {unused > 0 &&
          (confirmingUnused ? (
            <div role="alert" className="flex flex-col gap-2 text-sm font-medium">
              <p>{t('directoryClientsRemoveUnusedWarning')}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" size="md" onClick={() => void removeUnused()}>
                  {t('directoryClientsRemoveUnusedConfirm', { count: unused })}
                </Button>
                <Button variant="outline" size="md" onClick={() => setConfirmingUnused(false)}>
                  {words('cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="md" onClick={() => setConfirmingUnused(true)}>
              {t('directoryClientsRemoveUnused', { count: unused })}
            </Button>
          ))}
        <p role="status" className="text-sm font-medium">
          {removedCount === null ? '' : t('directoryClientsRemovedUnused', { count: removedCount })}
        </p>
        {removeProblem && (
          <p role="alert" className="text-sm font-medium text-[var(--vt-fail)]">
            {t(removeProblem)}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {clients.map((client) => (
            <li
              key={client.client_id}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--vt-line)] pt-2"
            >
              <span>
                <span className="font-mono font-bold">{client.client_code}</span>{' '}
                <span className="text-sm">
                  {t(client.has_profile ? 'directoryClientUsed' : 'directoryClientUnused')}
                </span>
              </span>
              {confirming === client.client_id ? (
                <div className="w-full flex flex-col gap-2">
                  {client.has_profile && (
                    <p role="alert" className="text-sm font-bold text-[var(--vt-fail)]">
                      {t('directoryClientMeasuredWarning', { code: client.client_code })}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="danger" size="md" onClick={() => void remove(client)}>
                      {t(client.has_profile ? 'directoryClientMeasuredConfirm' : 'directoryClientConfirm', {
                        code: client.client_code,
                      })}
                    </Button>
                    <Button variant="outline" size="md" onClick={() => setConfirming(null)}>
                      {words('cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="md"
                  aria-label={`${t('directoryClientRemove')}: ${client.client_code}`}
                  onClick={() => setConfirming(client.client_id)}
                >
                  {t('directoryClientRemove')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {pages > 1 && (
          <nav aria-label={t('directoryClientsTitle')} className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="md" disabled={page <= 1} onClick={() => void turnTo(page - 1)}>
              {t('directoryClientsPrevious')}
            </Button>
            <span className="text-sm">{t('directoryClientsPage', { page, pages })}</span>
            <Button variant="outline" size="md" disabled={page >= pages} onClick={() => void turnTo(page + 1)}>
              {t('directoryClientsNext')}
            </Button>
          </nav>
        )}
      </section>
    </>
  );
};
