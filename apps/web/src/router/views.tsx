// Every screen loads on demand, so the client flow never downloads tailor, admin or study code.
import React, { lazy } from 'react';
import type { Landmark, MarkerObs, MeasurementProfile, UserAccount } from '../types/api';

function view<T extends string>(load: () => Promise<Record<T, React.ComponentType<any>>>, name: T) {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}

const client = {
  Welcome: view(() => import('../views/client/WelcomeView'), 'WelcomeView'),
  Start: view(() => import('../views/client/StartView'), 'StartView'),
  Consent: view(() => import('../views/client/ConsentView'), 'ConsentView'),
  Check: view(() => import('../views/client/PhoneCheckView'), 'PhoneCheckView'),
  Sheet: view(() => import('../views/client/SheetGuideView'), 'SheetGuideView'),
  Setup: view(() => import('../views/client/PhoneSetupView'), 'PhoneSetupView'),
  Capture: view(() => import('../views/client/CaptureView'), 'CaptureView'),
  Processing: view(() => import('../views/client/ProcessingView'), 'ProcessingView'),
  Review: view(() => import('../views/client/ReviewView'), 'ReviewView'),
  Saved: view(() => import('../views/client/SavedView'), 'SavedView'),
  Me: view(() => import('../views/client/MyMeasurementsView'), 'MyMeasurementsView'),
  Help: view(() => import('../views/client/HelpView'), 'HelpView'),
  Privacy: view(() => import('../views/client/PrivacyView'), 'PrivacyView'),
  Declined: view(() => import('../views/client/DeclinedView'), 'DeclinedView'),
  Directory: view(() => import('../views/client/BusinessDirectoryView'), 'BusinessDirectoryView'),
};
const auth = {
  Login: view(() => import('../views/auth/LoginView'), 'LoginView'),
  Register: view(() => import('../views/auth/RegisterView'), 'RegisterView'),
  Pending: view(() => import('../views/auth/PendingApprovalView'), 'PendingApprovalView'),
};
const tailor = {
  Layout: view(() => import('../views/tailor/TailorLayout'), 'TailorLayout'),
  Clients: view(() => import('../views/tailor/ClientListView'), 'ClientListView'),
  NewCode: view(() => import('../views/tailor/NewClientCodeView'), 'NewClientCodeView'),
  Client: view(() => import('../views/tailor/ClientDetailView'), 'ClientDetailView'),
  Profile: view(() => import('../views/tailor/ProfileDetailView'), 'ProfileDetailView'),
  Orders: view(() => import('../views/tailor/OrderQueueView'), 'OrderQueueView'),
  NewOrder: view(() => import('../views/tailor/NewOrderView'), 'NewOrderView'),
  Order: view(() => import('../views/tailor/OrderDetailView'), 'OrderDetailView'),
  OrderSheet: view(() => import('../views/tailor/OrderSheetView'), 'OrderSheetView'),
  Conflicts: view(() => import('../views/tailor/ConflictsView'), 'ConflictsView'),
  Audit: view(() => import('../views/tailor/AuditView'), 'AuditView'),
  Settings: view(() => import('../views/tailor/TailorSettingsView'), 'TailorSettingsView'),
};
const admin = {
  Accounts: view(() => import('../views/admin/AdminAccountsView'), 'AdminAccountsView'),
  Audit: view(() => import('../views/admin/AdminAuditView'), 'AdminAuditView'),
  Settings: view(() => import('../views/admin/AdminSettingsView'), 'AdminSettingsView'),
  Participants: view(() => import('../views/admin/AdminStudyParticipantsView'), 'AdminStudyParticipantsView'),
  Export: view(() => import('../views/admin/AdminStudyExportView'), 'AdminStudyExportView'),
};
const study = {
  Capture: view(() => import('../views/study/StudyCaptureView'), 'StudyCaptureView'),
  Reference: view(() => import('../views/study/StudyReferenceTapeView'), 'StudyReferenceTapeView'),
};
const Placeholder = lazy(() => import('../views/PlaceholderView'));

export type Burst = { landmarks: Landmark[]; marker: MarkerObs };

export interface ViewContext {
  params: Record<string, string>;
  query: URLSearchParams;
  navigate: (path: string) => void;
  user: UserAccount | null;
  onLogin: (user: UserAccount) => void;
  onLogout: () => void;
  initialCode: string;
  capture: {
    front: Burst | null;
    side: Burst | null;
    profile: MeasurementProfile | null;
    synced: boolean;
    setFront: (burst: Burst) => void;
    setSide: (burst: Burst) => void;
    setProfile: (profile: MeasurementProfile) => void;
    setSynced: (synced: boolean) => void;
  };
}

const EMPTY_BURST: Burst = {
  landmarks: [],
  marker: { corners: [], image_w: 1080, image_h: 1920, side_px: 110, confidence: 0.98 },
};

type Render = (c: ViewContext) => React.ReactElement;

function inTailorShell(c: ViewContext, path: string, content: React.ReactElement) {
  return (
    <tailor.Layout currentPath={path} onNavigate={c.navigate} currentUser={c.user!}>
      {content}
    </tailor.Layout>
  );
}

const shell = (path: string, render: Render): Render => (c) => inTailorShell(c, path, render(c));

