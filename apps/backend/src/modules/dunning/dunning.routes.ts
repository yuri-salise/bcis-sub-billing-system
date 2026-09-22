import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import {
  generateDunningNoticesSchema,
  dunningNoticeQuerySchema,
  deliverDunningNoticeSchema,
  resolveDunningNoticeSchema,
  cancelDunningNoticeSchema,
} from '@bcis/validation';
import {
  generateDunningNotices,
  listDunningNotices,
  getDunningNoticeById,
  deliverDunningNotice,
  resolveDunningNotice,
  cancelDunningNotice,
  createDisconnectionOrderFromNotice,
} from './dunning.service.js';
import { extractActor } from '../../utils/audit.js';

export const dunningRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /**
   * 1. Generate dunning notices for overdue accounts
   * Permission: dunning.manage
   */
  fastify.post(
    '/notices/generate',
    { preHandler: [fastify.authenticate, requirePermission('dunning.manage')] },
    async (request, reply) => {
      const parsed = generateDunningNoticesSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid dunning generation parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);
      try {
        const result = await generateDunningNotices(parsed.data, actor, request.ip);
        return reply.status(201).send({
          success: true,
          message: `Generated ${result.count} dunning notices (${result.skippedCount} already active)`,
          data: result,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'GENERATE_DUNNING_ERROR',
          message: err.message || 'Failed to generate dunning notices',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // Alias /generate -> /notices/generate
  fastify.post(
    '/generate',
    { preHandler: [fastify.authenticate, requirePermission('dunning.manage')] },
    async (request, reply) => {
      const parsed = generateDunningNoticesSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }
      const actor = extractActor(request);
      try {
        const result = await generateDunningNotices(parsed.data, actor, request.ip);
        return reply.status(201).send({
          success: true,
          message: `Generated ${result.count} notices`,
          data: result,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'GENERATE_DUNNING_ERROR',
          message: err.message || 'Failed to generate notices',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  /**
   * 2. Query dunning notices with pagination
   * Permission: dunning.manage
   */
  fastify.get(
    '/notices',
    { preHandler: [fastify.authenticate, requirePermission('dunning.manage')] },
    async (request, reply) => {
      const parsed = dunningNoticeQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      try {
        const result = await listDunningNotices(parsed.data);
        return reply.send({
          success: true,
          data: result.data,
          meta: result.meta,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'LIST_DUNNING_ERROR',
          message: err.message || 'Failed to query dunning notices',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  /**
   * 3. Get single dunning notice by ID
   * Permission: dunning.manage
   */
  fastify.get(
    '/notices/:id',
    { preHandler: [fastify.authenticate, requirePermission('dunning.manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const notice = await getDunningNoticeById(id);
        return reply.send({
          success: true,
          data: notice,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'GET_DUNNING_ERROR',
          message: err.message || 'Failed to fetch dunning notice',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  /**
   * 4. Mark dunning notice as DELIVERED
   * Permission: dunning.manage
   */
  fastify.post(
    '/notices/:id/deliver',
    { preHandler: [fastify.authenticate, requirePermission('dunning.manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = deliverDunningNoticeSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid delivery parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);
      try {
        const updated = await deliverDunningNotice(id, parsed.data, actor, request.ip);
        return reply.send({
          success: true,
          message: 'Dunning notice marked as DELIVERED',
          data: updated,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'DELIVER_DUNNING_ERROR',
          message: err.message || 'Failed to deliver notice',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  /**
   * 5. Resolve dunning notice
   * Permission: dunning.manage
   */
  fastify.post(
    '/notices/:id/resolve',
    { preHandler: [fastify.authenticate, requirePermission('dunning.manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = resolveDunningNoticeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid resolution parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);
      try {
        const updated = await resolveDunningNotice(id, parsed.data, actor, request.ip);
        return reply.send({
          success: true,
          message: 'Dunning notice marked as RESOLVED',
          data: updated,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'RESOLVE_DUNNING_ERROR',
          message: err.message || 'Failed to resolve notice',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  /**
   * 6. Cancel dunning notice
   * Permission: dunning.manage
   */
  fastify.post(
    '/notices/:id/cancel',
    { preHandler: [fastify.authenticate, requirePermission('dunning.manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = cancelDunningNoticeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Cancellation reason is required',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);
      try {
        const updated = await cancelDunningNotice(id, parsed.data, actor, request.ip);
        return reply.send({
          success: true,
          message: 'Dunning notice CANCELLED',
          data: updated,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'CANCEL_DUNNING_ERROR',
          message: err.message || 'Failed to cancel notice',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  /**
   * 7. Generate DISCONNECTION service order directly from dunning notice
   * Permission: dunning.manage
   */
  fastify.post(
    '/notices/:id/create-disconnection-order',
    { preHandler: [fastify.authenticate, requirePermission('dunning.manage')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const actor = extractActor(request);

      try {
        const order = await createDisconnectionOrderFromNotice(id, actor, request.ip);
        return reply.status(201).send({
          success: true,
          message: `Disconnection order ${order.orderNumber} created from Dunning Notice`,
          data: order,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'CREATE_DISCONNECTION_ORDER_ERROR',
          message: err.message || 'Failed to create disconnection order',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );
};
