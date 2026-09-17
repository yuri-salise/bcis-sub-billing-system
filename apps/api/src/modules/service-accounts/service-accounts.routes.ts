import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import {
  createServiceAccountSchema,
  updateServiceAccountSchema,
  changeServiceAccountStatusSchema,
  serviceAccountQuerySchema,
  assignServiceAccountCollectorSchema,
} from '@bcis/validation';
import {
  listServiceAccounts,
  getServiceAccountById,
  createServiceAccount,
  updateServiceAccount,
  changeServiceAccountStatus,
  assignCollectorToServiceAccount,
} from './service-accounts.service.js';
import { extractActor } from '../../utils/audit.js';

export const serviceAccountRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /**
   * GET /api/v1/service-accounts
   * Lists service accounts with filters and pagination.
   * Guarded by service_accounts.read permission.
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate, requirePermission('service_accounts.read')] },
    async (request, reply) => {
      const parseResult = serviceAccountQuerySchema.safeParse(request.query);
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

      const result = await listServiceAccounts(parseResult.data);
      return reply.status(200).send(result);
    }
  );

  /**
   * POST /api/v1/service-accounts
   * Provisions a new service account under a subscriber.
   * Guarded by service_accounts.write permission.
   */
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate, requirePermission('service_accounts.write')] },
    async (request, reply) => {
      const parseResult = createServiceAccountSchema.safeParse(request.body);
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
      const account = await createServiceAccount(parseResult.data, actor, request.ip);

      return reply.status(201).send({
        data: account,
        message: 'Service account created successfully',
      });
    }
  );

  /**
   * GET /api/v1/service-accounts/:id
   * Retrieves a single service account with subscriber, plan, and address details.
   * Guarded by service_accounts.read permission.
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requirePermission('service_accounts.read')] },
    async (request, reply) => {
      const { id } = request.params;
      const account = await getServiceAccountById(id);

      if (!account) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          code: 'SERVICE_ACCOUNT_NOT_FOUND',
          message: `Service account with identifier '${id}' was not found`,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.status(200).send({
        data: account,
      });
    }
  );

  /**
   * PATCH /api/v1/service-accounts/:id
   * Updates an existing service account.
   * Guarded by service_accounts.write permission.
   */
  fastify.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requirePermission('service_accounts.write')] },
    async (request, reply) => {
      const { id } = request.params;
      const parseResult = updateServiceAccountSchema.safeParse(request.body);

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
      const updated = await updateServiceAccount(id, parseResult.data, actor, request.ip);

      if (!updated) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          code: 'SERVICE_ACCOUNT_NOT_FOUND',
          message: `Service account with identifier '${id}' was not found`,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.status(200).send({
        data: updated,
        message: 'Service account updated successfully',
      });
    }
  );

  /**
   * PATCH /api/v1/service-accounts/:id/status
   * Transitions service account lifecycle status with audit reason.
   * Guarded by service_accounts.write permission.
   */
  fastify.patch<{ Params: { id: string } }>(
    '/:id/status',
    { preHandler: [fastify.authenticate, requirePermission('service_accounts.write')] },
    async (request, reply) => {
      const { id } = request.params;
      const parseResult = changeServiceAccountStatusSchema.safeParse(request.body);

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
      const updated = await changeServiceAccountStatus(
        id,
        parseResult.data.status,
        parseResult.data.reason,
        actor,
        request.ip
      );

      if (!updated) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          code: 'SERVICE_ACCOUNT_NOT_FOUND',
          message: `Service account with identifier '${id}' was not found`,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.status(200).send({
        data: updated,
        message: `Service account status transitioned to ${parseResult.data.status}`,
      });
    }
  );

  /**
   * PATCH /api/v1/service-accounts/:id/collector
   * Assigns or reassigns collection route, collection area, or collector to a service account.
   * Guarded by service_accounts.write or collections.manage permission.
   */
  fastify.patch<{ Params: { id: string } }>(
    '/:id/collector',
    { preHandler: [fastify.authenticate, requirePermission(['service_accounts.write', 'service_account.update', 'collections.manage'])] },
    async (request, reply) => {
      const { id } = request.params;
      const parseResult = assignServiceAccountCollectorSchema.safeParse(request.body);

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
      try {
        const updated = await assignCollectorToServiceAccount(
          id,
          parseResult.data,
          actor,
          request.ip
        );

        if (!updated) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            code: 'SERVICE_ACCOUNT_NOT_FOUND',
            message: `Service account with identifier '${id}' was not found`,
            timestamp: new Date().toISOString(),
          });
        }

        return reply.status(200).send({
          success: true,
          message: 'Collector and collection route assigned successfully',
          data: updated,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'ASSIGN_COLLECTOR_ERROR',
          message: err.message || 'Failed to assign collector/route to service account',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );
};
