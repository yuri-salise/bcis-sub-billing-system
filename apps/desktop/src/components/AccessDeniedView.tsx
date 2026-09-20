import React from 'react';
import { UserRole } from '@bcis/shared-types';
import { WorkspaceView, WORKSPACE_DEFINITIONS, WORKSPACE_ROLE_ACCESS, getRoleDisplayName } from '../auth/rbac.js';
import { IconShieldAlert, IconArrowLeft } from './icons/index.js';

interface AccessDeniedViewProps {
  view: WorkspaceView;
  activeRole: UserRole;
  onReturnToAllowed: () => void;
}

export const AccessDeniedView: React.FC<AccessDeniedViewProps> = ({
  view,
  activeRole,
  onReturnToAllowed,
}) => {
  const workspaceDef = WORKSPACE_DEFINITIONS[view];
  const allowedRoles = WORKSPACE_ROLE_ACCESS[view] || [];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        padding: '32px',
        textAlign: 'center',
        backgroundColor: 'var(--bg-app)',
        minHeight: 0,
      }}
    >
      <div
        className="apple-card"
        style={{
          maxWidth: '520px',
          width: '100%',
          padding: '40px 32px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '20px',
          boxShadow: 'var(--shadow-md)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '14px',
            backgroundColor: '#FFF1F2',
            border: '1px solid #FECDD3',
            color: '#E11D48',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconShieldAlert size={28} strokeWidth={2} />
        </div>

        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
            Access Restricted: {workspaceDef.label}
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Your current assigned role (<strong>{getRoleDisplayName(activeRole)}</strong>) does not have authorization
            to access the <strong>{workspaceDef.label}</strong> workspace.
          </p>
        </div>

        <div
          style={{
            width: '100%',
            padding: '12px 16px',
            backgroundColor: 'var(--bg-subtle)',
            borderRadius: '8px',
            border: '1px solid var(--border-subtle)',
            fontSize: '12px',
            textAlign: 'left',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
            Authorized Operational Roles:
          </div>
          <ul style={{ paddingLeft: '20px', color: 'var(--text-muted)', margin: 0 }}>
            {allowedRoles.map((role) => (
              <li key={role}>{getRoleDisplayName(role)}</li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          onClick={onReturnToAllowed}
          className="btn-primary"
          style={{ width: '100%', height: '40px', fontSize: '13px' }}
        >
          <IconArrowLeft size={16} strokeWidth={2} />
          <span>Return to Authorized Workspace</span>
        </button>
      </div>
    </div>
  );
};
