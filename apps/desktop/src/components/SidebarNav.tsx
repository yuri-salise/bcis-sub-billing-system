import React from 'react';

export type WorkspaceView = 'pos' | 'billing' | 'collections' | 'tech' | 'reports' | 'settings';

interface SidebarNavProps {
  currentView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({ currentView, onSelectView }) => {
  const navItems: Array<{
    id: WorkspaceView;
    label: string;
    description: string;
    hotkey?: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'pos',
      label: 'Cashier POS',
      description: 'Payments & Official Receipts',
      hotkey: 'F1',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
          <line x1="6" y1="15" x2="10" y2="15" />
        </svg>
      ),
    },
    {
      id: 'billing',
      label: 'Billing & Admin',
      description: 'Monthly Batches & Plans',
      hotkey: 'F2',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      ),
    },
    {
      id: 'collections',
      label: 'Collections & Routes',
      description: 'Field Run Sheets & Arrears',
      hotkey: 'F3',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
      ),
    },
    {
      id: 'tech',
      label: 'Service Orders',
      description: 'Installations & Field Tech',
      hotkey: 'F4',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      ),
    },
    {
      id: 'reports',
      label: 'Reports & Aging',
      description: '5-Bucket AR & CSV Export',
      hotkey: 'F5',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      ),
    },
    {
      id: 'settings',
      label: 'LAN & Hardware',
      description: 'Server IP & Thermal Printer',
      hotkey: 'F6',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
  ];

  return (
    <aside
      style={{
        width: '240px',
        backgroundColor: '#FFFFFF',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '16px 10px',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            letterSpacing: '0.05em',
            padding: '4px 12px 8px',
          }}
        >
          Workspaces
        </div>

        {navItems.map((item) => {
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectView(item.id)}
              className="pressable"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 12px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: isActive ? '#EFF6FF' : 'transparent',
                color: isActive ? '#0071E3' : 'var(--text-secondary)',
                textAlign: 'left',
                width: '100%',
                fontWeight: isActive ? 600 : 400,
                fontSize: '13px',
                boxShadow: isActive ? 'inset 0 0 0 1px rgba(0, 113, 227, 0.2)' : 'none',
              }}
            >
              <div
                style={{
                  color: isActive ? '#0071E3' : '#64748B',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {item.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ lineHeight: 1.2 }}>{item.label}</div>
                <div
                  style={{
                    fontSize: '11px',
                    color: isActive ? '#60A5FA' : 'var(--text-tertiary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {item.description}
                </div>
              </div>
              {item.hotkey && (
                <span
                  style={{
                    fontSize: '10px',
                    padding: '2px 4px',
                    borderRadius: '4px',
                    backgroundColor: isActive ? 'rgba(0, 113, 227, 0.1)' : '#F1F5F9',
                    color: isActive ? '#0071E3' : '#94A3B8',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {item.hotkey}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer shortcut hints */}
      <div
        style={{
          borderTop: '1px solid var(--border-subtle)',
          paddingTop: '12px',
          paddingLeft: '12px',
          paddingRight: '12px',
          fontSize: '11px',
          color: 'var(--text-tertiary)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span>Search</span>
          <kbd style={{ fontFamily: 'var(--font-mono)', background: '#F1F5F9', padding: '1px 4px', borderRadius: '3px' }}>/</kbd>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Lock Screen</span>
          <kbd style={{ fontFamily: 'var(--font-mono)', background: '#F1F5F9', padding: '1px 4px', borderRadius: '3px' }}>Ctrl+L</kbd>
        </div>
      </div>
    </aside>
  );
};
