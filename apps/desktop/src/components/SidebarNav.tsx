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
                  flexShrink: 0,
                }}
              >
                {item.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ lineHeight: 1.2 }}>{def.label}</div>
                <div
                  style={{
                    fontSize: '11px',
                    color: isActive ? '#60A5FA' : 'var(--text-tertiary)',
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
                  padding: '2px 4px',
                  borderRadius: '4px',
                  backgroundColor: isActive ? 'rgba(0, 113, 227, 0.1)' : '#F1F5F9',
                  color: isActive ? '#0071E3' : '#94A3B8',
                  fontFamily: 'var(--font-mono)',
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
          color: 'var(--text-tertiary)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span>Quick Search</span>
          <kbd style={{ fontFamily: 'var(--font-mono)', background: '#F1F5F9', padding: '1px 4px', borderRadius: '3px' }}>/</kbd>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <IconLock size={11} strokeWidth={2} />
            <span>Lock Session</span>
          </span>
          <kbd style={{ fontFamily: 'var(--font-mono)', background: '#F1F5F9', padding: '1px 4px', borderRadius: '3px' }}>Ctrl+L</kbd>
        </div>
      </div>
    </aside>
  );
};
