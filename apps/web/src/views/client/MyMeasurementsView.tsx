import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Layers, Ruler, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { SyncBadge } from '../../components/ui/SyncBadge';
import { Dialog, EmptyState } from '../../components/ui/feedback';
import { onSyncChange, readNotice, syncNow } from '../../db/sync';
import { LocalProfile, vtStorage } from '../../db/storage';
import { useI18n } from '../../i18n';
import { ChangeCodeForm } from './ChangeCodeForm';
import { MeasurementSummary } from './MeasurementSummary';

type Action = 'delete' | 'withdraw';

export const MyMeasurementsView: React.FC<{ onNavigate: (path: string) => void; profileId?: string }> = ({
  onNavigate,
  profileId,
}) => {
  const { locale, t } = useI18n();
  const [profiles, setProfiles] = useState<LocalProfile[] | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [canRetry, setCanRetry] = useState(false);

  const load = useCallback(() => {
    void vtStorage.getVisibleProfiles().then(setProfiles);
    void readNotice().then((found) => {
      setProblems(
        [
          found.secretRefused && 'syncSecretRefused',
          found.noSecret && 'syncNoSecret',
          found.deletionRefused && 'deletionSecretRefused',
          found.deletionNoSecret && 'deletionNoSecret',
        ].filter((key): key is string => !!key),
      );
      setCanRetry(found.refusalEnded);
    });
  }, []);
  useEffect(() => {
    load();
    return onSyncChange(load);
  }, [load]);

  if (!profiles) return null;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale === 'sw' ? 'sw-KE' : 'en-KE', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  const active = profileId ? profiles.find((p) => p.profile_id === profileId) : null;

  const close = () => {
    setAction(null);
    setConfirmed(false);
  };
  const perform = async () => {
    if (!active || !action) return;
    await vtStorage.deleteMyData(active.client_code, action);
    close();
    setNotice(t(action === 'delete' ? 'deletedNotice' : 'withdrawnSuccess'));
    load();
    void syncNow();
    onNavigate('/me');
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-5">
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{t('myMeasurementsTitle')}</h1>
      {problems.map((key) => (
        <p key={key} role="alert" className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 font-medium text-amber-900">
          {t(key as Parameters<typeof t>[0])}
        </p>
      ))}
      {canRetry && (
        <button
          type="button"
          onClick={() => void vtStorage.retryRefused().then(() => syncNow(true, true))}
          className="min-h-12 px-4 rounded-xl border border-[var(--vt-line)] font-medium cursor-pointer self-start"
        >
          {t('retry')}
        </button>
      )}
      {notice && (
        <p role="status" className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 font-medium text-emerald-900">
          {notice}
        </p>
      )}

      {profileId ? (
        <>
          <button type="button" onClick={() => onNavigate('/me')} className="min-h-12 flex items-center gap-1 font-medium cursor-pointer self-start">
            <ChevronLeft aria-hidden="true" className="w-4 h-4" />
            <span>{t('allProfiles')}</span>
          </button>
          {!active ? (
            <EmptyState title={t('profileMissing')} />
          ) : (
            <>
              <div className="p-4 rounded-xl bg-white border border-[var(--vt-line)] flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong className="font-mono">{active.client_code}</strong> · {t('versionLabel', { n: active.version })} · {when(active.captured_at)}
                </span>
                <SyncBadge status={active.sync_status} />
              </div>
              {active.sync_status === 'rejected' && <ChangeCodeForm profileId={active.profile_id} onChanged={load} />}
              <MeasurementSummary profile={active} />
              <section className="p-4 rounded-xl bg-white border border-[var(--vt-line)] text-sm" data-testid="checks-summary">
                <h2 className="font-bold mb-1">{t('checksSummaryTitle')}</h2>
                <p>
                  {t('checksSummaryLine', {
                    front: Object.values(active.session.front_checks).filter((c) => c === 'pass').length,
                    side: Object.values(active.session.side_checks).filter((c) => c === 'pass').length,
                    total: Object.keys(active.session.front_checks).length,
                  })}
                </p>
              </section>
              <section className="p-4 rounded-2xl border border-[var(--vt-line)] bg-white flex flex-col gap-3">
                <p className="text-sm">{t('deleteMyDataConfirm')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Button variant="outline" onClick={() => setAction('withdraw')}>
                    {t('withdrawConsent')}
                  </Button>
                  <Button variant="danger" icon={<Trash2 aria-hidden="true" className="w-4 h-4" />} onClick={() => setAction('delete')}>
                    {t('deleteMyData')}
                  </Button>
                </div>
              </section>
            </>
          )}
        </>
      ) : profiles.length === 0 ? (
        <EmptyState title={t('noMeasurementsYet')}>
          <Button className="mt-4" icon={<Ruler aria-hidden="true" className="w-4 h-4" />} onClick={() => onNavigate('/start')}>
            {t('measureNow')}
          </Button>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="profile-list">
          {profiles.map((p) => {
            const good = p.measurements.filter((m) => m.confidence_flag === 'pass').length;
            const check = p.measurements.filter((m) => m.confidence_flag !== 'pass').length;
            return (
              <li key={p.profile_id}>
                <button
                  type="button"
                  onClick={() => onNavigate(`/me/${p.profile_id}`)}
                  className="w-full p-4 rounded-xl border border-[var(--vt-line)] bg-white flex items-center justify-between gap-3 text-left cursor-pointer"
                >
                  <span>
                    <span className="flex flex-wrap items-center gap-2 mb-1">
                      <strong className="font-mono">{p.client_code}</strong>
                      <span className="text-sm">{t('versionLabel', { n: p.version })}</span>
                      <SyncBadge status={p.sync_status} />
                    </span>
                    <span className="text-sm block">{when(p.captured_at)}</span>
                    <span className="text-sm block">{t('flagSummary', { good, check })}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="w-5 h-5 shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!profileId && profiles.length > 0 && (
        <Button variant="outline" icon={<Layers aria-hidden="true" className="w-4 h-4" />} onClick={() => onNavigate('/start')}>
          {t('measureAgain')}
        </Button>
      )}

      <Dialog title={t(action === 'withdraw' ? 'withdrawConsent' : 'deleteMyData')} open={Boolean(action)} onClose={close}>
        <p className="mb-4">{confirmed ? t('deleteSecondConfirm') : t('deleteMyDataConfirm')}</p>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={close}>
            {t('cancel')}
          </Button>
          {confirmed ? (
            <Button variant="danger" className="flex-1" onClick={() => void perform()}>
              {t('deleteYes')}
            </Button>
          ) : (
            <Button variant="danger" className="flex-1" onClick={() => setConfirmed(true)}>
              {t('confirm')}
            </Button>
          )}
        </div>
      </Dialog>
    </div>
  );
};
