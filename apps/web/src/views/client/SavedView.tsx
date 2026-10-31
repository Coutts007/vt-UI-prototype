import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Cloud, Share2, Trash2 } from 'lucide-react';
import { captureSession } from '../../capture/session';
import { Button } from '../../components/ui/Button';
import { CodeInput } from '../../components/ui/CodeInput';
import { Dialog, EmptyState } from '../../components/ui/feedback';
import { onSyncChange, syncNow } from '../../db/sync';
import { LocalProfile, vtStorage } from '../../db/storage';
import { useI18n } from '../../i18n';
import { canInstall, isIos, promptInstall } from '../../sw/install';

const CODE = /^[A-Z]{2}[0-9]{4}$/;

export const SavedView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const { locale, t } = useI18n();
  const [profile, setProfile] = useState<LocalProfile | null | undefined>(undefined);
  const [newCode, setNewCode] = useState('');
  const [codeError, setCodeError] = useState(false);
  const [askClear, setAskClear] = useState(false);
  const [unsent, setUnsent] = useState(0);
  const [cleared, setCleared] = useState(false);
  const [installable, setInstallable] = useState(() => canInstall() || isIos());

  const load = useCallback(async () => {
    const id = captureSession.savedProfileId;
    const found = id ? await vtStorage.getProfileById(id) : (await vtStorage.getProfiles())[0];
    setProfile(found ?? null);
  }, []);

  useEffect(() => {
    void load();
    return onSyncChange(() => void load());
  }, [load]);

  useEffect(() => {
    // The capture is over, so its numbers leave memory (9.9).
    if (captureSession.machine.state.name === 'saved') captureSession.clear();
  }, []);

  if (profile === undefined) return null;
  if (profile === null) {
    return (
      <div className="max-w-xl mx-auto px-4 py-8">
        <EmptyState title={cleared ? t('detailsCleared') : t('noMeasurementsYet')}>
          <Button className="mt-4" onClick={() => onNavigate('/start')}>
            {t('measureNow')}
          </Button>
        </EmptyState>
      </div>
    );
  }

  const status = profile.sync_status;
  const shareText = t('shareText', { code: profile.client_code });
  const title = {
    synced: t('savedTitleSynced'),
    pending: t('savedTitlePending'),
    rejected: t('savedTitleRejected'),
    conflict: t('savedTitleConflict'),
  }[status];
  const dateText = new Date(profile.captured_at).toLocaleString(locale === 'sw' ? 'sw-KE' : 'en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="max-w-xl mx-auto px-4 py-8 flex flex-col items-center text-center gap-5">
      <div className={`w-20 h-20 rounded-full flex items-center justify-center ${status === 'synced' ? 'bg-emerald-100 text-emerald-800' : status === 'pending' ? 'bg-sky-100 text-sky-900' : 'bg-amber-100 text-amber-900'}`}>
        {status === 'synced' ? (
          <CheckCircle2 aria-hidden="true" className="w-10 h-10" />
        ) : status === 'pending' ? (
          <Cloud aria-hidden="true" className="w-10 h-10" />
        ) : (
          <AlertCircle aria-hidden="true" className="w-10 h-10" />
        )}
      </div>
      <h1 data-sync={status} className="text-2xl sm:text-3xl font-extrabold tracking-tight">
        {title}
      </h1>
      {profile.needs_help && <p role="alert" className="font-medium">{t('syncNeedsHelp')}</p>}

      {status === 'rejected' && (
        <form
          className="w-full p-4 rounded-2xl border border-[var(--vt-line)] bg-white flex flex-col gap-3 text-left"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!CODE.test(newCode)) {
              setCodeError(true);
              return;
            }
            await vtStorage.changeProfileCode(profile.profile_id, newCode);
            setNewCode('');
            await load();
            void syncNow();
          }}
        >
          <p className="font-semibold">{t('clientCodeLabel')}</p>
          <CodeInput
            value={newCode}
            onChange={(next) => {
              setNewCode(next);
              setCodeError(false);
            }}
            error={codeError ? t('clientCodeError') : undefined}
          />
          <Button type="submit">{t('changeCode')}</Button>
        </form>
      )}

      <p className="w-full p-4 rounded-2xl border border-[var(--vt-line)] bg-white">
        {t('yourCode')}: <strong className="font-mono">{profile.client_code}</strong> · {t('measuredAt')} {dateText}
      </p>
      <p>{t('tailorWillContact')}</p>

      <div className="flex flex-col gap-3 w-full">
        <Button
          variant="outline"
          size="lg"
          icon={<Share2 aria-hidden="true" className="w-4 h-4" />}
          onClick={() => {
            if (navigator.share) void navigator.share({ text: shareText }).catch(() => {});
            else window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener,noreferrer');
          }}
        >
          {t('tellTailorWhatsApp')}
        </Button>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => onNavigate('/start')}>
            {t('measureAgain')}
          </Button>
          <Button onClick={() => onNavigate('/me')}>{t('done')}</Button>
        </div>
        {status === 'synced' && installable && (
          isIos() ? (
            <p className="text-sm">{t('installIos')}</p>
          ) : (
            <Button variant="outline" onClick={() => void promptInstall().then(() => setInstallable(false))}>
              {t('installOffer')}
            </Button>
          )
        )}
      </div>

      <button
        type="button"
        className="min-h-12 flex items-center gap-1.5 text-sm cursor-pointer"
        onClick={async () => {
          const ops = await vtStorage.getProfiles();
          setUnsent(ops.filter((row) => row.sync_status === 'pending').length);
          setAskClear(true);
        }}
      >
        <Trash2 aria-hidden="true" className="w-4 h-4" />
        <span>{t('sharedPhonePrompt')}</span>
      </button>

      <Dialog title={t('sharedPhoneTitle')} open={askClear} onClose={() => setAskClear(false)}>
        <p className="mb-4">{unsent ? t('sharedPhoneUnsent', { n: unsent }) : t('sharedPhoneBody')}</p>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => setAskClear(false)}>
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            onClick={async () => {
              await vtStorage.clearClientDetails();
              captureSession.savedProfileId = null;
              setAskClear(false);
              setCleared(true);
              setProfile(null);
            }}
          >
            {t('confirm')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
};
