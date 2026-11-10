import React, { lazy, Suspense, useState } from 'react';
import { FEATURE_DIRECTORY } from '../../config/features';
import { useI18n, Locale } from '../../i18n';
import { UserAccount } from '../../types/api';
import { Globe, MoreVertical, LogOut, Scissors, Shield, BookOpen, Layers, Store } from 'lucide-react';

const StaffNav = lazy(() => import('./StaffNav'));

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
    currentPath.startsWith('/tailors') ||
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
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 sm:gap-8 min-w-0">
        {/* Zone 1: Brand Wordmark (Single text element) */}
        <button
          onClick={() => onNavigate('/')}
          className="flex items-center justify-center gap-2.5 min-h-[48px] min-w-[48px] text-left cursor-pointer group shrink-0"
        >
          <div className="w-8 h-8 rounded-lg bg-[var(--vt-thread,#2E3A87)] text-white flex items-center justify-center shadow-xs font-bold text-sm tracking-wider">
            VT
          </div>
          <div className="flex flex-col">
            {/* Below 380 px the 48 px controls leave no room, so the wordmark is for screen readers only. */}
            <span className="text-lg font-bold tracking-tight text-[var(--vt-ink,#1F1C18)] whitespace-nowrap max-[379px]:sr-only">
              Virtual Tailor
            </span>
          </div>
        </button>

        {/* Zone 2: Navigation Links (Clean single-line prose) */}
        <nav className="hidden md:flex flex-wrap items-center gap-x-6 gap-y-1 text-sm font-medium text-[var(--vt-ink-muted,#5C554C)]">
          {currentUser ? (
            <Suspense fallback={null}>
              <StaffNav role={currentUser.role} currentPath={currentPath} onNavigate={onNavigate} />
            </Suspense>
          ) : (
            <>
              {FEATURE_DIRECTORY && (
<button
                onClick={() => onNavigate('/tailors')}
                className={`hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer flex items-center gap-1.5 ${
                  currentPath.startsWith('/tailors') ? 'text-[var(--vt-thread,#2E3A87)] font-semibold' : ''
                }`}
              >
                <Store className="w-3.5 h-3.5" />
                <span>{t('navFindTailor')}</span>
              </button>
)}
              <button
                onClick={() => onNavigate('/start')}
                className="hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                {t('hdrMeasure')}
              </button>
              <button
                onClick={() => onNavigate('/sheet')}
                className="hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                {t('hdrSheet')}
              </button>
              <button
                onClick={() => onNavigate('/me')}
                className="hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                {t('hdrMine')}
              </button>
              <button
                onClick={() => onNavigate('/help')}
                className="hover:text-[var(--vt-ink,#1F1C18)] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                {t('howItWorks')}
              </button>
            </>
          )}
        </nav>

        {/* Zone 3: 1 Primary Action + Language Toggle + Menu */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          {/* Language Toggle (Bilingual EN | SW) */}
          <button
            onClick={toggleLanguage}
            title={t('hdrSwitchLang')}
            aria-label={`EN | SW: ${t('hdrSwitchLang')}`}
            className="flex items-center gap-1.5 px-2.5 min-h-[48px] rounded-lg border border-[var(--vt-line,#DDD5C8)] bg-white hover:bg-[#FAF7F2] text-xs font-semibold text-[var(--vt-ink,#1F1C18)] cursor-pointer transition-colors shadow-2xs whitespace-nowrap shrink-0"
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
              <span className="hidden sm:inline-block max-w-[12rem] truncate text-xs font-medium text-[var(--vt-ink-muted,#5C554C)] bg-[#EAE3D6] px-2.5 py-1 rounded-md">
                {currentUser.business_name || currentUser.email}
              </span>
              <button
                onClick={onLogout}
                title={t('hdrSignOut')}
                aria-label={t('hdrSignOut')}
                className="w-12 h-12 inline-flex items-center justify-center shrink-0 rounded-lg border border-[var(--vt-line,#DDD5C8)] bg-white text-[var(--vt-ink-muted,#5C554C)] hover:text-rose-600 hover:border-rose-300 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => onNavigate('/login')}
              aria-label={t('hdrTailorLogin')}
              className="px-3.5 min-h-[48px] min-w-[48px] justify-center rounded-lg bg-[var(--vt-thread,#2E3A87)] text-white text-xs font-semibold hover:bg-[#232c69] transition-colors whitespace-nowrap shrink-0 shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              <Scissors aria-hidden="true" className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t('hdrTailorLogin')}</span>
            </button>
          )}

          {/* Overflow Menu (Three dots) */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-12 h-12 inline-flex items-center justify-center shrink-0 rounded-lg border border-[var(--vt-line,#DDD5C8)] bg-white text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)] transition-colors cursor-pointer"
              aria-label={t('hdrMenu')}
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
                    {t('hdrMenu')}
                  </div>
                  {FEATURE_DIRECTORY && (
<button
                    onClick={() => {
                      onNavigate('/tailors');
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 min-h-[48px] rounded-lg hover:bg-[#F7F3EC] flex items-center gap-2 cursor-pointer font-medium"
                  >
                    <Store className="w-4 h-4 text-[var(--vt-thread,#2E3A87)]" />
                    <span>{t('navFindTailor')}</span>
                  </button>
)}
                  <button
                    onClick={() => {
                      onNavigate('/start');
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 min-h-[48px] rounded-lg hover:bg-[#F7F3EC] flex items-center gap-2 cursor-pointer"
                  >
                    <Scissors className="w-4 h-4 text-[var(--vt-thread,#2E3A87)]" />
                    <span>{t('hdrMeasure')}</span>
                  </button>
                  <button
                    onClick={() => {
                      onNavigate('/me');
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 min-h-[48px] rounded-lg hover:bg-[#F7F3EC] flex items-center gap-2 cursor-pointer"
                  >
                    <Layers className="w-4 h-4 text-emerald-600" />
                    <span>{t('hdrMine')}</span>
                  </button>
                  <button
                    onClick={() => {
                      onNavigate('/sheet');
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 min-h-[48px] rounded-lg hover:bg-[#F7F3EC] flex items-center gap-2 cursor-pointer"
                  >
                    <BookOpen className="w-4 h-4 text-indigo-600" />
                    <span>{t('hdrSheet')}</span>
                  </button>
                  <button
                    onClick={() => {
                      onNavigate('/help');
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 min-h-[48px] rounded-lg hover:bg-[#F7F3EC] flex items-center gap-2 cursor-pointer"
                  >
                    <BookOpen className="w-4 h-4 text-amber-600" />
                    <span>{t('hdrHelp')}</span>
                  </button>
                  <button
                    onClick={() => {
                      onNavigate('/privacy');
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 min-h-[48px] rounded-lg hover:bg-[#F7F3EC] flex items-center gap-2 cursor-pointer"
                  >
                    <Shield className="w-4 h-4 text-slate-600" />
                    <span>{t('hdrPrivacy')}</span>
                  </button>

                  {(import.meta.env.DEV || import.meta.env.MODE === 'mock') && (
<>
<div className="my-1 border-t border-[var(--vt-line,#DDD5C8)]/50" />

                  <button
                    onClick={() => {
                      onNavigate('/dev/ui');
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 min-h-[48px] flex items-center rounded-lg hover:bg-[#F7F3EC] text-xs text-[var(--vt-ink-muted,#5C554C)] cursor-pointer"
                  >
                    UI Component Gallery (/dev/ui)
                  </button>
                  <button
                    onClick={() => {
                      onNavigate('/dev/capture-tuning');
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-3 min-h-[48px] flex items-center rounded-lg hover:bg-[#F7F3EC] text-xs text-[var(--vt-ink-muted,#5C554C)] cursor-pointer"
                  >
                    Capture Tuning &amp; Simulation (/dev)
                  </button>
</>
)}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
