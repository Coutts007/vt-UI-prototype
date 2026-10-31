import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { api } from './api/client';
import { Header } from './components/ui/Header';
import { Banner, Skeleton, Toast } from './components/ui/feedback';
import { I18nProvider, useI18n } from './i18n';
import { FEATURE_DIRECTORY } from './config/features';
import { guard, homeFor, matchRoute, ROUTES, RouteDef, safeNext } from './router/routes';
import { Burst, VIEWS, ViewContext } from './router/views';
import { registerServiceWorker } from './sw/register';
import type { MeasurementProfile, UserAccount } from './types/api';
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
  const [user, setUser] = useState<UserAccount | null>(() => api.getCurrentUser());
  const [studyMode, setStudyMode] = useState<boolean | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [applyUpdate, setApplyUpdate] = useState<(() => void) | null>(null);
  const [initialCode, setInitialCode] = useState(() => codeFrom(window.location.search));
  const [front, setFront] = useState<Burst | null>(null);
  const [side, setSide] = useState<Burst | null>(null);
  const [profile, setProfile] = useState<MeasurementProfile | null>(null);
  const [synced, setSynced] = useState(true);

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
    void api
      .getPublicSettings()
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
      api.logout();
      setUser(null);
      navigate('/login');
    },
    capture: { front, side, profile, synced, setFront, setSide, setProfile, setSynced },
  };

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
