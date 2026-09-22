import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import {
  createPaymentSchema,
  paymentQuerySchema,
  reversePaymentSchema,
} from '@bcis/validation';
import {
  postPayment,
  getPayments,
  getPaymentById,
  reversePayment,
} from './payments.service.js';

export const paymentRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. Post a new payment (AT-01 to AT-04)
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate, requirePermission('payments.create')] },
    async (request, reply) => {
      const parsed = createPaymentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid payment parameters',
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
        const payment = await postPayment(parsed.data, actor, request.ip);
        return reply.status(201).send({
          success: true,
          message: 'Payment posted successfully',
          data: payment,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'PAYMENT_POST_ERROR',
          message: err.message || 'Failed to post payment',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 2. Query payment history with pagination and filters
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate, requirePermission('payments.read')] },
    async (request, reply) => {
      const parsed = paymentQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: parsed.error.issues.map((i) => ({
            field: i.path.join('.'),
            issue: i.message,
          })),
          timestamp: new Date().toISOString(),
        });
      }

      try {
        const result = await getPayments(parsed.data);
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
          code: err.code || 'QUERY_PAYMENTS_ERROR',
          message: err.message || 'Failed to query payments',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 3. Get single payment details by ID
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate, requirePermission('payments.read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const payment = await getPaymentById(id);
        return reply.status(200).send({
          success: true,
          data: payment,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'GET_PAYMENT_ERROR',
          message: err.message || 'Payment not found',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 4. Reverse an existing payment (AT-06)
  fastify.post(
    '/:id/reverse',
    { preHandler: [fastify.authenticate, requirePermission('payments.reverse')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = reversePaymentSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid reversal parameters',
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
        const result = await reversePayment(id, parsed.data, actor, request.ip);
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
          code: err.code || 'REVERSAL_ERROR',
          message: err.message || 'Failed to reverse payment',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );
};
