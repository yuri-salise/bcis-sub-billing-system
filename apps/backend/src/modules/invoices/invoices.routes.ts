import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import {
  generateInvoiceSchema,
  invoiceQuerySchema,
  voidInvoiceSchema,
} from '@bcis/validation';
import {
  generateSingleInvoice,
  generateBatchInvoices,
  listInvoices,
  getInvoiceById,
  voidInvoice,
} from './invoices.service.js';
import { extractActor } from '../../utils/audit.js';

export const invoiceRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /**
   * POST /api/v1/invoices/generate
   * Generates invoice for a single service account or triggers bulk batch generation for all active accounts.
   * Guarded by billing.generate permission.
   */
  fastify.post(
    '/generate',
    { preHandler: [fastify.authenticate, requirePermission('billing.generate')] },
    async (request, reply) => {
      const parseResult = generateInvoiceSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_INPUT',
          message: 'Validation failed for invoice generation',
          details: parseResult.error.errors.map((e) => ({
            field: e.path.join('.'),
            issue: e.message,
          })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);

      try {
        if (parseResult.data.serviceAccountId) {
          const invoice = await generateSingleInvoice(
            { ...parseResult.data, serviceAccountId: parseResult.data.serviceAccountId },
            actor,
            request.ip
          );

          return reply.status(201).send({
            data: invoice,
            message: 'Invoice generated successfully',
          });
        } else {
          const result = await generateBatchInvoices(parseResult.data, actor, request.ip);

          return reply.status(201).send({
            data: result,
            message: `Batch generation complete: ${result.generatedCount} generated, ${result.skippedCount} skipped`,
          });
        }
      } catch (err: any) {
        if (err.code === '23505') {
          if (err.constraint?.includes('unique_active_invoice_per_period')) {
            return reply.status(409).send({
              statusCode: 409,
              error: 'Conflict',
              code: 'DUPLICATE_BILLING_PERIOD',
              message: 'An invoice already exists for this service account and billing period',
              timestamp: new Date().toISOString(),
            });
          }
          if (err.constraint?.includes('invoice_number')) {
            return reply.status(409).send({
              statusCode: 409,
              error: 'Conflict',
              code: 'DUPLICATE_INVOICE_NUMBER',
              message: 'An invoice with this number already exists',
              timestamp: new Date().toISOString(),
            });
          }
          return reply.status(409).send({
            statusCode: 409,
            error: 'Conflict',
            code: 'CONFLICT',
            message: err.message || 'Duplicate database entity conflict',
            timestamp: new Date().toISOString(),
          });
        }
        if (err.statusCode) {
          return reply.status(err.statusCode).send({
            statusCode: err.statusCode,
            error: err.name || 'Error',
            code: err.code || 'INVOICE_GENERATION_ERROR',
            message: err.message,
            timestamp: new Date().toISOString(),
          });
        }
        throw err;
      }
    }
  );

  /**
   * GET /api/v1/invoices
   * Lists invoices with pagination, status filters, date range, and search.
   * Guarded by invoices.read permission.
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate, requirePermission('invoices.read')] },
    async (request, reply) => {
      const parseResult = invoiceQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_QUERY',
          message: 'Invalid query parameters for invoice list',
          details: parseResult.error.errors.map((e) => ({
            field: e.path.join('.'),
            issue: e.message,
          })),
          timestamp: new Date().toISOString(),
        });
      }

      const result = await listInvoices(parseResult.data);
      return reply.status(200).send(result);
    }
  );

  /**
   * GET /api/v1/invoices/:id
   * Retrieves single invoice details with line items, service account, subscriber, and payment allocations.
   * Guarded by invoices.read permission.
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, requirePermission('invoices.read')] },
    async (request, reply) => {
      const { id } = request.params;
      const invoice = await getInvoiceById(id);

      if (!invoice) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          code: 'INVOICE_NOT_FOUND',
          message: `Invoice with identifier '${id}' was not found`,
          timestamp: new Date().toISOString(),
        });
      }

      return reply.status(200).send({
        data: invoice,
      });
    }
  );

  /**
   * POST /api/v1/invoices/:id/void
   * Voids an unpaid invoice with mandatory reason, restoring subscriber balance and updating audit log.
   * Guarded by invoices.void permission.
   */
  fastify.post<{ Params: { id: string } }>(
    '/:id/void',
    { preHandler: [fastify.authenticate, requirePermission('invoices.void')] },
    async (request, reply) => {
      const { id } = request.params;
      const parseResult = voidInvoiceSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INVALID_INPUT',
          message: 'Validation failed for voiding invoice',
          details: parseResult.error.errors.map((e) => ({
            field: e.path.join('.'),
            issue: e.message,
          })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);

      try {
        const voided = await voidInvoice(id, parseResult.data.reason, actor, request.ip);
        return reply.status(200).send({
          data: voided,
          message: `Invoice ${voided.invoiceNumber} voided successfully`,
        });
      } catch (err: any) {
        if (err.statusCode) {
          return reply.status(err.statusCode).send({
            statusCode: err.statusCode,
            error: err.name || 'Error',
            code: err.code || 'INVOICE_VOID_ERROR',
            message: err.message,
            timestamp: new Date().toISOString(),
          });
        }
        throw err;
      }
    }
  );
};
