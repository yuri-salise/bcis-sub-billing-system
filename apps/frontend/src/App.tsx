import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './state/AuthContext.js';
import { ConfigProvider } from './state/ConfigContext.js';
import { HeaderBar } from './components/HeaderBar.js';
import { SidebarNav, WorkspaceView } from './components/SidebarNav.js';
import { LockOverlay } from './components/LockOverlay.js';
import { AccessDeniedView } from './components/AccessDeniedView.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { CashierWorkspace } from './workspaces/CashierWorkspace.js';
import { BillingAdminWorkspace } from './workspaces/BillingAdminWorkspace.js';
import { CollectionsWorkspace } from './workspaces/CollectionsWorkspace.js';
import { ServiceOrdersWorkspace } from './workspaces/ServiceOrdersWorkspace.js';
import { ReportsWorkspace } from './workspaces/ReportsWorkspace.js';
import { SettingsWorkspace } from './workspaces/SettingsWorkspace.js';
import { canAccessWorkspace, getDefaultWorkspace, getAllowedWorkspaces } from './auth/rbac.js';

const MainLayout: React.FC = () => {
  const { lockScreen, activeRole } = useAuth();
  const [currentView, setCurrentView] = useState<WorkspaceView>(() => getDefaultWorkspace(activeRole));

  // Automatically adapt workspace view whenever active role changes
  useEffect(() => {
    if (!canAccessWorkspace(activeRole, currentView)) {
      setCurrentView(getDefaultWorkspace(activeRole));
    }
  }, [activeRole]);

  // Safe navigation function checking RBAC clearance
  const navigateToView = (targetView: WorkspaceView) => {
    if (canAccessWorkspace(activeRole, targetView)) {
      setCurrentView(targetView);
    } else {
      // If unauthorized, still allow setting currentView so AccessDeniedView is explicitly displayed
      setCurrentView(targetView);
    }
  };

  // Global Keyboard Shortcuts (Hotkeys mapped to permitted workspaces)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');
      const isModalOpen = Boolean(document.querySelector('.glass-modal, [role="dialog"]'));

      // Ctrl+L or Cmd+L -> Lock Workstation
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        lockScreen();
        return;
      }

      // If typing inside an input or if a modal is open, do not trigger workspace switching
      if (isModalOpen || isInputFocused) {
        return;
      }

      // In POS workspace, F1 is reserved for Accept Payment
      if (currentView === 'pos' && e.key === 'F1') {
        return;
      }

      // F1 through F6 -> Fast workspace switching mapped to user's permitted views
      const allowedViews = getAllowedWorkspaces(activeRole);
      if (e.key === 'F1' && allowedViews.length > 0) { e.preventDefault(); setCurrentView(allowedViews[0]); }
      if (e.key === 'F2' && allowedViews.length > 1) { e.preventDefault(); setCurrentView(allowedViews[1]); }
      if (e.key === 'F3' && allowedViews.length > 2) { e.preventDefault(); setCurrentView(allowedViews[2]); }
      if (e.key === 'F4' && allowedViews.length > 3) { e.preventDefault(); setCurrentView(allowedViews[3]); }
      if (e.key === 'F5' && allowedViews.length > 4) { e.preventDefault(); setCurrentView(allowedViews[4]); }
      if (e.key === 'F6' && allowedViews.length > 5) { e.preventDefault(); setCurrentView(allowedViews[5]); }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lockScreen, activeRole, currentView]);

  const isAuthorized = canAccessWorkspace(activeRole, currentView);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {/* Header Navigation Bar */}
      <HeaderBar onOpenSettings={() => navigateToView('settings')} />

      {/* Main Body Split: Left Sidebar & Right Workspace Canvas */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <SidebarNav
          currentView={currentView}
          onSelectView={navigateToView}
          activeRole={activeRole}
        />

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, backgroundColor: 'var(--bg-app)', overflow: 'hidden' }}>
          {!isAuthorized ? (
            <AccessDeniedView
              view={currentView}
              activeRole={activeRole}
              onReturnToAllowed={() => setCurrentView(getDefaultWorkspace(activeRole))}
            />
          ) : (
            <ErrorBoundary key={currentView} onReset={() => setCurrentView(getDefaultWorkspace(activeRole))}>
              {currentView === 'pos' && <CashierWorkspace />}
              {currentView === 'billing' && <BillingAdminWorkspace />}
              {currentView === 'collections' && <CollectionsWorkspace />}
              {currentView === 'tech' && <ServiceOrdersWorkspace />}
              {currentView === 'reports' && <ReportsWorkspace />}
              {currentView === 'settings' && <SettingsWorkspace />}
            </ErrorBoundary>
          )}
        </main>
      </div>

      {/* Screen Lock Security Overlay */}
      <LockOverlay />
    </div>
  );
};

import { LoginView } from './components/LoginView.js';

const AuthGuard: React.FC = () => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <LoginView />;
  }
  return <MainLayout />;
};

export const App: React.FC = () => {
  return (
    <ConfigProvider>
      <AuthProvider>
        <AuthGuard />
      </AuthProvider>
    </ConfigProvider>
  );
};

export default App;
