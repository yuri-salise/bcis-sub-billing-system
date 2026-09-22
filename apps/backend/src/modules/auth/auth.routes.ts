import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loginSchema, unlockSchema } from '@bcis/validation';
import {
  authenticateUser,
  authenticateUnlock,
  findUserById,
  getUserPermissions,
  getUserRoles,
  recordAuditLog,
} from './auth.service.js';
import { revokeToken } from '../../plugins/jwt.js';
import crypto from 'crypto';

export const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /**
   * POST /login
   * Authenticates username and password, returning JWT token and full RBAC profile.
   */
  fastify.post('/login', async (request, reply) => {
    const parseResult = loginSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        code: 'INVALID_INPUT',
        message: 'Validation failed',
        details: parseResult.error.errors.map((e) => ({
          field: e.path.join('.'),
          issue: e.message,
        })),
        timestamp: new Date().toISOString(),
      });
    }

    const { username, password } = parseResult.data;
    const authResult = await authenticateUser(username, password, request.ip);

    if (!authResult.success) {
      return reply.status(authResult.statusCode).send({
        statusCode: authResult.statusCode,
        error: authResult.statusCode === 423 ? 'Locked' : authResult.statusCode === 403 ? 'Forbidden' : 'Unauthorized',
        code: authResult.code,
        message: authResult.message,
        timestamp: new Date().toISOString(),
      });
    }

    const token = fastify.jwt.sign({
      id: authResult.user.id,
      username: authResult.user.username,
      fullName: authResult.user.fullName,
      roles: authResult.user.roles,
      permissions: authResult.user.permissions,
      jti: crypto.randomUUID(),
    });

    return reply.status(200).send({
      token,
      user: authResult.user,
    });
  });

  /**
   * POST /logout
   * Revokes the active session token and records an audit log.
   */
  fastify.post(
    '/logout',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const authHeader = request.headers.authorization;
      const token = authHeader?.substring(7).trim();

      if (token) {
        const expiresAtMs = request.user.exp ? request.user.exp * 1000 : undefined;
        revokeToken(token, expiresAtMs);
      }

      await recordAuditLog({
        actorId: request.user.id,
        actorName: request.user.fullName,
        action: 'AUTH_LOGOUT',
        entityType: 'USER',
        entityId: request.user.id,
        ipAddress: request.ip,
      });

      return reply.status(200).send({
        message: 'Logged out successfully',
      });
    }
  );

  /**
   * GET /me
   * Fetches current authenticated user profile, roles, and permissions.
   */
  fastify.get(
    '/me',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = await findUserById(request.user.id);

      if (!user) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          code: 'USER_NOT_FOUND',
          message: 'User account no longer exists',
          timestamp: new Date().toISOString(),
        });
      }

      if (!user.isActive) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          code: 'ACCOUNT_INACTIVE',
          message: 'User account is deactivated',
          timestamp: new Date().toISOString(),
        });
      }

      const roleCodes = await getUserRoles(user.id);
      const permissionCodes = await getUserPermissions(user.id, roleCodes);

      return reply.status(200).send({
        user: {
          id: user.id,
          username: user.username,
          fullName: user.fullName,
          email: user.email,
          roles: roleCodes,
          permissions: permissionCodes,
        },
      });
    }
  );

  /**
   * POST /lock
   * Signals desktop screen lock state without revoking session token.
   */
  fastify.post(
    '/lock',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      await recordAuditLog({
        actorId: request.user.id,
        actorName: request.user.fullName,
        action: 'AUTH_SCREEN_LOCK',
        entityType: 'SESSION',
        entityId: request.user.id,
        ipAddress: request.ip,
      });

      return reply.status(200).send({
        locked: true,
        message: 'Workstation session locked',
      });
    }
  );

  /**
   * POST /unlock
   * Re-verifies user password to resume desktop screen without re-login.
   * Enforces 5-attempt lockout and audit logging.
   */
  fastify.post(
    '/unlock',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parseResult = unlockSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_INPUT',
          message: 'Validation failed',
          details: parseResult.error.errors.map((e) => ({
            field: e.path.join('.'),
            issue: e.message,
          })),
          timestamp: new Date().toISOString(),
        });
      }

      const authResult = await authenticateUnlock(
        request.user.id,
        parseResult.data.password,
        request.ip
      );

      if (!authResult.success) {
        return reply.status(authResult.statusCode).send({
          statusCode: authResult.statusCode,
          error: authResult.statusCode === 423 ? 'Locked' : authResult.statusCode === 403 ? 'Forbidden' : 'Unauthorized',
          code: authResult.code,
          message: authResult.message,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.status(200).send({
        unlocked: true,
        message: 'Workstation session unlocked',
      });
    }
  );
};
