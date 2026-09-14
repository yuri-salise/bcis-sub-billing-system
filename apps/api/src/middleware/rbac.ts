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
        ? permissionsList.every((p) => userPermissions.includes(p))
        : permissionsList.some((p) => userPermissions.includes(p));

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

      const missing = permissionsList.filter((p) => !userPermissions.includes(p));
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
