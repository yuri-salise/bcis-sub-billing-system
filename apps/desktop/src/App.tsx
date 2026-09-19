import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './state/AuthContext.js';
import { ConfigProvider } from './state/ConfigContext.js';
import { HeaderBar } from './components/HeaderBar.js';
import { SidebarNav, WorkspaceView } from './components/SidebarNav.js';
import { LockOverlay } from './components/LockOverlay.js';
import { CashierWorkspace } from './workspaces/CashierWorkspace.js';
import { BillingAdminWorkspace } from './workspaces/BillingAdminWorkspace.js';
import { CollectionsWorkspace } from './workspaces/CollectionsWorkspace.js';
import { ServiceOrdersWorkspace } from './workspaces/ServiceOrdersWorkspace.js';
import { ReportsWorkspace } from './workspaces/ReportsWorkspace.js';
import { SettingsWorkspace } from './workspaces/SettingsWorkspace.js';
import { UserRole } from '@bcis/shared-types';

const MainLayout: React.FC = () => {
  const [currentView, setCurrentView] = useState<WorkspaceView>('pos');
  const { lockScreen, activeRole } = useAuth();

  // Automatically adapt default workspace view based on active role
  useEffect(() => {
    switch (activeRole) {
      case UserRole.CASHIER:
        setCurrentView('pos');
        break;
      case UserRole.ADMIN:
      case UserRole.SUPER_ADMIN:
        // Keeps user choice or defaults to pos
        break;
      case UserRole.COLLECTION_SUPERVISOR:
        setCurrentView('collections');
        break;
      case UserRole.TECHNICIAN:
        setCurrentView('tech');
        break;
      case UserRole.ACCOUNTING:
        setCurrentView('reports');
        break;
    }
  }, [activeRole]);

  // Global Keyboard Shortcuts (Apple macOS style)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+L or Cmd+L -> Lock Workstation
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        lockScreen();
      }

      // F1 through F6 -> Fast workspace switching
      if (e.key === 'F1') { e.preventDefault(); setCurrentView('pos'); }
      if (e.key === 'F2') { e.preventDefault(); setCurrentView('billing'); }
      if (e.key === 'F3') { e.preventDefault(); setCurrentView('collections'); }
      if (e.key === 'F4') { e.preventDefault(); setCurrentView('tech'); }
      if (e.key === 'F5') { e.preventDefault(); setCurrentView('reports'); }
      if (e.key === 'F6') { e.preventDefault(); setCurrentView('settings'); }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lockScreen]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {/* Apple Translucent Navigation Bar */}
      <HeaderBar onOpenSettings={() => setCurrentView('settings')} />

      {/* Main Body Split: Left Sidebar & Right Workspace Canvas */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <SidebarNav currentView={currentView} onSelectView={setCurrentView} />

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, backgroundColor: 'var(--bg-app)', overflow: 'hidden' }}>
          {currentView === 'pos' && <CashierWorkspace />}
          {currentView === 'billing' && <BillingAdminWorkspace />}
          {currentView === 'collections' && <CollectionsWorkspace />}
          {currentView === 'tech' && <ServiceOrdersWorkspace />}
          {currentView === 'reports' && <ReportsWorkspace />}
          {currentView === 'settings' && <SettingsWorkspace />}
        </main>
      </div>

      {/* Screen Lock Security Overlay */}
      <LockOverlay />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ConfigProvider>
      <AuthProvider>
        <MainLayout />
      </AuthProvider>
    </ConfigProvider>
  );
};

export default App;
