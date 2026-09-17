import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import {
  createServiceOrderSchema,
  updateServiceOrderSchema,
  assignTechnicianSchema,
  changeServiceOrderStatusSchema,
  completeServiceOrderSchema,
  cancelServiceOrderSchema,
  serviceOrderQuerySchema,
} from '@bcis/validation';
import {
  createServiceOrder,
  listServiceOrders,
  getServiceOrderById,
  updateServiceOrder,
  assignTechnician,
  changeServiceOrderStatus,
  completeServiceOrder,
  cancelServiceOrder,
} from './service-orders.service.js';
import { extractActor } from '../../utils/audit.js';

export const serviceOrderRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. Create a new service order
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate, requirePermission('service_orders.create')] },
    async (request, reply) => {
      const parsed = createServiceOrderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid service order parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);

      try {
        const order = await createServiceOrder(parsed.data, actor, request.ip);
        return reply.status(201).send({
          success: true,
          message: 'Service order created successfully',
          data: order,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'CREATE_SERVICE_ORDER_ERROR',
          message: err.message || 'Failed to create service order',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 2. Query service orders
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate, requirePermission('service_orders.read')] },
    async (request, reply) => {
      const parsed = serviceOrderQuerySchema.safeParse(request.query);
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
        const result = await listServiceOrders(parsed.data);
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
          code: err.code || 'QUERY_ORDERS_ERROR',
          message: err.message || 'Failed to query service orders',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 3. Get single service order details
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate, requirePermission('service_orders.read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const order = await getServiceOrderById(id);
        if (!order) {
          return reply.status(404).send({
            statusCode: 404,
            error: 'Not Found',
            code: 'ORDER_NOT_FOUND',
            message: `Service order '${id}' was not found`,
            timestamp: new Date().toISOString(),
          });
        }

        return reply.status(200).send({
          success: true,
          data: order,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'GET_ORDER_ERROR',
          message: err.message || 'Failed to retrieve service order',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 4. Update service order
  fastify.put(
    '/:id',
    { preHandler: [fastify.authenticate, requirePermission('service_orders.update')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateServiceOrderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid service order update parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);

      try {
        const order = await updateServiceOrder(id, parsed.data, actor, request.ip);
        return reply.status(200).send({
          success: true,
          message: 'Service order updated successfully',
          data: order,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'UPDATE_ORDER_ERROR',
          message: err.message || 'Failed to update service order',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 5. Assign technician to service order
  fastify.post(
    '/:id/assign',
    { preHandler: [fastify.authenticate, requirePermission('service_orders.update')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = assignTechnicianSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid technician assignment parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);

      try {
        const order = await assignTechnician(id, parsed.data, actor, request.ip);
        return reply.status(200).send({
          success: true,
          message: 'Technician assigned successfully',
          data: order,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'ASSIGN_TECHNICIAN_ERROR',
          message: err.message || 'Failed to assign technician',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 6. Transition service order status (e.g. IN_PROGRESS)
  fastify.post(
    '/:id/status',
    { preHandler: [fastify.authenticate, requirePermission('service_orders.update')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = changeServiceOrderStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid status change parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);

      try {
        const order = await changeServiceOrderStatus(id, parsed.data.status, actor, request.ip, parsed.data.reason);
        return reply.status(200).send({
          success: true,
          message: `Service order status transitioned to ${parsed.data.status}`,
          data: order,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'CHANGE_STATUS_ERROR',
          message: err.message || 'Failed to change service order status',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 7. Complete service order and synchronize service account status
  fastify.post(
    '/:id/complete',
    { preHandler: [fastify.authenticate, requirePermission('service_orders.complete')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = completeServiceOrderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid order completion parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);

      try {
        const order = await completeServiceOrder(id, parsed.data, actor, request.ip);
        return reply.status(200).send({
          success: true,
          message: 'Service order completed and service account status synchronized successfully',
          data: order,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'COMPLETE_ORDER_ERROR',
          message: err.message || 'Failed to complete service order',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // 8. Cancel service order
  fastify.post(
    '/:id/cancel',
    { preHandler: [fastify.authenticate, requirePermission('service_orders.update')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = cancelServiceOrderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid order cancellation parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);

      try {
        const order = await cancelServiceOrder(id, parsed.data, actor, request.ip);
        return reply.status(200).send({
          success: true,
          message: 'Service order cancelled successfully',
          data: order,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'CANCEL_ORDER_ERROR',
          message: err.message || 'Failed to cancel service order',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );
};
