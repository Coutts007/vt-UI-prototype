// Study exports (backend-spec 12.1): the server writes the CSV, audits the download, and leaves out withdrawals.
import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { ApiError } from '../../api/http';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { Card, inputClass, labelClass, nairobiToday } from '../tailor/common';
import { Page, saveText } from './adminCommon';
import { AdminKey, useAdminText } from './adminText';

export const AdminStudyExportView: React.FC<{ onNavigate: (path: string) => void }> = () => {
  const ax = useAdminText();
  const [rules, setRules] = useState('');
  const [busy, setBusy] = useState<'captures' | 'reference' | null>(null);
  const [error, setError] = useState<AdminKey | null>(null);

  const download = async (kind: 'captures' | 'reference') => {
    setBusy(kind);
    setError(null);
    try {
      const query: Record<string, string> = kind === 'captures' && rules.trim() ? { rules_version: rules.trim() } : {};
      const text = await apiClient.text(`/study/export/${kind}.csv`, query);
      saveText(text, `vt-${kind}-${nairobiToday()}.csv`);
    } catch (problem) {
      const code = problem instanceof ApiError ? problem.code : '';
      setError(code === 'rules_version_unknown' ? 'exportUnknownRules' : code === 'study_mode_off' ? 'errStudyOff' : 'exportFailed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page title={ax('exportTitle')} intro={ax('exportIntro')}>
      <Card>
        <div>
          <label htmlFor="export-rules" className={labelClass}>{ax('exportRules')}</label>
          <input id="export-rules" value={rules} maxLength={40} onChange={(e) => setRules(e.target.value)} className={`${inputClass} font-mono`} />
        </div>
        <Button disabled={busy !== null} icon={<Download className="w-4 h-4" />} onClick={() => void download('captures')}>
          {busy === 'captures' ? ax('exporting') : ax('exportCaptures')}
        </Button>
        <Button variant="outline" disabled={busy !== null} icon={<Download className="w-4 h-4" />} onClick={() => void download('reference')}>
          {busy === 'reference' ? ax('exporting') : ax('exportReference')}
        </Button>
        {error && <p role="alert" className="text-sm text-rose-700">{ax(error)}</p>}
      </Card>
    </Page>
  );
};
