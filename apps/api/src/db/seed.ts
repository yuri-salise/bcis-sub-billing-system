import { pool, db } from './client.js';
import { users, roles, permissions, rolePermissions, userRoles, serviceTypes } from './schema.js';
import { hashPassword } from '../utils/password.js';
import { PermissionCode, UserRole } from '@bcis/shared-types';
import { eq, notInArray } from 'drizzle-orm';
import { fileURLToPath } from 'url';

export interface PermissionSeedData {
  code: PermissionCode;
  module: string;
  description: string;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
}

export const BASE_PERMISSIONS: PermissionSeedData[] = [
  // 1. Subscriber Module
  { code: 'subscriber.view', module: 'subscriber', description: 'View subscriber list, profiles, and basic contact information', riskLevel: 'Low' },
  { code: 'subscriber.create', module: 'subscriber', description: 'Register new subscriber entity', riskLevel: 'Medium' },
  { code: 'subscriber.update', module: 'subscriber', description: 'Update subscriber profile details and addresses', riskLevel: 'Medium' },
  { code: 'subscriber.archive', module: 'subscriber', description: 'Deactivate/archive a subscriber (soft delete)', riskLevel: 'High' },

  // 2. Service Account Module
  { code: 'service_account.view', module: 'service_account', description: 'View service accounts and technical provisions', riskLevel: 'Low' },
  { code: 'service_account.create', module: 'service_account', description: 'Provision a new service account under a subscriber', riskLevel: 'Medium' },
  { code: 'service_account.update', module: 'service_account', description: 'Modify installation address, plan binding, or status', riskLevel: 'High' },

  // 3. Service Plan Module
  { code: 'service_plan.view', module: 'service_plan', description: 'View catalog of broadband and CATV plans', riskLevel: 'Low' },
  { code: 'service_plan.manage', module: 'service_plan', description: 'Create or update plans, pricing, and bandwidth tiers', riskLevel: 'High' },

  // 4. Billing Module
  { code: 'billing.view', module: 'billing', description: 'View invoices, line items, and billing history', riskLevel: 'Low' },
  { code: 'billing.generate', module: 'billing', description: 'Trigger monthly billing batch run', riskLevel: 'High' },
  { code: 'billing.adjust', module: 'billing', description: 'Issue debit/credit adjustment memos', riskLevel: 'High' },
  { code: 'billing.void', module: 'billing', description: 'Void an unpaid draft or incorrect invoice', riskLevel: 'Critical' },

  // 5. Payment Module
  { code: 'payment.view', module: 'payment', description: 'View counter payments, allocations, and receipts', riskLevel: 'Low' },
  { code: 'payment.create', module: 'payment', description: 'Receive payment, allocate funds, and issue receipt', riskLevel: 'Medium' },
  { code: 'payment.reverse', module: 'payment', description: 'Execute payment reversal and restore balances', riskLevel: 'Critical' },

  // 6. Receipt Module
  { code: 'receipt.view', module: 'receipt', description: 'View and preview issued official receipts', riskLevel: 'Low' },
  { code: 'receipt.reprint', module: 'receipt', description: 'Reprint duplicate copy of official receipt', riskLevel: 'Medium' },

  // 7. GCash Module
  { code: 'gcash.view', module: 'gcash', description: 'View pending and historical GCash verification queue', riskLevel: 'Low' },
  { code: 'gcash.submit', module: 'gcash', description: 'Upload screenshot and log incoming GCash transaction', riskLevel: 'Low' },
  { code: 'gcash.verify', module: 'gcash', description: 'Approve GCash proof and post payment to ledger', riskLevel: 'High' },
  { code: 'gcash.reject', module: 'gcash', description: 'Reject GCash proof with documented reason', riskLevel: 'Medium' },

  // 8. Collection Module
  { code: 'collection.view', module: 'collection', description: 'View collection areas, routes, and batch statuses', riskLevel: 'Low' },
  { code: 'collection.batch_create', module: 'collection', description: 'Open a new field collection batch and print route sheet', riskLevel: 'Medium' },
  { code: 'collection.enter_field', module: 'collection', description: 'Enter collected field receipts into a batch', riskLevel: 'Medium' },
  { code: 'collection.reconcile', module: 'collection', description: 'Verify cash count, calculate differences, record shortages', riskLevel: 'High' },
  { code: 'collection.manage_staff', module: 'collection', description: 'Manage collectors, routes, and commission settings', riskLevel: 'Medium' },

  // 9. Receivable Module
  { code: 'receivable.view', module: 'receivable', description: 'View accounts receivable lists and delinquency summary', riskLevel: 'Low' },
  { code: 'receivable.view_aging', module: 'receivable', description: 'Access AR aging buckets (Current, 1-30, 31-60, 61-90, 90+)', riskLevel: 'Medium' },

  // 10. Service Control Module
  { code: 'service_control.view', module: 'service_control', description: 'View suspension candidates and disconnection orders', riskLevel: 'Low' },
  { code: 'service_control.suspend', module: 'service_control', description: 'Approve and execute service suspension', riskLevel: 'High' },
  { code: 'service_control.reconnect', module: 'service_control', description: 'Approve and execute service reconnection', riskLevel: 'High' },

  // 11. Report Module
  { code: 'report.operational', module: 'report', description: 'Export operational reports (Subscriber list, Route sheets)', riskLevel: 'Medium' },
  { code: 'report.financial', module: 'report', description: 'Export financial reports (Daily collection, SOA, Revenue)', riskLevel: 'High' },

  // 12. User Module
  { code: 'user.manage', module: 'user', description: 'Create employees, assign roles, deactivate users', riskLevel: 'Critical' },
  { code: 'user.reset_password', module: 'user', description: 'Reset passwords for staff members', riskLevel: 'High' },

  // 13. Audit Module
  { code: 'audit.view', module: 'audit', description: 'Query and inspect immutable system audit trail', riskLevel: 'High' },
  { code: 'audit.export', module: 'audit', description: 'Export audit trail to PDF/XLSX', riskLevel: 'High' },

  // 14. Backup Module
  { code: 'backup.create', module: 'backup', description: 'Trigger on-demand database backup', riskLevel: 'High' },
  { code: 'backup.restore', module: 'backup', description: 'Restore database snapshot from archive', riskLevel: 'Critical' },

  // 15. Settings Module
  { code: 'settings.manage', module: 'settings', description: 'Update company info, billing cycles, late fee parameters', riskLevel: 'High' },
];

