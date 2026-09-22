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
        backgroundColor: '#2E2910',
        borderBottom: '1px solid rgba(235, 227, 167, 0.16)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        color: '#FFFFFF',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backdropFilter: 'blur(20px)',
        boxShadow: '0 2px 10px rgba(46, 41, 16, 0.25)',
      }}
    >
      {/* Brand & Station Info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '9px',
            backgroundColor: '#EB7D00',
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: '16px',
            letterSpacing: '-0.02em',
            boxShadow: '0 2px 8px rgba(235, 125, 0, 0.35)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
          }}
        >
          B
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '-0.01em', color: '#FFFFFF' }}>
              BCIS LAN Client
            </span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 7px',
                borderRadius: '5px',
                backgroundColor: 'rgba(235, 227, 167, 0.14)',
                color: '#EBE3A7',
                border: '1px solid rgba(235, 227, 167, 0.25)',
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
              }}
            >
              {printerConfig.stationId}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#EBE3A7', opacity: 0.8 }}>
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
          padding: '5px 14px',
          borderRadius: '20px',
          backgroundColor: 'rgba(0, 0, 0, 0.2)',
          border: '1px solid rgba(235, 227, 167, 0.14)',
          boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.2)',
        }}
      >
        <span
          className={isOnline ? 'pulse-green' : ''}
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: isOnline ? '#10B981' : '#EF4444',
            boxShadow: isOnline ? '0 0 8px #10B981' : 'none',
            display: 'inline-block',
          }}
        />
        <span style={{ fontSize: '12px', fontWeight: 500, color: isOnline ? '#EBE3A7' : '#FCA5A5' }}>
          {isOnline ? 'LAN Online' : 'LAN Offline (Demo Mode)'}
        </span>
        {isOnline && latencyMs !== null && (
          <span
            style={{
              fontSize: '11px',
              color: '#34D399',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              backgroundColor: 'rgba(52, 211, 153, 0.1)',
              padding: '1px 5px',
              borderRadius: '3px',
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
          <span style={{ fontSize: '12px', color: '#EBE3A7', opacity: 0.8 }}>Role:</span>
          <select
            value={activeRole}
            onChange={(e) => switchTestAccount(e.target.value as UserRole)}
            title="Quick switch account & role for testing"
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              backgroundColor: 'rgba(235, 227, 167, 0.12)',
              border: '1px solid rgba(235, 227, 167, 0.24)',
              color: '#FFFFFF',
              fontSize: '12px',
              cursor: 'pointer',
              outline: 'none',
              fontWeight: 600,
              fontFamily: 'inherit',
            }}
          >
            {testRoles.map((role) => (
              <option key={role} value={role} style={{ background: '#2E2910', color: '#FFFFFF' }}>
                {getRoleDisplayName(role)}
              </option>
            ))}
          </select>
        </div>

        {/* User Tag */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#FFFFFF' }}>{user?.fullName || 'Teller / User'}</div>
          <div style={{ fontSize: '10px', color: '#EBE3A7', opacity: 0.75 }}>@{user?.username || 'user'}</div>
        </div>

        {/* Lock Screen Button */}
        <button
          onClick={lockScreen}
          className="pressable"
          title="Lock Workstation (Ctrl+L)"
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 600,
            backgroundColor: 'rgba(235, 227, 167, 0.12)',
            color: '#EBE3A7',
            border: '1px solid rgba(235, 227, 167, 0.25)',
            borderRadius: '6px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            cursor: 'pointer',
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
            color: '#EBE3A7',
            opacity: 0.8,
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
