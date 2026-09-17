import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import {
  createCollectionAreaSchema,
  updateCollectionAreaSchema,
  assignCollectorSchema,
  collectionAreaQuerySchema,
  createCollectionRouteSchema,
  updateCollectionRouteSchema,
  collectionRouteQuerySchema,
  routeSheetQuerySchema,
} from '@bcis/validation';
import {
  listCollectionAreas,
  getCollectionAreaById,
  createCollectionArea,
  updateCollectionArea,
  deleteCollectionArea,
  assignCollectorToArea,
  listCollectionRoutes,
  getCollectionRouteById,
  createCollectionRoute,
  updateCollectionRoute,
  deleteCollectionRoute,
  generateRouteSheetForArea,
  generateRouteSheetForRoute,
  generateRouteSheetForBatch,
} from './collections.service.js';
import { extractActor } from '../../utils/audit.js';

export const collectionsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // ============================================================================
  // 1. Collection Areas
  // ============================================================================

  // GET /api/v1/collections/areas - List collection areas
  fastify.get(
    '/areas',
    { preHandler: [fastify.authenticate, requirePermission(['collection.view', 'collections.manage'])] },
    async (request, reply) => {
      const parsed = collectionAreaQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid collection area query parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      try {
        const result = await listCollectionAreas(parsed.data);
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
          code: err.code || 'QUERY_AREAS_ERROR',
          message: err.message || 'Failed to list collection areas',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // POST /api/v1/collections/areas - Create collection area
  fastify.post(
    '/areas',
    { preHandler: [fastify.authenticate, requirePermission(['collections.manage', 'collection.manage_staff'])] },
    async (request, reply) => {
      const parsed = createCollectionAreaSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid collection area parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);

      try {
        const area = await createCollectionArea(parsed.data, actor, request.ip);
        return reply.status(201).send({
          success: true,
          message: 'Collection area created successfully',
          data: area,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'CREATE_AREA_ERROR',
          message: err.message || 'Failed to create collection area',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // GET /api/v1/collections/areas/:id - Get collection area details
  fastify.get(
    '/areas/:id',
    { preHandler: [fastify.authenticate, requirePermission(['collection.view', 'collections.manage'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const area = await getCollectionAreaById(id);
        if (!area) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            code: 'AREA_NOT_FOUND',
            message: `Collection area '${id}' was not found`,
            timestamp: new Date().toISOString(),
          });
        }

        return reply.status(200).send({
          success: true,
          data: area,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'GET_AREA_ERROR',
          message: err.message || 'Failed to retrieve collection area',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // PUT /api/v1/collections/areas/:id - Update collection area
  fastify.put(
    '/areas/:id',
    { preHandler: [fastify.authenticate, requirePermission(['collections.manage', 'collection.manage_staff'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateCollectionAreaSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid collection area update parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);

      try {
        const area = await updateCollectionArea(id, parsed.data, actor, request.ip);
        return reply.status(200).send({
          success: true,
          message: 'Collection area updated successfully',
          data: area,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'UPDATE_AREA_ERROR',
          message: err.message || 'Failed to update collection area',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // DELETE /api/v1/collections/areas/:id - Delete collection area
  fastify.delete(
    '/areas/:id',
    { preHandler: [fastify.authenticate, requirePermission(['collections.manage'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const actor = extractActor(request);

      try {
        const result = await deleteCollectionArea(id, actor, request.ip);
        return reply.status(200).send({
          success: true,
          message: result.message,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'DELETE_AREA_ERROR',
          message: err.message || 'Failed to delete collection area',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // POST /api/v1/collections/areas/:id/assign-collector - Assign collector to area
  fastify.post(
    '/areas/:id/assign-collector',
    { preHandler: [fastify.authenticate, requirePermission(['collections.manage', 'collection.manage_staff'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = assignCollectorSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid collector assignment parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);

      try {
        const area = await assignCollectorToArea(id, parsed.data.collectorId, actor, request.ip);
        return reply.status(200).send({
          success: true,
          message: 'Collector assigned to area successfully',
          data: area,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'ASSIGN_COLLECTOR_ERROR',
          message: err.message || 'Failed to assign collector to area',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // GET /api/v1/collections/areas/:id/route-sheet - Generate route sheet for area
  fastify.get(
    '/areas/:id/route-sheet',
    { preHandler: [fastify.authenticate, requirePermission(['collection.view', 'collections.manage'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = routeSheetQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid route sheet query parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      try {
        const routeSheet = await generateRouteSheetForArea(id, parsed.data);
        return reply.status(200).send({
          success: true,
          data: routeSheet,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'ROUTE_SHEET_ERROR',
          message: err.message || 'Failed to generate route sheet',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // ============================================================================
  // 2. Collection Routes
  // ============================================================================

  // GET /api/v1/collections/routes - List routes
  fastify.get(
    '/routes',
    { preHandler: [fastify.authenticate, requirePermission(['collection.view', 'collections.manage'])] },
    async (request, reply) => {
      const parsed = collectionRouteQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid collection route query parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      try {
        const result = await listCollectionRoutes(parsed.data);
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
          code: err.code || 'QUERY_ROUTES_ERROR',
          message: err.message || 'Failed to list collection routes',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // POST /api/v1/collections/routes - Create route
  fastify.post(
    '/routes',
    { preHandler: [fastify.authenticate, requirePermission(['collections.manage', 'collection.manage_staff'])] },
    async (request, reply) => {
      const parsed = createCollectionRouteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid route parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);

      try {
        const route = await createCollectionRoute(parsed.data, actor, request.ip);
        return reply.status(201).send({
          success: true,
          message: 'Collection route created successfully',
          data: route,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'CREATE_ROUTE_ERROR',
          message: err.message || 'Failed to create collection route',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // GET /api/v1/collections/routes/:id - Get route details
  fastify.get(
    '/routes/:id',
    { preHandler: [fastify.authenticate, requirePermission(['collection.view', 'collections.manage'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const route = await getCollectionRouteById(id);
        if (!route) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            code: 'ROUTE_NOT_FOUND',
            message: `Collection route '${id}' was not found`,
            timestamp: new Date().toISOString(),
          });
        }

        return reply.status(200).send({
          success: true,
          data: route,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'GET_ROUTE_ERROR',
          message: err.message || 'Failed to retrieve collection route',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // PUT /api/v1/collections/routes/:id - Update route
  fastify.put(
    '/routes/:id',
    { preHandler: [fastify.authenticate, requirePermission(['collections.manage', 'collection.manage_staff'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateCollectionRouteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid route update parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);

      try {
        const route = await updateCollectionRoute(id, parsed.data, actor, request.ip);
        return reply.status(200).send({
          success: true,
          message: 'Collection route updated successfully',
          data: route,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'UPDATE_ROUTE_ERROR',
          message: err.message || 'Failed to update collection route',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // DELETE /api/v1/collections/routes/:id - Delete route
  fastify.delete(
    '/routes/:id',
    { preHandler: [fastify.authenticate, requirePermission(['collections.manage'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const actor = extractActor(request);

      try {
        const result = await deleteCollectionRoute(id, actor, request.ip);
        return reply.status(200).send({
          success: true,
          message: result.message,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'DELETE_ROUTE_ERROR',
          message: err.message || 'Failed to delete collection route',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // GET /api/v1/collections/routes/:id/route-sheet - Generate route sheet for route
  fastify.get(
    '/routes/:id/route-sheet',
    { preHandler: [fastify.authenticate, requirePermission(['collection.view', 'collections.manage'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = routeSheetQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid route sheet query parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      try {
        const routeSheet = await generateRouteSheetForRoute(id, parsed.data);
        return reply.status(200).send({
          success: true,
          data: routeSheet,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'ROUTE_SHEET_ERROR',
          message: err.message || 'Failed to generate route sheet',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // GET /api/v1/collections/batches/:id/route-sheet - Generate route sheet for batch
  fastify.get(
    '/batches/:id/route-sheet',
    { preHandler: [fastify.authenticate, requirePermission(['collection.view', 'collections.manage'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = routeSheetQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid route sheet query parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      try {
        const routeSheet = await generateRouteSheetForBatch(id, parsed.data);
        return reply.status(200).send({
          success: true,
          data: routeSheet,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'ROUTE_SHEET_ERROR',
          message: err.message || 'Failed to generate batch route sheet',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );
};
