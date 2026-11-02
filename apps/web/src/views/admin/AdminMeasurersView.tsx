// Measurers (frontend-spec 14.1, 15.2): the admin adds the people who enter tape readings.
import React, { useState } from 'react';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { Card, hintClass, inputClass, labelClass, nairobiToday, useDates, useLoad } from '../tailor/common';
import { AdminLoading, Page, isTaken, problemKey } from './adminCommon';
import { useAdminText } from './adminText';

export const AdminMeasurersView: React.FC<{ onNavigate: (path: string) => void }> = () => {
  const ax = useAdminText();
  const { date } = useDates();
  const list = useLoad(
    async () => (await apiClient.get('/admin/accounts', { query: { page_size: 100 } })).items.filter((a) => a.role === 'measurer'),
    [],
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [trainedOn, setTrainedOn] = useState(nairobiToday());
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await apiClient.post('/admin/measurers', {
        body: { email: email.trim(), password, measurer_code: code, trained_on: trainedOn },
      });
      setNotice(ax('measurerAdded', { code }));
      setEmail('');
      setPassword('');
      setCode('');
      void list.reload();
    } catch (problem) {
      setNotice(ax(isTaken(problem) ? 'measurerTaken' : problemKey(problem)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={ax('measurersTitle')} intro={ax('measurersIntro')}>
      <Card>
        <form
          className="grid sm:grid-cols-2 gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <div>
            <label htmlFor="m-email" className={labelClass}>{ax('email')}</label>
            <input id="m-email" type="email" required maxLength={254} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="m-password" className={labelClass}>{ax('password')}</label>
            <input id="m-password" type="password" required minLength={10} maxLength={256} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="m-code" className={labelClass}>{ax('measurerCode')}</label>
            <input id="m-code" required maxLength={4} pattern="[A-Z]{1,4}" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={`${inputClass} font-mono`} />
          </div>
          <div>
            <label htmlFor="m-trained" className={labelClass}>{ax('trainedOn')}</label>
            <input id="m-trained" type="date" required value={trainedOn} onChange={(e) => setTrainedOn(e.target.value)} className={inputClass} />
          </div>
          <div className="sm:col-span-2 flex flex-col gap-2">
            {notice && <p role="status" className="text-sm font-semibold">{notice}</p>}
            <Button type="submit" disabled={busy || password.length < 10 || !code}>{ax('addMeasurer')}</Button>
          </div>
        </form>
      </Card>
      {!list.data ? (
        <AdminLoading failed={list.failed} onRetry={() => void list.reload()} />
      ) : (
        <ul className="rounded-2xl border border-[var(--vt-line)] bg-white divide-y divide-[var(--vt-line)]">
          {list.data.map((account) => (
            <li key={account.user_id} className="p-4">
              <p className="font-bold"><span className="font-mono">{account.measurer_code}</span> · {account.email}</p>
              <p className={hintClass}>{account.trained_on ? `${ax('trainedOn')} ${date(account.trained_on)}` : ''}</p>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
};