export const BASE_ROLES = [
  {
    code: UserRole.SUPER_ADMIN,
    name: 'Owner / Super Admin',
    description: 'Business owner or executive with unrestricted operational, financial, and administrative authority.',
  },
  {
    code: UserRole.ADMIN,
    name: 'Administrator',
    description: 'Office manager overseeing user accounts, service plans, billing batch runs, and general reporting.',
  },
  {
    code: UserRole.CASHIER,
    name: 'Cashier',
    description: 'Counter teller receiving payments, issuing receipts, and processing the GCash verification queue.',
  },
  {
    code: UserRole.COLLECTION_SUPERVISOR,
    name: 'Collection Supervisor',
    description: 'Operations coordinator overseeing field collectors, route sheets, collection batches, and remittance reconciliation.',
  },
  {
    code: UserRole.ACCOUNTING,
    name: 'Accounting / Auditor',
    description: 'Financial controller reviewing subscriber ledgers, AR aging, payment reversals, and tax/revenue reports.',
  },
  {
    code: UserRole.TECHNICIAN,
    name: 'Technician',
    description: 'Field staff recording service installations, disconnections, and reconnections.',
  },
  {
    code: UserRole.VIEWER,
    name: 'Read-only Viewer',
    description: 'Trainee, clerk, or auditor with non-modifying view access.',
  },
];