export const VIEWS: Record<string, Render> = {
  '/': (c) => <client.Welcome onNavigate={c.navigate} initialCode={c.initialCode} />,
  '/start': (c) => <client.Start onNavigate={c.navigate} initialCode={c.initialCode} />,
  '/consent': (c) => <client.Consent onNavigate={c.navigate} />,
  '/check': (c) => <client.Check onNavigate={c.navigate} />,
  '/sheet': (c) => <client.Sheet onNavigate={c.navigate} />,
  '/setup': (c) => <client.Setup onNavigate={c.navigate} />,
  '/capture/front': (c) => (
    <client.Capture
      view="front"
      onCompleteView={(data: Burst) => {
        c.capture.setFront(data);
        c.navigate('/capture/side');
      }}
      onCancel={() => c.navigate('/setup')}
      onNavigate={c.navigate}
    />
  ),
  '/capture/side': (c) => (
    <client.Capture
      view="side"
      onCompleteView={(data: Burst) => {
        c.capture.setSide(data);
        c.navigate('/processing');
      }}
      onCancel={() => c.navigate('/setup')}
      onNavigate={c.navigate}
    />
  ),
  '/processing': (c) => (
    <client.Processing
      frontData={c.capture.front ?? EMPTY_BURST}
      sideData={c.capture.side ?? EMPTY_BURST}
      onComplete={(profile: MeasurementProfile) => {
        c.capture.setProfile(profile);
        c.navigate('/review');
      }}
    />
  ),
  '/review': (c) =>
    c.capture.profile ? (
      <client.Review
        profile={c.capture.profile}
        onRetake={(v: string) => c.navigate(v === 'front' ? '/capture/front' : '/capture/side')}
        onSaved={(synced: boolean) => {
          c.capture.setSynced(synced);
          c.navigate('/saved');
        }}
        onDiscard={() => c.navigate('/')}
      />
    ) : (
      <client.Welcome onNavigate={c.navigate} />
    ),
  '/saved': (c) => (
    <client.Saved
      synced={c.capture.synced}
      clientCode={c.capture.profile?.client_code ?? c.initialCode}
      onNavigate={c.navigate}
    />
  ),
  '/me': (c) => <client.Me onNavigate={c.navigate} />,
  '/me/:profileId': () => <Placeholder titleKey="savedProfileTitle" />,
  '/help': (c) => <client.Help onNavigate={c.navigate} />,
  '/privacy': (c) => <client.Privacy onNavigate={c.navigate} />,
  '/declined': (c) => <client.Declined onNavigate={c.navigate} />,
  '/tailors': (c) => <client.Directory onNavigate={c.navigate} />,

  '/login': (c) => <auth.Login onLoginSuccess={c.onLogin} onNavigate={c.navigate} />,
  '/register': (c) => <auth.Register onNavigate={c.navigate} />,
  '/register/pending': (c) => <auth.Pending onNavigate={c.navigate} />,

  '/t/clients': shell('/t/clients', (c) => <tailor.Clients onNavigate={c.navigate} />),
  '/t/clients/new': shell('/t/clients/new', (c) => <tailor.NewCode onNavigate={c.navigate} />),
  '/t/clients/:clientId': shell('/t/clients', (c) => (
    <tailor.Client clientId={c.params.clientId} onNavigate={c.navigate} />
  )),
  '/t/clients/:clientId/profiles/:profileId': shell('/t/clients', (c) => (
    <tailor.Profile clientId={c.params.clientId} profileId={c.params.profileId} onNavigate={c.navigate} />
  )),
  '/t/orders': shell('/t/orders', (c) => <tailor.Orders onNavigate={c.navigate} />),
  '/t/orders/new': shell('/t/orders', (c) => <tailor.NewOrder initialProfileId={c.query.get('profileId') ?? undefined} onNavigate={c.navigate} />),
  '/t/orders/:orderId': shell('/t/orders', (c) => (
    <tailor.Order orderId={c.params.orderId} onNavigate={c.navigate} />
  )),
  '/t/orders/:orderId/sheet': shell('/t/orders', (c) => (
    <tailor.OrderSheet orderId={c.params.orderId} onNavigate={c.navigate} />
  )),
  '/t/conflicts': shell('/t/conflicts', (c) => <tailor.Conflicts onNavigate={c.navigate} />),
  '/t/audit': shell('/t/audit', (c) => <tailor.Audit onNavigate={c.navigate} />),
  '/t/settings': shell('/t/settings', (c) => (
    <tailor.Settings currentUser={c.user!} onNavigate={c.navigate} onLogout={c.onLogout} />
  )),

  '/admin/accounts': (c) => <admin.Accounts onNavigate={c.navigate} />,
  '/admin/audit': (c) => <admin.Audit onNavigate={c.navigate} />,
  '/admin/settings': (c) => <admin.Settings onNavigate={c.navigate} />,
  '/admin/study/participants': (c) => <admin.Participants onNavigate={c.navigate} />,
  '/admin/study/measurers': () => <Placeholder titleKey="measurersTitle" />,
  '/admin/study/export': (c) => <admin.Export onNavigate={c.navigate} />,

  '/study/capture': (c) => <study.Capture initialParticipantCode={c.query.get('participant') ?? undefined} onNavigate={c.navigate} />,
  '/study/reference': (c) => (
    <study.Reference onNavigate={c.navigate} measurerCode={c.user?.measurer_code ?? ''} />
  ),

};

// Dead code outside dev and mock builds, so production ships no developer screens.
if (import.meta.env.DEV || import.meta.env.MODE === 'mock') {
  const Gallery = view(() => import('../views/dev/DevGalleryView'), 'DevGalleryView');
  const Tuning = view(() => import('../views/dev/DevCaptureTuningView'), 'DevCaptureTuningView');
  VIEWS['/dev/ui'] = () => <Gallery />;
  VIEWS['/dev/capture-tuning'] = () => <Tuning />;
}
