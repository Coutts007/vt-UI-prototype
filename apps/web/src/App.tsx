import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { apiClient } from './api/instance';
import { readSessionUser } from './api/session';
import { Header } from './components/ui/Header';
import { Banner, Skeleton, Toast } from './components/ui/feedback';
import { I18nProvider, useI18n } from './i18n';
import { FEATURE_DIRECTORY } from './config/features';
import { guard, homeFor, matchRoute, ROUTES, RouteDef, safeNext } from './router/routes';
import { VIEWS, ViewContext } from './router/views';
import { DETAILS_CLEARED_EVENT } from './db/events';
import './sw/install';
import { registerServiceWorker } from './sw/register';
import type { UserAccount } from './types/api';
import type { TranslationKey } from './i18n/en';
import { ErrorBoundary, ErrorPage } from './views/ErrorPage';

const DIRECTORY: RouteDef = { pattern: '/tailors', area: 'client' };
const routes = FEATURE_DIRECTORY ? [...ROUTES, DIRECTORY] : ROUTES;

function codeFrom(search: string): string {
  return new URLSearchParams(search).get('code')?.toUpperCase() ?? '';
}

function Shell() {
  const { t } = useI18n();
  const [location, setLocation] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));
  const [user, setUser] = useState<UserAccount | null>(readSessionUser);
  const [studyMode, setStudyMode] = useState<boolean | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [applyUpdate, setApplyUpdate] = useState<(() => void) | null>(null);
  const [initialCode, setInitialCode] = useState(() => codeFrom(window.location.search));
  const [syncNotice, setSyncNotice] = useState<TranslationKey | null>(null);

  const navigate = (path: string) => {
    const url = new URL(path, window.location.origin);
    const code = codeFrom(url.search);
    if (code) setInitialCode(code);
    window.history.pushState({}, '', url.pathname + url.search);
    setLocation({ pathname: url.pathname, search: url.search });
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    const onPop = () => setLocation({ pathname: window.location.pathname, search: window.location.search });
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('popstate', onPop);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    void apiClient
      .get('/settings/public')
      .then((settings) => setStudyMode(settings.study_mode))
      .catch(() => setStudyMode(false));
    registerServiceWorker((apply) => setApplyUpdate(() => apply));
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const match = useMemo(() => matchRoute(location.pathname, routes), [location.pathname]);
  const result = guard(match, user, { studyMode: studyMode ?? false, dev: import.meta.env.DEV || import.meta.env.MODE === 'mock' });

  // Study routes wait for the setting, so they never flash a wrong 404.
  const waiting = Boolean(match?.route.study) && studyMode === null;

  useEffect(() => {
    if (waiting) return;
    if (result === 'login') {
      navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    } else if (result === 'pending') {
      navigate('/register/pending');
    }
  }, [result, waiting, location.pathname, location.search]);

  const context: ViewContext = {
    params: match?.params ?? {},
    query: new URLSearchParams(location.search),
    navigate,
    user,
    initialCode,
    onLogin: (next) => {
      setUser(next);
      const wanted = new URLSearchParams(window.location.search).get('next');
      navigate(safeNext(wanted, window.location.origin) ?? homeFor(next.role));
    },
    onLogout: () => {
      sessionStorage.removeItem('vt_session_user');
      void import('./api/client').then(({ api }) => api.logout());
      setUser(null);
      navigate('/login');
    },
  };

  // Client pages only, loaded after the first paint so it never counts against the first screen.
  const clientArea = match?.route.area === 'client';
  useEffect(() => {
    // A clear ends that client's session, so their code from the link goes too.
    const forget = () => {
      setInitialCode('');
      if (codeFrom(window.location.search)) window.history.replaceState(null, '', window.location.pathname);
    };
    window.addEventListener(DETAILS_CLEARED_EVENT, forget);
    return () => window.removeEventListener(DETAILS_CLEARED_EVENT, forget);
  }, []);
  useEffect(() => {
    if (!clientArea) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('./db/sync').then(async ({ startSyncLoop, onSyncChange, readNotice }) => {
      if (cancelled) return;
      const refresh = async () => {
        const notice = await readNotice();
        const persisted = (await navigator.storage?.persisted?.()) ?? true;
        setSyncNotice(
          notice.needsHelp
            ? 'syncNeedsHelp'
            : notice.rejected
              ? 'syncRejectedNotice'
              : notice.overdue
              ? 'syncOverdue'
              : notice.unsent && !persisted
                ? 'storageWarning'
                : null,
        );
      };
      void navigator.storage?.persist?.().catch(() => false);
      const offChange = onSyncChange(() => void refresh());
      const offLoop = startSyncLoop(apiClient);
      stop = () => {
        offChange();
        offLoop();
      };
      await refresh();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [clientArea]);

  const home = () => navigate(user?.status === 'active' ? homeFor(user.role) : '/');

  let content: React.ReactNode;
  if (waiting || result === 'login' || result === 'pending') {
    content = <Skeleton />;
  } else if (result === 'not-found') {
    content = <ErrorPage titleKey="errorNotFoundTitle" bodyKey="errorNotFoundBody" onHome={home} />;
  } else if (result === 'forbidden') {
    content = <ErrorPage titleKey="errorForbiddenTitle" bodyKey="errorForbiddenBody" onHome={home} />;
  } else if (result === 'disabled') {
    content = <ErrorPage titleKey="errorDisabledTitle" bodyKey="errorDisabledBody" onHome={home} />;
  } else {
    content = VIEWS[match!.route.pattern](context);
  }

  return (
    <div className="min-h-screen bg-[var(--vt-chalk)] text-[var(--vt-ink)] flex flex-col font-sans">
      <a href="#content" className="vt-skip-link">
        {t('skipToContent')}
      </a>
      {!match?.route.fullscreen && (
        <Header
          currentPath={location.pathname}
          onNavigate={navigate}
          currentUser={user}
          onLogout={context.onLogout}
        />
      )}
      {!online && <Banner tone="warn">{t('offlineBanner')}</Banner>}
      {clientArea && syncNotice && !match?.route.fullscreen && <Banner tone="warn">{t(syncNotice)}</Banner>}
      <div id="content" className="flex-1 flex flex-col">
        <ErrorBoundary
          key={location.pathname}
          fallback={<ErrorPage titleKey="errorGenericTitle" bodyKey="errorNotFoundBody" onHome={home} />}
        >
          <Suspense fallback={<Skeleton />}>{content}</Suspense>
        </ErrorBoundary>
      </div>
      {applyUpdate && (
        <Toast actionLabel={t('updateApply')} onAction={applyUpdate}>
          {t('updateAvailable')}
        </Toast>
      )}
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  );
}
