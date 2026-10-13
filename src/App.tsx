import React, { useState, useEffect } from 'react';
import { I18nProvider } from './i18n';
import { UserAccount, Landmark, MarkerObs, MeasurementProfile } from './types/api';
import { api } from './api/client';
import { Header } from './components/ui/Header';

// Client Views
import { WelcomeView } from './views/client/WelcomeView';
import { StartView } from './views/client/StartView';
import { ConsentView } from './views/client/ConsentView';
import { PhoneCheckView } from './views/client/PhoneCheckView';
import { SheetGuideView } from './views/client/SheetGuideView';
import { PhoneSetupView } from './views/client/PhoneSetupView';
import { CaptureView } from './views/client/CaptureView';
import { ProcessingView } from './views/client/ProcessingView';
import { ReviewView } from './views/client/ReviewView';
import { SavedView } from './views/client/SavedView';
import { MyMeasurementsView } from './views/client/MyMeasurementsView';
import { HelpView } from './views/client/HelpView';
import { PrivacyView } from './views/client/PrivacyView';
import { DeclinedView } from './views/client/DeclinedView';

// Tailor Views
import { TailorLayout } from './views/tailor/TailorLayout';
import { ClientListView } from './views/tailor/ClientListView';
import { NewClientCodeView } from './views/tailor/NewClientCodeView';
import { ClientDetailView } from './views/tailor/ClientDetailView';
import { ProfileDetailView } from './views/tailor/ProfileDetailView';
import { OrderQueueView } from './views/tailor/OrderQueueView';
import { NewOrderView } from './views/tailor/NewOrderView';
import { OrderDetailView } from './views/tailor/OrderDetailView';
import { OrderSheetView } from './views/tailor/OrderSheetView';
import { ConflictsView } from './views/tailor/ConflictsView';
import { AuditView } from './views/tailor/AuditView';
import { TailorSettingsView } from './views/tailor/TailorSettingsView';

// Admin Views
import { AdminAccountsView } from './views/admin/AdminAccountsView';
import { AdminAuditView } from './views/admin/AdminAuditView';
import { AdminSettingsView } from './views/admin/AdminSettingsView';
import { AdminStudyParticipantsView } from './views/admin/AdminStudyParticipantsView';
import { AdminStudyExportView } from './views/admin/AdminStudyExportView';

// Study Views
import { StudyCaptureView } from './views/study/StudyCaptureView';
import { StudyReferenceTapeView } from './views/study/StudyReferenceTapeView';

// Auth Views
import { LoginView } from './views/auth/LoginView';
import { RegisterView } from './views/auth/RegisterView';
import { PendingApprovalView } from './views/auth/PendingApprovalView';

