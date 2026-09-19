import React from 'react';
import { UserRole } from '@bcis/shared-types';
import { useAuth } from '../state/AuthContext.js';
import { useConfig } from '../state/ConfigContext.js';

interface HeaderBarProps {
  onOpenSettings?: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({ onOpenSettings }) => {
  const { user, activeRole, setActiveRole, lockScreen, logout } = useAuth();
  const { isOnline, latencyMs, printerConfig } = useConfig();

  const roleLabels: Record<UserRole, string> = {
    [UserRole.SUPER_ADMIN]: 'Owner / Super Admin',
    [UserRole.ADMIN]: 'Administrator',
    [UserRole.CASHIER]: 'Cashier Counter',
    [UserRole.COLLECTION_SUPERVISOR]: 'Collection Supervisor',
    [UserRole.ACCOUNTING]: 'Accounting / Auditor',
    [UserRole.TECHNICIAN]: 'Field Technician',
    [UserRole.VIEWER]: 'Read-Only Viewer',
  };

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
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Role Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <label style={{ fontSize: '12px', color: '#94A3B8' }}>Role:</label>
          <select
            value={activeRole}
            onChange={(e) => setActiveRole(e.target.value as UserRole)}
            style={{
              padding: '4px 8px',
              borderRadius: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#FFFFFF',
              fontSize: '12px',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {Object.entries(roleLabels).map(([role, label]) => (
              <option key={role} value={role} style={{ background: '#0F172A', color: '#FFF' }}>
                {label}
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
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
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
          }}
        >
          Sign Out
        </button>
      </div>
    </header>
  );
};
