import React, { useState } from 'react';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';
import { Card, Conflict, currentUnit, formatLength, Loading, Title, useDates, useLoad } from './common';
import { useTailorText } from './tailorText';

export const ConflictsView: React.FC<{ onNavigate: (path: string) => void }> = () => {
  const tx = useTailorText();
  const { t } = useI18n();
  const { date } = useDates();
  const unit = currentUnit();
  const { data, failed, reload } = useLoad(() => apiClient.get('/conflicts'), []);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (!data) return <Loading failed={failed} onRetry={reload} />;

  const resolve = async (row: Conflict, keep: 'newer' | 'server') => {
    setBusy(row.conflict_id);
    setError(false);
    try {
      await apiClient.post('/conflicts/{conflict_id}/resolve', { path: { conflict_id: row.conflict_id }, body: { keep } });
      await reload();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-4xl mx-auto">
      <Title>{tx('conflictsTitle')}</Title>
      {error && <p role="alert" className="text-sm text-rose-800">{tx('saveFailed')}</p>}
      {data.length === 0 ? (
        <p className="p-8 text-center text-sm rounded-2xl border border-[var(--vt-line)] bg-white">{tx('conflictsEmpty')}</p>
      ) : (
        data.map((row) => (
          <Card key={row.conflict_id} title={row.client_code}>
            <p className="text-sm">{tx('conflictServer', { version: row.server_profile.version, date: date(row.server_profile.captured_at) })}</p>
            <p className="text-sm">{tx('conflictIncoming', { version: row.incoming_profile.version, date: date(row.incoming_profile.captured_at) })}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th scope="col" className="py-1">{tx('siteColumn')}</th>
                    <th scope="col" className="py-1">v{row.server_profile.version}</th>
                    <th scope="col" className="py-1">v{row.incoming_profile.version}</th>
                    <th scope="col" className="py-1">{tx('conflictDifference')}</th>
                  </tr>
                </thead>
                <tbody>
                  {row.server_profile.measurements.map((server) => {
                    const incoming = row.incoming_profile.measurements.find((m) => m.site_code === server.site_code);
                    const gap =
                      incoming?.value_mm != null && server.value_mm != null ? incoming.value_mm - server.value_mm : null;
                    return (
                      <tr key={server.site_code} className="border-t border-[var(--vt-line)]">
                        <td className="py-1">{t(`site_${server.site_code}` as TranslationKey)}</td>
                        <td className="py-1">{formatLength(server.value_mm, unit)}</td>
                        <td className="py-1">{formatLength(incoming?.value_mm, unit)}</td>
                        <td className={`py-1 ${gap ? 'font-bold' : ''}`}>{gap === null ? '—' : formatLength(Math.abs(gap), unit)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button loading={busy === row.conflict_id} onClick={() => void resolve(row, 'newer')}>{tx('useNewer')}</Button>
              <Button variant="outline" onClick={() => void resolve(row, 'server')}>{tx('keepServer')}</Button>
            </div>
          </Card>
        ))
      )}
    </div>
  );
};