// Dev Views
import { DevGalleryView } from './views/dev/DevGalleryView';
import { DevCaptureTuningView } from './views/dev/DevCaptureTuningView';

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const p = window.location.pathname;
      return p === '/' || p === '' ? '/' : p;
    }
    return '/';
  });

  const [initialCode, setInitialCode] = useState<string>('');
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => api.getCurrentUser());

  // In-flight capture state
  const [frontBurst, setFrontBurst] = useState<{ landmarks: Landmark[]; marker: MarkerObs } | null>(null);
  const [sideBurst, setSideBurst] = useState<{ landmarks: Landmark[]; marker: MarkerObs } | null>(null);
  const [computedProfile, setComputedProfile] = useState<MeasurementProfile | null>(null);
  const [lastSyncStatus, setLastSyncStatus] = useState<boolean>(true);

  // Check URL query parameters (e.g. ?code=AB1234 or ?participant=P001)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const codeParam = params.get('code');
      if (codeParam) {
        setInitialCode(codeParam.toUpperCase());
      }
    }
  }, []);

  const navigate = (path: string) => {
    setCurrentPath(path);
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', path);
      window.scrollTo(0, 0);
    }
  };

  const handleLoginSuccess = (user: UserAccount) => {
    setCurrentUser(user);
    if (user.role === 'tailor') {
      navigate('/t/orders');
    } else if (user.role === 'admin') {
      navigate('/admin/accounts');
    } else if (user.role === 'measurer') {
      navigate('/study/reference');
    } else {
      navigate('/');
    }
  };

  const handleLogout = () => {
    api.logout();
    setCurrentUser(null);
    navigate('/login');
  };

  // Render sub-view based on current path
  const renderContent = () => {
    // Dev Tools
    if (currentPath === '/dev/ui') return <DevGalleryView />;
    if (currentPath === '/dev/capture-tuning') return <DevCaptureTuningView />;

    // Auth
    if (currentPath === '/login') {
      return <LoginView onLoginSuccess={handleLoginSuccess} onNavigate={navigate} />;
    }
    if (currentPath === '/register') {
      return <RegisterView onNavigate={navigate} />;
    }
    if (currentPath === '/register/pending') {
      return <PendingApprovalView onNavigate={navigate} />;
    }

    // Client Capture Flow
    if (currentPath === '/') {
      return <WelcomeView onNavigate={navigate} initialCode={initialCode} />;
    }
    if (currentPath.startsWith('/start')) {
      return <StartView onNavigate={navigate} initialCode={initialCode} />;
    }
    if (currentPath === '/consent') {
      return <ConsentView onNavigate={navigate} />;
    }
    if (currentPath === '/declined') {
      return <DeclinedView onNavigate={navigate} />;
    }
    if (currentPath === '/check') {
      return <PhoneCheckView onNavigate={navigate} />;
    }
    if (currentPath === '/sheet') {
      return <SheetGuideView onNavigate={navigate} />;
    }
    if (currentPath === '/setup') {
      return <PhoneSetupView onNavigate={navigate} />;
    }
    if (currentPath === '/capture/front') {
      return (
        <CaptureView
          view="front"
          onCompleteView={(data) => {
            setFrontBurst(data);
            navigate('/capture/side');
          }}
          onCancel={() => navigate('/setup')}
          onNavigate={navigate}
        />
      );
    }
    if (currentPath === '/capture/side') {
      return (
        <CaptureView
          view="side"
          onCompleteView={(data) => {
            setSideBurst(data);
            navigate('/processing');
          }}
          onCancel={() => navigate('/setup')}
          onNavigate={navigate}
        />
      );
    }
    if (currentPath === '/processing') {
      // If bursts don't exist yet (direct link), fallback to synthetic data
      const frontData = frontBurst || {
        landmarks: [],
        marker: { corners: [], image_w: 1080, image_h: 1920, side_px: 110, confidence: 0.98 },
      };
      const sideData = sideBurst || {
        landmarks: [],
        marker: { corners: [], image_w: 1080, image_h: 1920, side_px: 110, confidence: 0.98 },
      };

      return (
        <ProcessingView
          frontData={frontData}
          sideData={sideData}
          onComplete={(profile) => {
            setComputedProfile(profile);
            navigate('/review');
          }}
        />
      );
    }
    if (currentPath === '/review') {
      if (!computedProfile) {
        // Fallback demo profile if user navigated directly
        return <WelcomeView onNavigate={navigate} />;
      }
      return (
        <ReviewView
          profile={computedProfile}
          onRetake={(v) => navigate(v === 'front' ? '/capture/front' : '/capture/side')}
          onSaved={(synced) => {
            setLastSyncStatus(synced);
            navigate('/saved');
          }}
          onDiscard={() => navigate('/')}
        />
      );
    }
    if (currentPath === '/saved') {
      return (
        <SavedView
          synced={lastSyncStatus}
          clientCode={computedProfile?.client_code || initialCode || 'AB1234'}
          onNavigate={navigate}
        />
      );
    }
    if (currentPath === '/me') {
      return <MyMeasurementsView onNavigate={navigate} />;
    }
    if (currentPath === '/help') {
      return <HelpView onNavigate={navigate} />;
    }
    if (currentPath === '/privacy') {
      return <PrivacyView onNavigate={navigate} />;
    }

    // Study Routes
    if (currentPath.startsWith('/study/capture')) {
      return <StudyCaptureView onNavigate={navigate} />;
    }
    if (currentPath === '/study/reference') {
      return (
        <StudyReferenceTapeView
          onNavigate={navigate}
          measurerCode={currentUser?.measurer_code || 'A'}
        />
      );
    }

    // Admin Routes
    if (currentPath === '/admin/accounts') {
      return <AdminAccountsView onNavigate={navigate} />;
    }
    if (currentPath === '/admin/audit') {
      return <AdminAuditView onNavigate={navigate} />;
    }
    if (currentPath === '/admin/settings') {
      return <AdminSettingsView onNavigate={navigate} />;
    }
    if (currentPath === '/admin/study/participants') {
      return <AdminStudyParticipantsView onNavigate={navigate} />;
    }
    if (currentPath === '/admin/study/export') {
      return <AdminStudyExportView onNavigate={navigate} />;
    }

    // Tailor Routes (wrapped in TailorLayout)
    if (currentPath.startsWith('/t/')) {
      const tailorUser: UserAccount = currentUser?.role === 'tailor' ? currentUser : {
        user_id: 'u-wanjiru',
        email: 'wanjiru@vt.test',
        role: 'tailor',
        status: 'active',
        business_name: 'Mama Wanjiru Tailors',
        phone: '+254712345678',
        area: 'Gikomba, Nairobi',
        locale: 'en',
        unit_pref: 'cm',
        created_at: new Date().toISOString(),
      };

      let subView = <OrderQueueView onNavigate={navigate} />;

      if (currentPath === '/t/clients') {
        subView = <ClientListView onNavigate={navigate} />;
      } else if (currentPath === '/t/clients/new') {
        subView = <NewClientCodeView onNavigate={navigate} />;
      } else if (currentPath.startsWith('/t/clients/') && currentPath.includes('/profiles/')) {
        const parts = currentPath.split('/');
        const clientId = parts[3];
        const profId = parts[5];
        subView = <ProfileDetailView clientId={clientId} profileId={profId} onNavigate={navigate} />;
      } else if (currentPath.startsWith('/t/clients/')) {
        const clientId = currentPath.replace('/t/clients/', '');
        subView = <ClientDetailView clientId={clientId} onNavigate={navigate} />;
      } else if (currentPath === '/t/orders') {
        subView = <OrderQueueView onNavigate={navigate} />;
      } else if (currentPath.startsWith('/t/orders/new')) {
        subView = <NewOrderView onNavigate={navigate} />;
      } else if (currentPath.endsWith('/sheet')) {
        const orderId = currentPath.replace('/t/orders/', '').replace('/sheet', '');
        subView = <OrderSheetView orderId={orderId} onNavigate={navigate} />;
      } else if (currentPath.startsWith('/t/orders/')) {
        const orderId = currentPath.replace('/t/orders/', '');
        subView = <OrderDetailView orderId={orderId} onNavigate={navigate} />;
      } else if (currentPath === '/t/conflicts') {
        subView = <ConflictsView onNavigate={navigate} />;
      } else if (currentPath === '/t/audit') {
        subView = <AuditView onNavigate={navigate} />;
      } else if (currentPath === '/t/settings') {
        subView = <TailorSettingsView currentUser={tailorUser} onNavigate={navigate} onLogout={handleLogout} />;
      }

      return (
        <TailorLayout
          currentPath={currentPath}
          onNavigate={navigate}
          currentUser={tailorUser}
        >
          {subView}
        </TailorLayout>
      );
    }

    // Fallback default
    return <WelcomeView onNavigate={navigate} initialCode={initialCode} />;
  };

  const isFullscreenCapture =
    currentPath === '/capture/front' || currentPath === '/capture/side';

  return (
    <I18nProvider>
      <div className="min-h-screen bg-[var(--vt-chalk,#F7F3EC)] text-[var(--vt-ink,#1F1C18)] flex flex-col font-sans selection:bg-[var(--vt-thread,#2E3A87)] selection:text-white">
        {/* Render Header on all non-fullscreen capture views */}
        {!isFullscreenCapture && (
          <Header
            currentPath={currentPath}
            onNavigate={navigate}
            currentUser={currentUser}
            onLogout={handleLogout}
          />
        )}

        {/* Dynamic Route Content */}
        <div className="flex-1 flex flex-col">{renderContent()}</div>
      </div>
    </I18nProvider>
  );
}
