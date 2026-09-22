import React from 'react';
import { UserRole } from '@bcis/shared-types';
import { WorkspaceView, WORKSPACE_DEFINITIONS, canAccessWorkspace } from '../auth/rbac.js';
import {
  IconCreditCard,
  IconFileSpreadsheet,
  IconMap,
  IconWrench,
  IconBarChart,
  IconSettings,
  IconLock,
} from './icons/index.js';

export { WorkspaceView };

interface SidebarNavProps {
  currentView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  activeRole: UserRole;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({ currentView, onSelectView, activeRole }) => {
  const allItems: Array<{
    id: WorkspaceView;
    icon: React.ReactNode;
  }> = [
    {
      id: 'pos',
      icon: <IconCreditCard size={18} strokeWidth={1.8} />,
    },
    {
      id: 'billing',
      icon: <IconFileSpreadsheet size={18} strokeWidth={1.8} />,
    },
    {
      id: 'collections',
      icon: <IconMap size={18} strokeWidth={1.8} />,
    },
    {
      id: 'tech',
      icon: <IconWrench size={18} strokeWidth={1.8} />,
    },
    {
      id: 'reports',
      icon: <IconBarChart size={18} strokeWidth={1.8} />,
    },
    {
      id: 'settings',
      icon: <IconSettings size={18} strokeWidth={1.8} />,
    },
  ];

  // Filter items based strictly on role permissions
  const visibleItems = allItems.filter((item) => canAccessWorkspace(activeRole, item.id));

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <div
          style={{
            fontSize: '11px',
            fontWeight: 700,
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            letterSpacing: '0.06em',
            padding: '4px 12px 8px',
          }}
        >
          Workspaces
        </div>

        {visibleItems.map((item, index) => {
          const def = WORKSPACE_DEFINITIONS[item.id];
          const isActive = currentView === item.id;
          // Hotkeys F1 through F<count> mapped cleanly to visible workspaces
          const hotkey = `F${index + 1}`;

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
                border: isActive ? '1px solid rgba(44, 87, 69, 0.25)' : '1px solid transparent',
                borderLeft: isActive ? '4px solid #2C5745' : '4px solid transparent',
                backgroundColor: isActive ? 'rgba(44, 87, 69, 0.08)' : 'transparent',
                color: isActive ? '#2C5745' : 'var(--text-secondary)',
                textAlign: 'left',
                width: '100%',
                fontWeight: isActive ? 700 : 500,
                fontSize: '13px',
                boxShadow: isActive ? '0 1px 3px rgba(44, 87, 69, 0.1)' : 'none',
                transition: 'all 160ms var(--ease-out)',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'var(--bg-subtle)';
                  e.currentTarget.style.transform = 'translateX(2px)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.transform = 'none';
                }
              }}
            >
              <div
                style={{
                  color: isActive ? '#2C5745' : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                  transform: isActive ? 'scale(1.05)' : 'none',
                  transition: 'transform 160ms ease',
                }}
              >
                {item.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ lineHeight: 1.25, color: isActive ? '#2C5745' : 'var(--text-primary)' }}>{def.label}</div>
                <div
                  style={{
                    fontSize: '11px',
                    color: isActive ? '#2C5745' : 'var(--text-tertiary)',
                    opacity: isActive ? 0.85 : 1,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {def.description}
                </div>
              </div>
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 5px',
                  borderRadius: '4px',
                  backgroundColor: isActive ? 'rgba(235, 125, 0, 0.12)' : 'var(--bg-subtle)',
                  color: isActive ? '#EB7D00' : 'var(--text-tertiary)',
                  border: isActive ? '1px solid rgba(235, 125, 0, 0.3)' : '1px solid var(--border-subtle)',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {hotkey}
              </span>
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
          color: 'var(--text-muted)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span>Quick Search</span>
          <kbd style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', padding: '1px 5px', borderRadius: '4px', color: 'var(--text-secondary)' }}>/</kbd>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <IconLock size={11} strokeWidth={2} />
            <span>Lock Session</span>
          </span>
          <kbd style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', padding: '1px 5px', borderRadius: '4px', color: 'var(--text-secondary)' }}>Ctrl+L</kbd>
        </div>
      </div>
    </aside>
  );
};
