import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import {
  createBatchSchema,
  reconcileBatchSchema,
  cashierShiftReconcileSchema,
  closeBatchSchema,
} from '@bcis/validation';
import {
  createCollectionBatch,
  getCollectionBatches,
  getCollectionBatchById,
  reconcileBatchRemittance,
  closeCollectionBatch,
  reconcileCashierShift,
} from './remittances.service.js';

export const remittanceRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. Create a new collection batch
  fastify.post(
    '/batches',
    { preHandler: [fastify.authenticate, requirePermission(['collection.batch_create', 'remittances.manage'])] },
    async (request, reply) => {
      const parsed = createBatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid batch creation parameters',
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
        const batch = await createCollectionBatch(parsed.data, actor, request.ip);
        return reply.status(201).send({
          success: true,
          message: 'Collection batch created successfully',
          data: batch,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'CREATE_BATCH_ERROR',
          message: err.message || 'Failed to create collection batch',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 2. Query collection batches
  fastify.get(
    '/batches',
    { preHandler: [fastify.authenticate, requirePermission(['collection.view', 'remittances.manage'])] },
    async (request, reply) => {
      const query = request.query as any;

      try {
        const result = await getCollectionBatches(query);
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
          code: err.code || 'QUERY_BATCHES_ERROR',
          message: err.message || 'Failed to query collection batches',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 3. Get single batch details
  fastify.get(
    '/batches/:id',
    { preHandler: [fastify.authenticate, requirePermission(['collection.view', 'remittances.manage'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const batch = await getCollectionBatchById(id);
        return reply.status(200).send({
          success: true,
          data: batch,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'GET_BATCH_ERROR',
          message: err.message || 'Collection batch not found',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 4. Reconcile collection batch remittance (AT-07 & AT-08)
  fastify.post(
    '/batches/:id/reconcile',
    { preHandler: [fastify.authenticate, requirePermission(['collection.reconcile', 'remittances.manage'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = reconcileBatchSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid remittance reconciliation parameters',
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
        const result = await reconcileBatchRemittance(id, parsed.data, actor, request.ip);
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
          code: err.code || 'RECONCILE_BATCH_ERROR',
          message: err.message || 'Failed to reconcile collection batch',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 5. Close collection batch (enforces AT-08: rejects closing short batches without force)
  fastify.post(
    '/batches/:id/close',
    { preHandler: [fastify.authenticate, requirePermission(['collection.reconcile', 'remittances.manage'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = closeBatchSchema.safeParse(request.body || {});

      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid batch closure parameters',
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
        const batch = await closeCollectionBatch(id, parsed.data, actor, request.ip);
        return reply.status(200).send({
          success: true,
          message: 'Collection batch closed successfully',
          data: batch,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'CLOSE_BATCH_ERROR',
          message: err.message || 'Failed to close collection batch',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 6. Cashier shift end-of-day counter cash reconciliation
  fastify.post(
    '/shift/reconcile',
    { preHandler: [fastify.authenticate, requirePermission(['collection.reconcile', 'remittances.manage'])] },
    async (request, reply) => {
      const parsed = cashierShiftReconcileSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid shift reconciliation parameters',
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
        const result = await reconcileCashierShift(parsed.data, actor, request.ip);
        return reply.status(200).send({
          success: true,
          message: result.statusMessage,
          data: result,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'CASHIER_SHIFT_ERROR',
          message: err.message || 'Failed to reconcile cashier shift',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );
};