// Mapping according to Table 4 of docs/rbac-matrix.md
export const ROLE_PERMISSION_MAPPING: Record<UserRole, PermissionCode[]> = {
  [UserRole.SUPER_ADMIN]: BASE_PERMISSIONS.map((p) => p.code),
  [UserRole.ADMIN]: [
    'subscriber.view', 'subscriber.create', 'subscriber.update', 'subscriber.archive',
    'service_account.view', 'service_account.create', 'service_account.update',
    'service_plan.view', 'service_plan.manage',
    'billing.view', 'billing.generate', 'billing.adjust', 'billing.void',
    'payment.view', 'payment.create',
    'receipt.view', 'receipt.reprint',
    'gcash.view', 'gcash.submit', 'gcash.verify', 'gcash.reject',
    'collection.view', 'collection.batch_create', 'collection.enter_field', 'collection.reconcile', 'collection.manage_staff',
    'receivable.view', 'receivable.view_aging',
    'service_control.view', 'service_control.suspend', 'service_control.reconnect',
    'report.operational', 'report.financial',
    'user.manage', 'user.reset_password',
  ],
  [UserRole.CASHIER]: [
    'subscriber.view', 'service_account.view', 'service_plan.view',
    'billing.view', 'payment.view', 'payment.create',
    'receipt.view', 'receipt.reprint',
    'gcash.view', 'gcash.submit', 'gcash.verify', 'gcash.reject',
    'collection.view', 'receivable.view', 'service_control.view',
  ],
  [UserRole.COLLECTION_SUPERVISOR]: [
    'subscriber.view', 'service_account.view', 'service_plan.view',
    'billing.view', 'payment.view', 'receipt.view',
    'gcash.view', 'gcash.submit',
    'collection.view', 'collection.batch_create', 'collection.enter_field', 'collection.reconcile', 'collection.manage_staff',
    'receivable.view', 'receivable.view_aging',
    'service_control.view', 'service_control.suspend', 'service_control.reconnect',
    'report.operational',
  ],
  [UserRole.ACCOUNTING]: [
    'subscriber.view', 'service_account.view', 'service_plan.view',
    'billing.view', 'billing.adjust',
    'payment.view', 'payment.reverse',
    'receipt.view', 'receipt.reprint',
    'gcash.view',
    'collection.view', 'collection.reconcile',
    'receivable.view', 'receivable.view_aging',
    'service_control.view',
    'report.operational', 'report.financial',
    'audit.view', 'audit.export',
  ],
  [UserRole.TECHNICIAN]: [
    'subscriber.view', 'service_account.view', 'service_plan.view',
    'service_control.view', 'service_control.suspend', 'service_control.reconnect',
  ],
  [UserRole.VIEWER]: [
    'subscriber.view', 'service_account.view', 'service_plan.view',
    'billing.view', 'payment.view', 'receipt.view',
    'gcash.view', 'collection.view', 'receivable.view', 'service_control.view',
  ],
};

/**
 * Seeds permissions, base roles, role-permission mappings, and default Super Admin user.
 */
