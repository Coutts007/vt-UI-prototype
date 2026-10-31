// Corrects a code the server refused, wherever the rejected profile is shown (9.11, 9.12).
import React, { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { CodeInput } from '../../components/ui/CodeInput';
import { syncNow } from '../../db/sync';
import { vtStorage } from '../../db/storage';
import { useI18n } from '../../i18n';

const CODE = /^[A-Z]{2}[0-9]{4}$/;

export const ChangeCodeForm: React.FC<{ profileId: string; onChanged: () => void }> = ({ profileId, onChanged }) => {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  return (
    <form
      className="w-full p-4 rounded-2xl border border-[var(--vt-line)] bg-white flex flex-col gap-3 text-left"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!CODE.test(code)) {
          setError(true);
          return;
        }
        await vtStorage.changeProfileCode(profileId, code);
        setCode('');
        onChanged();
        void syncNow();
      }}
    >
      <p className="font-semibold">{t('savedTitleRejected')}</p>
      <CodeInput
        value={code}
        onChange={(next) => {
          setCode(next);
          setError(false);
        }}
        error={error ? t('clientCodeError') : undefined}
      />
      <Button type="submit">{t('changeCode')}</Button>
    </form>
  );
};
