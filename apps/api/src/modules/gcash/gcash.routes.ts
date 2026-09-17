import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import {
  submitGCashSchema,
  verifyGCashSchema,
  rejectGCashSchema,
} from '@bcis/validation';
import {
  intakeGCash,
  getGCashQueue,
  verifyGCash,
  rejectGCash,
} from './gcash.service.js';

export const gcashRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. Intake a customer/cashier submitted GCash payment attempt (AT-05)
  // Registering on both /intake and /submit for standard REST compliance
  const handleIntake = async (request: any, reply: any) => {
    const parsed = submitGCashSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        code: 'VALIDATION_ERROR',
        message: 'Invalid GCash submission parameters',
        details: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          issue: i.message,
        })),
        timestamp: new Date().toISOString(),
      });
    }

    const actor = request.user
      ? { id: request.user.id, name: request.user.fullName || request.user.username }
      : undefined;

    try {
      const transaction = await intakeGCash(parsed.data, actor, request.ip);
      return reply.status(201).send({
        success: true,
        message: 'GCash transaction submitted successfully',
        data: transaction,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      const statusCode = err.statusCode || 500;
      return reply.status(statusCode).send({
        statusCode,
        error: err.name || 'Error',
        code: err.code || 'GCASH_INTAKE_ERROR',
        message: err.message || 'Failed to intake GCash transaction',
        timestamp: new Date().toISOString(),
      });
    }
  };

  fastify.post('/intake', { preHandler: [fastify.authenticate, requirePermission('gcash.submit')] }, handleIntake);
  fastify.post('/submit', { preHandler: [fastify.authenticate, requirePermission('gcash.submit')] }, handleIntake);

  // 2. Fetch pending verification queue
  fastify.get(
    '/queue',
    { preHandler: [fastify.authenticate, requirePermission('gcash.view')] },
    async (request, reply) => {
      const query = request.query as any;

      try {
        const result = await getGCashQueue(query);
        return reply.status(200).send({
          success: true,
          ...result,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'GCASH_QUEUE_ERROR',
          message: err.message || 'Failed to fetch GCash queue',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 3. Verify GCash submission and post payment to ledger
  fastify.post(
    '/:id/verify',
    { preHandler: [fastify.authenticate, requirePermission('gcash.verify')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = verifyGCashSchema.safeParse(request.body || {});

      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid verification parameters',
          details: parsed.error.issues.map((i) => ({
            field: i.path.join('.'),
            issue: i.message,
          })),
          timestamp: new Date().toISOString(),
        });
      }

      const user = request.user!;
      const actor = {
        id: user.id,
        name: user.fullName || user.username,
      };

      try {
        const result = await verifyGCash(id, parsed.data, actor, request.ip);
        return reply.status(200).send({
          success: true,
          ...result,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'GCASH_VERIFY_ERROR',
          message: err.message || 'Failed to verify GCash transaction',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 4. Reject GCash submission with documented reason
  fastify.post(
    '/:id/reject',
    { preHandler: [fastify.authenticate, requirePermission(['gcash.reject', 'gcash.verify'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = rejectGCashSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid rejection parameters',
          details: parsed.error.issues.map((i) => ({
            field: i.path.join('.'),
            issue: i.message,
          })),
          timestamp: new Date().toISOString(),
        });
      }

      const user = request.user!;
      const actor = {
        id: user.id,
        name: user.fullName || user.username,
      };

      try {
        const result = await rejectGCash(id, parsed.data, actor, request.ip);
        return reply.status(200).send({
          success: true,
          ...result,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'GCASH_REJECT_ERROR',
          message: err.message || 'Failed to reject GCash transaction',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );
};
