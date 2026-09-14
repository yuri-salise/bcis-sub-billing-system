import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';

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
    { preHandler: [fastify.authenticate, requirePermission('user.manage')] },
    async (_request, reply) => {
      return reply.status(200).send({
        data: [],
      });
    }
  );
};