export async function seedDatabase(): Promise<void> {
  console.log('[Seed] Starting database seeding...');

  // 0. Seed Service Types
  const defaultServiceTypes = [
    { code: 'INTERNET', name: 'High-Speed Broadband Internet' },
    { code: 'CABLE', name: 'Digital Cable TV' },
    { code: 'CABLE_TV', name: 'Digital Cable TV' },
    { code: 'BUNDLE', name: 'Internet + Cable TV Bundle' },
    { code: 'COMBO', name: 'Internet + Cable TV Bundle' },
  ];
  for (const st of defaultServiceTypes) {
    await db.insert(serviceTypes).values(st).onConflictDoNothing({ target: serviceTypes.code });
  }

  // 1. Seed Permissions
  console.log(`[Seed] Inserting ${BASE_PERMISSIONS.length} permissions...`);
  const validCodes = BASE_PERMISSIONS.map((p) => p.code);
  await db.delete(permissions).where(notInArray(permissions.code, validCodes));
  for (const perm of BASE_PERMISSIONS) {
    await db
      .insert(permissions)
      .values(perm)
      .onConflictDoUpdate({
        target: permissions.code,
        set: {
          module: perm.module,
          description: perm.description,
          riskLevel: perm.riskLevel,
        },
      });
  }

  // 2. Seed Roles
  console.log(`[Seed] Inserting ${BASE_ROLES.length} roles...`);
  for (const role of BASE_ROLES) {
    await db
      .insert(roles)
      .values(role)
      .onConflictDoUpdate({
        target: roles.code,
        set: {
          name: role.name,
          description: role.description,
        },
      });
  }

  // 3. Fetch all role & permission IDs for mapping
  const allRoles = await db.select().from(roles);
  const allPerms = await db.select().from(permissions);

  const roleMap = new Map(allRoles.map((r) => [r.code, r.id]));
  const permMap = new Map(allPerms.map((p) => [p.code, p.id]));

  // 4. Seed Role-Permissions
  console.log('[Seed] Mapping permissions to roles...');
  const rolePermRows: Array<{ roleId: string; permissionId: string }> = [];
  for (const [roleCode, permCodes] of Object.entries(ROLE_PERMISSION_MAPPING)) {
    const roleId = roleMap.get(roleCode);
    if (!roleId) continue;

    for (const pCode of permCodes) {
      const permId = permMap.get(pCode);
      if (!permId) continue;
      rolePermRows.push({ roleId, permissionId: permId });
    }
  }

  if (rolePermRows.length > 0) {
    await db.insert(rolePermissions).values(rolePermRows).onConflictDoNothing();
  }

  // 5. Seed Initial Super Admin User
  const adminUsername = process.env.SEED_ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin123!';
  const superAdminRoleId = roleMap.get(UserRole.SUPER_ADMIN);

  if (superAdminRoleId) {
    const existingAdmin = await db
      .select()
      .from(users)
      .where(eq(users.username, adminUsername))
      .limit(1);

    let adminUserId: string;

    if (existingAdmin.length === 0) {
      console.log(`[Seed] Creating initial Super Admin: ${adminUsername}`);
      const passwordHash = await hashPassword(adminPassword);
      const [newAdmin] = await db
        .insert(users)
        .values({
          username: adminUsername,
          passwordHash,
          fullName: 'BCIS System Administrator',
          email: 'admin@bcis.local',
          isActive: true,
          failedLoginAttempts: 0,
        })
        .returning({ id: users.id });
      adminUserId = newAdmin.id;
    } else {
      adminUserId = existingAdmin[0].id;
      await db
        .update(users)
        .set({
          isActive: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, adminUserId));
    }

    await db
      .insert(userRoles)
      .values({
        userId: adminUserId,
        roleId: superAdminRoleId,
      })
      .onConflictDoNothing();
  }

  // 6. Seed Demo Cashier User for AT-10 Verification & Development
  const cashierUsername = 'cashier';
  const cashierPassword = 'Cashier123!';
  const cashierRoleId = roleMap.get(UserRole.CASHIER);

  if (cashierRoleId) {
    const existingCashier = await db
      .select()
      .from(users)
      .where(eq(users.username, cashierUsername))
      .limit(1);

    let cashierUserId: string;

    if (existingCashier.length === 0) {
      console.log(`[Seed] Creating demo Cashier: ${cashierUsername}`);
      const passwordHash = await hashPassword(cashierPassword);
      const [newCashier] = await db
        .insert(users)
        .values({
          username: cashierUsername,
          passwordHash,
          fullName: 'Maria Santos (Cashier)',
          email: 'cashier@bcis.local',
          isActive: true,
          failedLoginAttempts: 0,
        })
        .returning({ id: users.id });
      cashierUserId = newCashier.id;
    } else {
      cashierUserId = existingCashier[0].id;
      await db
        .update(users)
        .set({
          isActive: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, cashierUserId));
    }

    await db
      .insert(userRoles)
      .values({
        userId: cashierUserId,
        roleId: cashierRoleId,
      })
      .onConflictDoNothing();
  }

  console.log('[Seed] Seeding completed successfully!');
}

// Allow direct CLI invocation via `tsx src/db/seed.ts`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedDatabase()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[Seed] Seeding failed:', err);
      await pool.end();
      process.exit(1);
    });
}
