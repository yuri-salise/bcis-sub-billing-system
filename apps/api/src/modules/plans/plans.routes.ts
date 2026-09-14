import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import { createPlanSchema, updatePlanSchema, planQuerySchema } from '@bcis/validation';
import { listPlans, getPlanById, createPlan, updatePlan } from './plans.service.js';
import { extractActor } from '../../utils/audit.js';

export const planRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /**
   * GET /api/v1/plans
   * Lists all service plans with optional filtering (serviceType, isActive, search).
   * Guarded by plans.read permission.
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate, requirePermission('plans.read')] },
    async (request, reply) => {
      const parseResult = planQuerySchema.safeParse(request.query);
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

      const data = await listPlans(parseResult.data);
      return reply.status(200).send({
        data,
      });
    }
  );

  /**
   * POST /api/v1/plans
   * Creates a new service plan.
   * Guarded by plans.write permission.
   */
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate, requirePermission('plans.write')] },
    async (request, reply) => {
      const parseResult = createPlanSchema.safeParse(request.body);
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
      const plan = await createPlan(parseResult.data, actor, request.ip);

      return reply.status(201).send({
        data: plan,
        message: 'Plan created successfully',
      });
    }
  );

  /**
   * GET /api/v1/plans/:id
   * Retrieves a single service plan by ID or code.
   * Guarded by plans.read permission.
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requirePermission('plans.read')] },
    async (request, reply) => {
      const { id } = request.params;
      const plan = await getPlanById(id);

      if (!plan) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          code: 'PLAN_NOT_FOUND',
          message: `Service plan with identifier '${id}' was not found`,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.status(200).send({
        data: plan,
      });
    }
  );

  /**
   * PATCH /api/v1/plans/:id
   * Updates an existing service plan.
   * Guarded by plans.write permission.
   */
  fastify.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requirePermission('plans.write')] },
    async (request, reply) => {
      const { id } = request.params;
      const parseResult = updatePlanSchema.safeParse(request.body);

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
      const updated = await updatePlan(id, parseResult.data, actor, request.ip);

      if (!updated) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          code: 'PLAN_NOT_FOUND',
          message: `Service plan with identifier '${id}' was not found`,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.status(200).send({
        data: updated,
        message: 'Plan updated successfully',
      });
    }
  );
};
