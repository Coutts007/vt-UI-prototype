import React, { useState } from 'react';
import { useI18n, Locale } from '../../i18n';
import { UserAccount } from '../../types/api';
import { Globe, MoreVertical, LogOut, Scissors, Shield, BookOpen, Layers } from 'lucide-react';

interface HeaderProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  currentUser?: UserAccount | null;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentPath,
  onNavigate,
  currentUser,
  onLogout,
}) => {
  const { locale, setLocale, t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleLanguage = () => {
    const next: Locale = locale === 'en' ? 'sw' : 'en';
    setLocale(next);
  };

  const isClientFlow =
    currentPath === '/' ||
    currentPath.startsWith('/start') ||
    currentPath.startsWith('/consent') ||
    currentPath.startsWith('/check') ||
    currentPath.startsWith('/sheet') ||
    currentPath.startsWith('/setup') ||
    currentPath.startsWith('/capture') ||
    currentPath.startsWith('/processing') ||
    currentPath.startsWith('/review') ||
    currentPath.startsWith('/saved') ||
    currentPath.startsWith('/me') ||
    currentPath.startsWith('/help') ||
    currentPath.startsWith('/privacy');

  return (
    <header className="sticky top-0 z-40 bg-[var(--vt-chalk,#F7F3EC)]/90 backdrop-blur-md border-b border-[var(--vt-line,#DDD5C8)] px-4 sm:px-6 py-3 transition-colors">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-6 sm:gap-8">
        {/* Zone 1: Brand Wordmark (Single text element) */}
        <button
          onClick={() => onNavigate('/')}
          className="flex items-center gap-2.5 text-left cursor-pointer group shrink-0"
        >
          <div className="w-8 h-8 rounded-lg bg-[var(--vt-thread,#2E3A87)] text-white flex items-center justify-center shadow-xs font-bold text-sm tracking-wider">
            VT
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold tracking-tight text-[var(--vt-ink,#1F1C18)] whitespace-nowrap">
              Virtual Tailor
            </span>
          </div>
        </button>

        {/* Zone 2: Navigation Links (Clean single-line prose) */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[var(--vt-ink-muted,#5C554C)]">
          {currentUser?.role === 'tailor' ? (
            <>
              <button
                onClick={() => onNavigate('/t/orders')}
                className={`hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  currentPath.startsWith('/t/orders') ? 'text-[var(--vt-thread,#2E3A87)] font-semibold' : ''
                }`}
              >
                {t('dashboardOrders')}
              </button>
              <button
                onClick={() => onNavigate('/t/clients')}
                className={`hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  currentPath.startsWith('/t/clients') ? 'text-[var(--vt-thread,#2E3A87)] font-semibold' : ''
                }`}
              >
                {t('dashboardClients')}
              </button>
              <button
                onClick={() => onNavigate('/t/conflicts')}
                className={`hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  currentPath.startsWith('/t/conflicts') ? 'text-[var(--vt-thread,#2E3A87)] font-semibold' : ''
                }`}
              >
                {t('syncConflicts')}
              </button>
              <button
                onClick={() => onNavigate('/t/audit')}
                className={`hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  currentPath.startsWith('/t/audit') ? 'text-[var(--vt-thread,#2E3A87)] font-semibold' : ''
                }`}
              >
                {t('dashboardAudit')}
              </button>
            </>
          ) : currentUser?.role === 'admin' ? (
            <>
              <button
                onClick={() => onNavigate('/admin/accounts')}
                className="hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                Accounts
              </button>
              <button
                onClick={() => onNavigate('/admin/audit')}
                className="hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                Audit Log
              </button>
              <button
                onClick={() => onNavigate('/admin/study/participants')}
                className="hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                Study
              </button>
              <button
                onClick={() => onNavigate('/admin/settings')}
                className="hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                Settings
              </button>
            </>
          ) : currentUser?.role === 'measurer' ? (
            <>
              <button
                onClick={() => onNavigate('/study/reference')}
                className="hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer text-[var(--vt-thread,#2E3A87)] font-semibold"
              >
                Reference Tape Entry
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onNavigate('/start')}
                className="hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                Measure
              </button>
              <button
                onClick={() => onNavigate('/sheet')}
                className="hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                Measuring Sheet
              </button>
              <button
                onClick={() => onNavigate('/me')}
                className="hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                My Measurements
              </button>
              <button
                onClick={() => onNavigate('/help')}
                className="hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                How It Works
              </button>
            </>
          )}
        </nav>

        {/* Zone 3: 1 Primary Action + Language Toggle + Menu */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          {/* Language Toggle (Bilingual EN | SW) */}
          <button
            onClick={toggleLanguage}
            title="Switch Language"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--vt-line,#DDD5C8)] bg-white hover:bg-[#FAF7F2] text-xs font-semibold text-[var(--vt-ink,#1F1C18)] cursor-pointer transition-colors shadow-2xs whitespace-nowrap shrink-0"
          >
            <Globe className="w-3.5 h-3.5 text-[var(--vt-ink-muted,#5C554C)]" />
            <span className={locale === 'en' ? 'text-[var(--vt-thread,#2E3A87)] font-bold' : 'opacity-70'}>
              EN
            </span>
            <span className="text-[var(--vt-line,#DDD5C8)]">|</span>
            <span className={locale === 'sw' ? 'text-[var(--vt-thread,#2E3A87)] font-bold' : 'opacity-70'}>
              SW
            </span>
          </button>

          {/* Role Action / User Menu */}
          {currentUser ? (
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-block text-xs font-medium text-[var(--vt-ink-muted,#5C554C)] bg-[#EAE3D6] px-2.5 py-1 rounded-md">
                {currentUser.business_name || currentUser.email}
              </span>
              <button
                onClick={onLogout}
                title="Sign out"
                className="p-2 rounded-lg border border-[var(--vt-line,#DDD5C8)] bg-white text-[var(--vt-ink-muted,#5C554C)] hover:text-rose-600 hover:border-rose-300 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => onNavigate('/login')}
              className="px-3.5 py-1.5 rounded-lg bg-[var(--vt-thread,#2E3A87)] text-white text-xs font-semibold hover:bg-[#232c69] transition-colors whitespace-nowrap shrink-0 shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              <Scissors className="w-3.5 h-3.5" />
              <span>Tailor Login</span>
            </button>
          )}

          {/* Overflow Menu (Three dots) */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 rounded-lg border border-[var(--vt-line,#DDD5C8)] bg-white text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)] transition-colors cursor-pointer"
              aria-label="More options"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-transparent"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 mt-2 w-56 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white p-1.5 shadow-lg z-50 text-sm">
                  <div className="px-3 py-1.5 text-xs font-semibold text-[var(--vt-ink-muted,#5C554C)] uppercase tracking-wider border-b border-[var(--vt-line,#DDD5C8)]/50 mb-1">
                    Virtual Tailor Navigation
                  </div>
                  <button
                    onClick={() => {
                      onNavigate('/start');
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F7F3EC] flex items-center gap-2 cursor-pointer"
                  >
                    <Scissors className="w-4 h-4 text-[var(--vt-thread,#2E3A87)]" />
                    <span>Client Capture App</span>
                  </button>
                  <button
                    onClick={() => {
                      onNavigate('/me');
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F7F3EC] flex items-center gap-2 cursor-pointer"
                  >
                    <Layers className="w-4 h-4 text-emerald-600" />
                    <span>My Saved Profiles</span>
                  </button>
                  <button
                    onClick={() => {
                      onNavigate('/sheet');
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F7F3EC] flex items-center gap-2 cursor-pointer"
                  >
                    <BookOpen className="w-4 h-4 text-indigo-600" />
                    <span>Get Measuring Sheet</span>
                  </button>
                  <button
                    onClick={() => {
                      onNavigate('/help');
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F7F3EC] flex items-center gap-2 cursor-pointer"
                  >
                    <BookOpen className="w-4 h-4 text-amber-600" />
                    <span>How to Measure Guide</span>
                  </button>
                  <button
                    onClick={() => {
                      onNavigate('/privacy');
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F7F3EC] flex items-center gap-2 cursor-pointer"
                  >
                    <Shield className="w-4 h-4 text-slate-600" />
                    <span>Privacy &amp; DPA Rights</span>
                  </button>

                  <div className="my-1 border-t border-[var(--vt-line,#DDD5C8)]/50" />

                  <button
                    onClick={() => {
                      onNavigate('/dev/ui');
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F7F3EC] text-xs text-[var(--vt-ink-muted,#5C554C)] cursor-pointer"
                  >
                    UI Component Gallery (/dev/ui)
                  </button>
                  <button
                    onClick={() => {
                      onNavigate('/dev/capture-tuning');
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F7F3EC] text-xs text-[var(--vt-ink-muted,#5C554C)] cursor-pointer"
                  >
                    Capture Tuning &amp; Simulation (/dev)
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
