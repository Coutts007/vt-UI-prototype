import React from 'react';
import { useI18n } from '../../i18n';
import { UserAccount } from '../../types/api';
import { Users, ClipboardList, RefreshCw, History, Settings } from 'lucide-react';

interface TailorLayoutProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  currentUser: UserAccount;
  children: React.ReactNode;
}

export const TailorLayout: React.FC<TailorLayoutProps> = ({
  currentPath,
  onNavigate,
  currentUser,
  children,
}) => {
  const { t } = useI18n();

  const navItems = [
    { path: '/t/orders', label: t('dashboardOrders'), icon: ClipboardList },
    { path: '/t/clients', label: t('dashboardClients'), icon: Users },
    { path: '/t/conflicts', label: t('syncConflicts'), icon: RefreshCw },
    { path: '/t/audit', label: t('dashboardAudit'), icon: History },
    { path: '/t/settings', label: t('dashboardSettings'), icon: Settings },
  ];

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#FAF8F5]">
      {/* Desktop Left Sidebar (>= 1024px) */}
      <aside className="hidden lg:flex flex-col w-64 border-r border-[var(--vt-line,#DDD5C8)] bg-white p-5 shrink-0">
        <div className="mb-6">
          <span className="text-xs uppercase font-bold text-[var(--vt-ink-muted,#5C554C)] tracking-wider">
            Tailor Workshop
          </span>
          <h2 className="text-base font-bold text-[var(--vt-ink,#1F1C18)] truncate">
            {currentUser.business_name || 'My Workshop'}
          </h2>
          <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] truncate block">
            {currentUser.area || 'Nairobi'}
          </span>
        </div>

        <nav className="flex flex-col gap-1.5 flex-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentPath.startsWith(item.path);
            return (
              <button
                key={item.path}
                onClick={() => onNavigate(item.path)}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer text-left ${
                  active
                    ? 'bg-indigo-50/80 text-[var(--vt-thread,#2E3A87)]'
                    : 'text-[var(--vt-ink-muted,#5C554C)] hover:bg-[#FAF8F5] hover:text-[var(--vt-ink,#1F1C18)]'
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-[var(--vt-thread,#2E3A87)]' : ''}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="pt-4 border-t border-[var(--vt-line,#DDD5C8)] text-[11px] text-[var(--vt-ink-muted,#5C554C)] font-mono">
          Rules: v0.1-uncalibrated
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto pb-24 lg:pb-8">
        {children}
      </main>

      {/* Mobile Fixed Bottom Tab Bar (< 1024px) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-[var(--vt-line,#DDD5C8)] px-2 py-1 shadow-lg">
        <div className="grid grid-cols-5 items-center">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentPath.startsWith(item.path);
            return (
              <button
                key={item.path}
                onClick={() => onNavigate(item.path)}
                className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-lg cursor-pointer ${
                  active ? 'text-[var(--vt-thread,#2E3A87)]' : 'text-[var(--vt-ink-muted,#5C554C)]'
                }`}
              >
                <Icon className="w-5 h-5 mb-0.5" />
                <span className={`text-[10px] font-medium leading-tight truncate ${active ? 'font-bold' : ''}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
