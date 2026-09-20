import { UserRole } from '@bcis/shared-types';

export type WorkspaceView = 'pos' | 'billing' | 'collections' | 'tech' | 'reports' | 'settings';

/**
 * Strict role-to-workspace authorization matrix following docs/rbac-matrix.md
 */
export const WORKSPACE_ROLE_ACCESS: Record<WorkspaceView, UserRole[]> = {
  pos: [
    UserRole.CASHIER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ],
  billing: [
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ],
  collections: [
    UserRole.COLLECTION_SUPERVISOR,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.ACCOUNTING,
  ],
  tech: [
    UserRole.TECHNICIAN,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.COLLECTION_SUPERVISOR,
  ],
  reports: [
    UserRole.ACCOUNTING,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ],
  settings: [
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ],
};

export interface WorkspaceDefinition {
  id: WorkspaceView;
  label: string;
  description: string;
  defaultHotkey: string;
}

export const WORKSPACE_DEFINITIONS: Record<WorkspaceView, WorkspaceDefinition> = {
  pos: {
    id: 'pos',
    label: 'Cashier POS',
    description: 'Payments & Official Receipts',
    defaultHotkey: 'F1',
  },
  billing: {
    id: 'billing',
    label: 'Billing & Admin',
    description: 'Monthly Batches & Plans',
    defaultHotkey: 'F2',
  },
  collections: {
    id: 'collections',
    label: 'Collections & Routes',
    description: 'Field Run Sheets & Arrears',
    defaultHotkey: 'F3',
  },
  tech: {
    id: 'tech',
    label: 'Service Orders',
    description: 'Installations & Field Tech',
    defaultHotkey: 'F4',
  },
  reports: {
    id: 'reports',
    label: 'Reports & Aging',
    description: '5-Bucket AR & CSV Export',
    defaultHotkey: 'F5',
  },
  settings: {
    id: 'settings',
    label: 'LAN & Hardware',
    description: 'Server IP & Thermal Printer',
    defaultHotkey: 'F6',
  },
};

/**
 * Checks whether any of the supplied roles has authorization to enter the given workspace.
 * Super Admin possesses universal clearance.
 */
export function canAccessWorkspace(roles: UserRole[] | UserRole | undefined, view: WorkspaceView): boolean {
  if (!roles) return false;
  const roleList = Array.isArray(roles) ? roles : [roles];
  if (roleList.includes(UserRole.SUPER_ADMIN)) return true;

  const allowedRoles = WORKSPACE_ROLE_ACCESS[view];
  if (!allowedRoles) return false;

  return roleList.some((r) => allowedRoles.includes(r));
}

/**
 * Filters the list of all workspaces to those authorized for the provided roles.
 */
export function getAllowedWorkspaces(roles: UserRole[] | UserRole | undefined): WorkspaceView[] {
  if (!roles) return [];
  const allViews: WorkspaceView[] = ['pos', 'billing', 'collections', 'tech', 'reports', 'settings'];
  return allViews.filter((view) => canAccessWorkspace(roles, view));
}

/**
 * Returns the default workspace view for a primary operational role.
 */
export function getDefaultWorkspace(role: UserRole | undefined): WorkspaceView {
  switch (role) {
    case UserRole.CASHIER:
      return 'pos';
    case UserRole.COLLECTION_SUPERVISOR:
      return 'collections';
    case UserRole.TECHNICIAN:
      return 'tech';
    case UserRole.ACCOUNTING:
      return 'reports';
    case UserRole.ADMIN:
      return 'billing';
    case UserRole.SUPER_ADMIN:
    default:
      return 'pos';
  }
}

/**
 * Friendly label for user roles.
 */
export function getRoleDisplayName(role: UserRole): string {
  const map: Record<UserRole, string> = {
    [UserRole.SUPER_ADMIN]: 'Owner / Super Admin',
    [UserRole.ADMIN]: 'Administrator',
    [UserRole.CASHIER]: 'Cashier Counter',
    [UserRole.COLLECTION_SUPERVISOR]: 'Collection Supervisor',
    [UserRole.ACCOUNTING]: 'Accounting / Auditor',
    [UserRole.TECHNICIAN]: 'Field Technician',
    [UserRole.VIEWER]: 'Read-Only Viewer',
  };
  return map[role] || role;
}
