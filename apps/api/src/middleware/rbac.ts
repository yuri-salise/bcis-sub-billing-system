import { FastifyReply, FastifyRequest } from 'fastify';
import { PermissionCode, UserRole } from '@bcis/shared-types';

/**
 * Fastify preHandler hook factory enforcing server-side Role-Based Access Control (RBAC).
 * Follows the BCIS RBAC specification (docs/rbac-matrix.md Section 5.1).
 * 
 * - ROLE_SUPER_ADMIN bypasses granular checks with unrestricted authority.
 * - Non-superadmins must possess the required permission(s).
 * - Denials emit RFC 7807 unified error envelope with HTTP 403 Forbidden.
 */
const PERMISSION_ALIASES: Record<string, string[]> = {
  'plans.read': ['plans.read', 'service_plan.view'],
  'plans.write': ['plans.write', 'service_plan.manage'],
  'service_plan.view': ['service_plan.view', 'plans.read'],
  'service_plan.manage': ['service_plan.manage', 'plans.write'],
  'subscribers.read': ['subscribers.read', 'subscriber.view'],
  'subscribers.write': ['subscribers.write', 'subscriber.create', 'subscriber.update'],
  'subscriber.view': ['subscriber.view', 'subscribers.read'],
  'subscriber.create': ['subscriber.create', 'subscribers.write'],
  'subscriber.update': ['subscriber.update', 'subscribers.write'],
  'service_accounts.read': ['service_accounts.read', 'service_account.view'],
  'service_accounts.write': ['service_accounts.write', 'service_account.create', 'service_account.update'],
  'service_account.view': ['service_account.view', 'service_accounts.read'],
  'service_account.create': ['service_account.create', 'service_accounts.write'],
  'service_account.update': ['service_account.update', 'service_accounts.write'],
  'invoices.read': ['invoices.read', 'billing.view'],
  'billing.view': ['billing.view', 'invoices.read'],
  'invoices.void': ['invoices.void', 'billing.void'],
  'billing.void': ['billing.void', 'invoices.void'],
  'billing.generate': ['billing.generate', 'invoices.generate'],
  'invoices.generate': ['invoices.generate', 'billing.generate'],
  'payments.create': ['payments.create', 'payment.create'],
  'payment.create': ['payment.create', 'payments.create'],
  'payments.read': ['payments.read', 'payment.view', 'receipt.view'],
  'payment.view': ['payment.view', 'payments.read'],
  'payments.reverse': ['payments.reverse', 'payment.reverse'],
  'payment.reverse': ['payment.reverse', 'payments.reverse'],
  'receipt.view': ['receipt.view', 'payments.read', 'receipts.read'],
  'receipts.read': ['receipts.read', 'receipt.view', 'payments.read'],
  'receipt.reprint': ['receipt.reprint', 'receipts.reprint'],
  'receipts.reprint': ['receipts.reprint', 'receipt.reprint'],
  'gcash.view': ['gcash.view'],
  'gcash.submit': ['gcash.submit'],
  'gcash.verify': ['gcash.verify'],
  'gcash.reject': ['gcash.reject'],
  'collection.view': ['collection.view', 'remittances.read', 'collections.read'],
  'remittances.read': ['remittances.read', 'collection.view', 'collections.read'],
  'collection.batch_create': ['collection.batch_create', 'remittances.manage'],
  'remittances.manage': ['remittances.manage', 'collection.reconcile', 'collection.batch_create', 'collection.manage_staff'],
  'collection.reconcile': ['collection.reconcile', 'remittances.manage'],
};

export function satisfiesPermission(perm: string, userPermissions: string[]): boolean {
  if (userPermissions.includes(perm)) return true;
  const aliases = PERMISSION_ALIASES[perm];
  if (aliases) {
    return aliases.some((a) => userPermissions.includes(a));
  }
  return false;
}

/**
 * Fastify preHandler hook factory enforcing server-side Role-Based Access Control (RBAC).
 * Follows the BCIS RBAC specification (docs/rbac-matrix.md Section 5.1).
 * 
 * - ROLE_SUPER_ADMIN bypasses granular checks with unrestricted authority.
 * - Non-superadmins must possess the required permission(s).
 * - Denials emit RFC 7807 unified error envelope with HTTP 403 Forbidden.
 */
export function requirePermission(
  permission: PermissionCode | PermissionCode[],
  mode: 'any' | 'all' = 'any'
) {
  const permissionsList = Array.isArray(permission) ? permission : [permission];

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Automatically execute authentication if request.user is not yet populated
    if (!request.user) {
      await request.server.authenticate(request, reply);
      if (reply.sent) return;
    }

    const user = request.user;
    if (!user) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
        message: 'Authentication required: no active session',
        timestamp: new Date().toISOString(),
      });
    }

    const userRoles = Array.isArray(user.roles) ? user.roles : [];
    const userPermissions = Array.isArray(user.permissions) ? user.permissions : [];

    // ROLE_SUPER_ADMIN possesses unrestricted operational, financial, and administrative authority
    const isSuperAdmin = userRoles.includes(UserRole.SUPER_ADMIN);
    if (isSuperAdmin) {
      return;
    }

    const hasPermission =
      mode === 'all'
        ? permissionsList.every((p) => satisfiesPermission(p, userPermissions))
        : permissionsList.some((p) => satisfiesPermission(p, userPermissions));

    if (!hasPermission) {
      request.log.warn(
        {
          userId: user.id,
          username: user.username,
          requiredPermissions: permissionsList,
          userRoles,
          userPermissionsCount: userPermissions.length,
        },
        'RBAC Access Denied'
      );

      const missing = permissionsList.filter((p) => !satisfiesPermission(p, userPermissions));
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        code: 'INSUFFICIENT_PERMISSIONS',
        message: `Insufficient permissions: missing ${missing.join(', ')}`,
        timestamp: new Date().toISOString(),
      });
    }
  };
}

/**
 * Fastify preHandler hook factory enforcing required role membership.
 */
export function requireRole(role: UserRole | UserRole[]) {
  const requiredRoles = Array.isArray(role) ? role : [role];

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Automatically execute authentication if request.user is not yet populated
    if (!request.user) {
      await request.server.authenticate(request, reply);
      if (reply.sent) return;
    }

    const user = request.user;
    if (!user) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
        message: 'Authentication required: no active session',
        timestamp: new Date().toISOString(),
      });
    }

    const userRoles = Array.isArray(user.roles) ? user.roles : [];

    const isSuperAdmin = userRoles.includes(UserRole.SUPER_ADMIN);
    if (isSuperAdmin) {
      return;
    }

    const hasRole = requiredRoles.some((r) => userRoles.includes(r));
    if (!hasRole) {
      request.log.warn(
        {
          userId: user.id,
          username: user.username,
          requiredRoles,
          userRoles,
        },
        'RBAC Role Check Denied'
      );

      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        code: 'INSUFFICIENT_ROLE',
        message: `Insufficient role: requires one of [${requiredRoles.join(', ')}]`,
        timestamp: new Date().toISOString(),
      });
    }
  };
}
