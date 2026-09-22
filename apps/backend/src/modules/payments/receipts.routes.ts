import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import {
  getReceiptByIdOrNumber,
  reprintReceipt,
} from './payments.service.js';

export const receiptRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. Fetch official receipt details by ID or Receipt Number (e.g. OR-202609-0001)
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate, requirePermission('payments.read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const receipt = await getReceiptByIdOrNumber(id);
        return reply.status(200).send({
          success: true,
          data: receipt,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'GET_RECEIPT_ERROR',
          message: err.message || 'Receipt not found',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 2. Reprint official receipt (audited duplicate issuance)
  fastify.post(
    '/:id/reprint',
    { preHandler: [fastify.authenticate, requirePermission('receipt.reprint')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = request.user!;
      const actor = {
        id: user.id,
        name: user.fullName || user.username,
      };

      try {
        const receipt = await reprintReceipt(id, actor, request.ip);
        return reply.status(200).send({
          success: true,
          message: 'Receipt reprinted successfully',
          data: receipt,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'REPRINT_RECEIPT_ERROR',
          message: err.message || 'Failed to reprint receipt',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );
};
