// Completion per capture mode (NFR-07, M15): how many captures finished within three attempts, per
// mode, camera and guidance. Counts only; nothing here names a client.
import React from 'react';
import { apiClient } from '../../api/instance';
import { Card, hintClass, useLoad } from '../tailor/common';
import { AdminLoading, Page } from './adminCommon';
import { AdminKey, useAdminText } from './adminText';

const MODE: Record<string, AdminKey> = { self: 'modeSelfShort', assisted: 'modeAssistedShort' };
const CAMERA: Record<string, AdminKey> = { environment: 'cameraRear', user: 'cameraFront' };
const GUIDANCE: Record<string, AdminKey> = { voice: 'guidanceVoice', visual: 'guidanceVisual' };

export const AdminCaptureModesView: React.FC<{ onNavigate: (path: string) => void }> = () => {
  const ax = useAdminText();
  const stats = useLoad(() => apiClient.get('/admin/capture-stats'), []);
  const th = 'text-left p-2 font-semibold';
  const td = 'p-2 tabular-nums';
  return (
    <Page title={ax('captureModesTitle')} intro={ax('captureModesIntro')}>
      {!stats.data ? (
        <AdminLoading failed={stats.failed} onRetry={() => void stats.reload()} />
      ) : (
        <Card>
          <p className="text-sm">{ax('captureModesTotal', { n: stats.data.sessions })}</p>
          {stats.data.modes.length === 0 ? (
            <p className={hintClass}>{ax('captureModesEmpty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm border-collapse" data-testid="capture-modes">
                <caption className="sr-only">{ax('captureModesTitle')}</caption>
                <thead>
                  <tr className="border-b border-[var(--vt-line)]">
                    <th scope="col" className={th}>{ax('statMode')}</th>
                    <th scope="col" className={th}>{ax('cameraFacing')}</th>
                    <th scope="col" className={th}>{ax('guidanceMode')}</th>
                    <th scope="col" className={`${th} text-right`}>{ax('sessions')}</th>
                    <th scope="col" className={`${th} text-right`}>{ax('withinThree')}</th>
                    <th scope="col" className={`${th} text-right`}>{ax('meanRetakes')}</th>
                    <th scope="col" className={`${th} text-right`}>{ax('levelUnchecked')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.data.modes.map((row) => (
                    <tr key={`${row.capture_mode}-${row.camera_facing}-${row.guidance_mode}`} className="border-b border-[var(--vt-line)]">
                      <td className={td}>{ax(MODE[row.capture_mode] ?? 'modeSelfShort')}</td>
                      <td className={td}>{ax(CAMERA[row.camera_facing] ?? 'cameraRear')}</td>
                      <td className={td}>{ax(GUIDANCE[row.guidance_mode] ?? 'guidanceVoice')}</td>
                      <td className={`${td} text-right`}>{row.sessions}</td>
                      <td className={`${td} text-right font-semibold`}>
                        {row.within_three_attempts} ({row.within_three_attempts_pct}%)
                      </td>
                      <td className={`${td} text-right`}>{row.mean_retake_count}</td>
                      <td className={`${td} text-right`}>{row.level_unchecked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={hintClass}>{ax('captureModesNote')}</p>
        </Card>
      )}
    </Page>
  );
};
