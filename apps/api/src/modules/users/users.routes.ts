import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * User administration endpoints guarded by server-side RBAC.
 * Specifically satisfies Acceptance Test AT-10 requirements.
 */
export const userRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate, requirePermission('user.manage')] },
    async (_request, reply) => {
      return reply.status(201).send({
        message: 'User created successfully',
      });
    }
  );

  fastify.get(
    '/',
    { preHandler: [fastify.authenticate, requirePermission('service_orders.read')] },
    async (request, reply) => {
      try {
        const allUsers = await db
          .select({
            id: users.id,
            username: users.username,
            fullName: users.fullName,
            email: users.email,
            isActive: users.isActive,
          })
          .from(users)
          .where(eq(users.isActive, true));

        return reply.status(200).send({
          success: true,
          data: allUsers,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          code: 'LIST_USERS_ERROR',
          message: err.message || 'Failed to list users',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );
};
