import React from 'react';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';
import { UserAccount } from '../../types/api';

// Staff links load on demand, so the client flow never carries them (A13, frontend-spec 18).
const LINKS: Record<string, [string, TranslationKey][]> = {
  tailor: [
    ['/t/orders', 'dashboardOrders'],
    ['/t/clients', 'dashboardClients'],
    ['/t/conflicts', 'syncConflicts'],
    ['/t/audit', 'dashboardAudit'],
  ],
  admin: [
    ['/admin/accounts', 'navAccounts'],
    ['/admin/audit', 'navAuditLog'],
    ['/admin/study/participants', 'navStudy'],
    ['/admin/capture-modes', 'navCaptureModes'],
    ['/admin/settings', 'navSettings'],
  ],
  measurer: [['/study/reference', 'navTapeEntry']],
};

interface StaffNavProps {
  role: UserAccount['role'];
  currentPath: string;
  onNavigate: (path: string) => void;
}

const StaffNav: React.FC<StaffNavProps> = ({ role, currentPath, onNavigate }) => {
  const { t } = useI18n();
  return (
    <>
      {(LINKS[role] ?? []).map(([path, key]) => (
        <button
          key={path}
          onClick={() => onNavigate(path)}
          className={`hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
            role === 'measurer' || (role === 'tailor' && currentPath.startsWith(path))
              ? 'text-[var(--vt-thread,#2E3A87)] font-semibold'
              : ''
          }`}
        >
          {t(key)}
        </button>
      ))}
    </>
  );
};

export default StaffNav;
