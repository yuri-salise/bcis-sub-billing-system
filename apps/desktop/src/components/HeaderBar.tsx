import React from 'react';
import { UserRole } from '@bcis/shared-types';
import { useAuth } from '../state/AuthContext.js';
import { useConfig } from '../state/ConfigContext.js';
import { getRoleDisplayName } from '../auth/rbac.js';
import { IconLock, IconLogOut } from './icons/index.js';

interface HeaderBarProps {
  onOpenSettings?: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({ onOpenSettings }) => {
  const { user, activeRole, switchTestAccount, lockScreen, logout } = useAuth();
  const { isOnline, latencyMs, printerConfig } = useConfig();

  const testRoles: UserRole[] = [
    UserRole.CASHIER,
    UserRole.TECHNICIAN,
    UserRole.COLLECTION_SUPERVISOR,
    UserRole.ACCOUNTING,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ];

  return (
    <header
      style={{
        height: '56px',
        backgroundColor: '#0F172A',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        color: '#FFFFFF',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Brand & Station Info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            backgroundColor: '#0071E3',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: '15px',
            letterSpacing: '-0.02em',
            boxShadow: '0 2px 4px rgba(0, 113, 227, 0.3)',
          }}
        >
          B
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '-0.01em' }}>
              BCIS LAN Client
            </span>
            <span
              style={{
                fontSize: '11px',
                padding: '1px 6px',
                borderRadius: '4px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                color: '#94A3B8',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {printerConfig.stationId}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#94A3B8' }}>
            Bukidnon Cable & Internet Services
          </div>
        </div>
      </div>

      {/* Center: LAN Heartbeat & Latency Meter */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '4px 12px',
          borderRadius: '20px',
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: isOnline ? '#10B981' : '#EF4444',
            boxShadow: isOnline ? '0 0 8px #10B981' : 'none',
            display: 'inline-block',
          }}
        />
        <span style={{ fontSize: '12px', color: isOnline ? '#E2E8F0' : '#FCA5A5' }}>
          {isOnline ? 'LAN Online' : 'LAN Offline (Demo Mode)'}
        </span>
        {isOnline && latencyMs !== null && (
          <span
            style={{
              fontSize: '11px',
              color: '#10B981',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
            }}
          >
            {latencyMs}ms
          </span>
        )}
      </div>

      {/* Right: Role Switcher, Screen Lock & User Profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        {/* Role Display / Quick Account Switcher for Testing */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px', color: '#94A3B8' }}>Role:</span>
          <select
            value={activeRole}
            onChange={(e) => switchTestAccount(e.target.value as UserRole)}
            title="Quick switch account & role for testing"
            style={{
              padding: '4px 8px',
              borderRadius: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#FFFFFF',
              fontSize: '12px',
              cursor: 'pointer',
              outline: 'none',
              fontWeight: 500,
            }}
          >
            {testRoles.map((role) => (
              <option key={role} value={role} style={{ background: '#0F172A', color: '#FFF' }}>
                {getRoleDisplayName(role)}
              </option>
            ))}
          </select>
        </div>

        {/* User Tag */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '12px', fontWeight: 600 }}>{user?.fullName || 'Teller / User'}</div>
          <div style={{ fontSize: '10px', color: '#94A3B8' }}>@{user?.username || 'user'}</div>
        </div>

        {/* Lock Screen Button */}
        <button
          onClick={lockScreen}
          className="btn-secondary"
          title="Lock Workstation (Ctrl+L)"
          style={{
            padding: '5px 10px',
            fontSize: '12px',
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            color: '#FFFFFF',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <IconLock size={13} strokeWidth={2} />
          <span>Lock</span>
        </button>

        {/* Logout Button */}
        <button
          onClick={logout}
          title="Logout of session"
          style={{
            padding: '5px 8px',
            fontSize: '12px',
            backgroundColor: 'transparent',
            color: '#94A3B8',
            border: 'none',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <IconLogOut size={13} strokeWidth={2} />
          <span>Sign Out</span>
        </button>
      </div>
    </header>
  );
};
