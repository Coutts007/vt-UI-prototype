import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Cloud, Share2, Trash2 } from 'lucide-react';
import { captureSession } from '../../capture/session';
import { Button } from '../../components/ui/Button';
import { Dialog, EmptyState } from '../../components/ui/feedback';
import { onSyncChange, syncNow } from '../../db/sync';
import { LocalProfile, vtStorage } from '../../db/storage';
import { useI18n } from '../../i18n';
import { ChangeCodeForm } from './ChangeCodeForm';
import { canInstall, isIos, promptInstall } from '../../sw/install';

export const SavedView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const { locale, t } = useI18n();
  const [profile, setProfile] = useState<LocalProfile | null | undefined>(undefined);
  const [askClear, setAskClear] = useState(false);
  const [unsent, setUnsent] = useState(0);
  const [cleared, setCleared] = useState(false);
  const [installable, setInstallable] = useState(() => canInstall() || isIos());

  // Once details are cleared this screen shows nothing more, even when the sync timer fires (9.11).
  const clearedRef = useRef(false);
  const load = useCallback(async () => {
    if (clearedRef.current) return;
    const id = captureSession.savedProfileId;
    setProfile(id ? await vtStorage.getProfileById(id) : await vtStorage.latestOwnProfile());
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
      {profile.secret_refused && <p role="alert" className="font-medium">{t('syncSecretRefused')}</p>}

      {status === 'rejected' && <ChangeCodeForm profileId={profile.profile_id} onChanged={() => void load()} />}

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
          setUnsent(await vtStorage.countUnsent());
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
              clearedRef.current = true;
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
