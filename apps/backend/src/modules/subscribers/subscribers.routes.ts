import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import {
  createSubscriberSchema,
  updateSubscriberSchema,
  subscriberQuerySchema,
} from '@bcis/validation';
import {
  listSubscribers,
  getSubscriberById,
  createSubscriber,
  updateSubscriber,
  archiveSubscriber,
  getSubscriberSoa,
} from './subscribers.service.js';
import { extractActor } from '../../utils/audit.js';

export const subscriberRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /**
   * GET /api/v1/subscribers
   * Lists subscribers with pagination, search, and filtering.
   * Guarded by subscribers.read permission.
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate, requirePermission('subscribers.read')] },
    async (request, reply) => {
      const parseResult = subscriberQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_QUERY',
          message: 'Invalid query parameters',
          details: parseResult.error.errors.map((e: { path: (string | number)[]; message: string }) => ({
            field: e.path.join('.'),
            issue: e.message,
          })),
          timestamp: new Date().toISOString(),
        });
      }

      const result = await listSubscribers(parseResult.data);
      return reply.status(200).send(result);
    }
  );

  /**
   * POST /api/v1/subscribers
   * Registers a new subscriber along with initial primary address.
   * Guarded by subscribers.write permission.
   */
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate, requirePermission('subscribers.write')] },
    async (request, reply) => {
      const parseResult = createSubscriberSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_INPUT',
          message: 'Validation failed',
          details: parseResult.error.errors.map((e: { path: (string | number)[]; message: string }) => ({
            field: e.path.join('.'),
            issue: e.message,
          })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);
      const subscriber = await createSubscriber(parseResult.data, actor, request.ip);

      return reply.status(201).send({
        data: subscriber,
        message: 'Subscriber registered successfully',
      });
    }
  );

  /**
   * GET /api/v1/subscribers/:id
   * Retrieves subscriber profile by ID or account number with addresses & service accounts.
   * Guarded by subscribers.read permission.
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requirePermission('subscribers.read')] },
    async (request, reply) => {
      const { id } = request.params;
      const subscriber = await getSubscriberById(id);

      if (!subscriber) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          code: 'SUBSCRIBER_NOT_FOUND',
          message: `Subscriber with identifier '${id}' was not found`,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.status(200).send({
        data: subscriber,
      });
    }
  );

  /**
   * GET /api/v1/subscribers/:id/soa
   * Generates a comprehensive Statement of Account (SOA) aggregating active services,
   * current ledger balance, advance credit, aging summary, open invoices, and chronological ledger lines.
   * Guarded by subscribers.read permission.
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id/soa',
    { preHandler: [fastify.authenticate, requirePermission(['subscribers.read', 'billing.view', 'reports.financial'])] },
    async (request, reply) => {
      const { id } = request.params;
      const soa = await getSubscriberSoa(id);

      if (!soa) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          code: 'SUBSCRIBER_NOT_FOUND',
          message: `Subscriber with identifier '${id}' was not found`,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.status(200).send({
        data: soa,
      });
    }
  );

  /**
   * GET /api/v1/subscribers/:id/statement
   * Alias for /api/v1/subscribers/:id/soa
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id/statement',
    { preHandler: [fastify.authenticate, requirePermission(['subscribers.read', 'billing.view', 'reports.financial'])] },
    async (request, reply) => {
      const { id } = request.params;
      const soa = await getSubscriberSoa(id);

      if (!soa) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          code: 'SUBSCRIBER_NOT_FOUND',
          message: `Subscriber with identifier '${id}' was not found`,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.status(200).send({
        data: soa,
      });
    }
  );

  /**
   * GET /api/v1/subscribers/:id/ledger
   * Retrieves the running transaction ledger lines and current balance for a subscriber.
   * Guarded by subscribers.read permission.
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id/ledger',
    { preHandler: [fastify.authenticate, requirePermission(['subscribers.read', 'billing.view', 'reports.financial'])] },
    async (request, reply) => {
      const { id } = request.params;
      const soa = await getSubscriberSoa(id);

      if (!soa) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          code: 'SUBSCRIBER_NOT_FOUND',
          message: `Subscriber with identifier '${id}' was not found`,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.status(200).send({
        data: {
          subscriberId: soa.subscriber.id,
          accountNumber: soa.subscriber.accountNumber,
          currentBalanceCentavos: soa.currentBalanceCentavos,
          advanceCreditCentavos: soa.advanceCreditCentavos,
          ledgerLines: soa.ledgerLines,
        },
      });
    }
  );

  /**
   * PATCH /api/v1/subscribers/:id
   * Updates an existing subscriber profile and primary address.
   * Guarded by subscribers.write permission.
   */
  fastify.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requirePermission('subscribers.write')] },
    async (request, reply) => {
      const { id } = request.params;
      const parseResult = updateSubscriberSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_INPUT',
          message: 'Validation failed',
          details: parseResult.error.errors.map((e: { path: (string | number)[]; message: string }) => ({
            field: e.path.join('.'),
            issue: e.message,
          })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);
      const updated = await updateSubscriber(id, parseResult.data, actor, request.ip);

      if (!updated) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          code: 'SUBSCRIBER_NOT_FOUND',
          message: `Subscriber with identifier '${id}' was not found`,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.status(200).send({
        data: updated,
        message: 'Subscriber updated successfully',
      });
    }
  );

  /**
   * DELETE /api/v1/subscribers/:id
   * Soft deletes / archives a subscriber.
   * Guarded by subscribers.write permission.
   */
  fastify.delete<{ Params: { id: string }; Querystring: { reason?: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requirePermission('subscribers.write')] },
    async (request, reply) => {
      const { id } = request.params;
      const { reason } = request.query;

      const actor = extractActor(request);
      const archived = await archiveSubscriber(id, actor, reason, request.ip);

      if (!archived) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          code: 'SUBSCRIBER_NOT_FOUND',
          message: `Subscriber with identifier '${id}' was not found`,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.status(200).send({
        data: archived,
        message: 'Subscriber archived successfully',
      });
    }
  );
};
