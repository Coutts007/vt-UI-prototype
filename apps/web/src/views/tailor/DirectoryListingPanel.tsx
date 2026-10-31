// The tailor's directory controls (D27), on the contract client. M9 moves the rest of Settings across.
import React, { useCallback, useEffect, useState } from 'react';
import type { components } from '@vt/contracts';
import { ApiError } from '../../api/http';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { Checkbox, Field } from '../../components/ui/forms';
import { SPECIALTIES, Specialty, specialtyKey } from '../../config/specialties';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';

type DirectoryClient = components['schemas']['DirectoryClient'];

const CARD = 'p-6 rounded-2xl border border-[var(--vt-line)] bg-white shadow-2xs space-y-4';

export const DirectoryListingPanel: React.FC = () => {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<TranslationKey | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listed, setListed] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [description, setDescription] = useState('');
  const [clients, setClients] = useState<DirectoryClient[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removeProblem, setRemoveProblem] = useState<TranslationKey | null>(null);

  const refreshClients = useCallback(async () => {
    const reply = await apiClient.get('/me/directory-clients', { query: { page_size: 100 } });
    setClients(reply.items);
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
      await refreshClients();
    } catch (error) {
      const orders = error instanceof ApiError && error.status === 409;
      setRemoveProblem(orders ? 'directoryClientHasOrders' : 'listingError');
    }
  };

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
                label={t(specialtyKey(value))}
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
                <Button variant="danger" size="md" onClick={() => void remove(client)}>
                  {t('directoryClientConfirm', { code: client.client_code })}
                </Button>
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
      </section>
    </>
  );
};
