import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import {
  arAgingQuerySchema,
  disconnectionCandidatesQuerySchema,
  dailyCollectionQuerySchema,
  billingRevenueQuerySchema,
  delinquentReceivablesQuerySchema,
} from '@bcis/validation';
import {
  getArAgingReport,
  getDisconnectionCandidatesReport,
  getDailyCollectionReport,
  getBillingRevenueReport,
  getDelinquentReceivablesReport,
} from './reports.service.js';
import { extractActor } from '../../utils/audit.js';

export const reportsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /**
   * 1. Accounts Receivable (AR) Aging Report
   * Permission: receivable.view_aging (or reports.financial)
   */
  fastify.get(
    '/ar-aging',
    { preHandler: [fastify.authenticate, requirePermission('receivable.view_aging')] },
    async (request, reply) => {
      const parsed = arAgingQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid AR aging query parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);
      try {
        const result = await getArAgingReport(parsed.data, actor, request.ip);

        if (result.format === 'csv') {
          return reply
            .header('Content-Type', 'text/csv; charset=utf-8')
            .header('Content-Disposition', 'attachment; filename="ar-aging-report.csv"')
            .send(result.data);
        }

        return reply.send({
          success: true,
          data: result.data,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'AR_AGING_REPORT_ERROR',
          message: err.message || 'Failed to generate AR aging report',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  /**
   * 2. Disconnection Candidates Report
   * Permission: reports.operational (or service_control.view)
   */
  fastify.get(
    '/disconnection-candidates',
    { preHandler: [fastify.authenticate, requirePermission('reports.operational')] },
    async (request, reply) => {
      const parsed = disconnectionCandidatesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid disconnection candidates query parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);
      try {
        const result = await getDisconnectionCandidatesReport(parsed.data, actor, request.ip);

        if (result.format === 'csv') {
          return reply
            .header('Content-Type', 'text/csv; charset=utf-8')
            .header('Content-Disposition', 'attachment; filename="disconnection-candidates.csv"')
            .send(result.data);
        }

        return reply.send({
          success: true,
          data: result.data,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'DISCONNECTION_CANDIDATES_ERROR',
          message: err.message || 'Failed to generate disconnection candidates list',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  /**
   * 3. Daily Collection Summary Report
   * Permission: reports.financial
   */
  fastify.get(
    '/daily-collection',
    { preHandler: [fastify.authenticate, requirePermission('reports.financial')] },
    async (request, reply) => {
      const parsed = dailyCollectionQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid daily collection query parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);
      try {
        const result = await getDailyCollectionReport(parsed.data, actor, request.ip);

        if (result.format === 'csv') {
          return reply
            .header('Content-Type', 'text/csv; charset=utf-8')
            .header('Content-Disposition', 'attachment; filename="daily-collection-summary.csv"')
            .send(result.data);
        }

        return reply.send({
          success: true,
          data: result.data,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'DAILY_COLLECTION_REPORT_ERROR',
          message: err.message || 'Failed to generate daily collection summary',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  /**
   * 4. Billing & Revenue Summary Report
   * Permission: reports.financial
   */
  fastify.get(
    '/billing-revenue',
    { preHandler: [fastify.authenticate, requirePermission('reports.financial')] },
    async (request, reply) => {
      const parsed = billingRevenueQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid billing revenue query parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);
      try {
        const result = await getBillingRevenueReport(parsed.data, actor, request.ip);

        if (result.format === 'csv') {
          return reply
            .header('Content-Type', 'text/csv; charset=utf-8')
            .header('Content-Disposition', 'attachment; filename="billing-revenue-summary.csv"')
            .send(result.data);
        }

        return reply.send({
          success: true,
          data: result.data,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'BILLING_REVENUE_REPORT_ERROR',
          message: err.message || 'Failed to generate billing & revenue summary',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // Alias /monthly-revenue -> /billing-revenue
  fastify.get(
    '/monthly-revenue',
    { preHandler: [fastify.authenticate, requirePermission('reports.financial')] },
    async (request, reply) => {
      const parsed = billingRevenueQuerySchema.safeParse(request.query);
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

      const actor = extractActor(request);
      try {
        const result = await getBillingRevenueReport(parsed.data, actor, request.ip);
        if (result.format === 'csv') {
          return reply
            .header('Content-Type', 'text/csv; charset=utf-8')
            .header('Content-Disposition', 'attachment; filename="monthly-revenue-summary.csv"')
            .send(result.data);
        }
        return reply.send({
          success: true,
          data: result.data,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'BILLING_REVENUE_REPORT_ERROR',
          message: err.message || 'Failed to generate monthly revenue summary',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  /**
   * 5. Delinquent Receivables Report (Overdue accounts list)
   * Permission: receivable.view or receivable.view_aging
   */
  fastify.get(
    '/delinquent',
    { preHandler: [fastify.authenticate, requirePermission(['receivable.view', 'receivable.view_aging'], 'any')] },
    async (request, reply) => {
      const parsed = delinquentReceivablesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid delinquent query parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }

      const actor = extractActor(request);
      try {
        const result = await getDelinquentReceivablesReport(parsed.data, actor, request.ip);
        if (result.format === 'csv') {
          return reply
            .header('Content-Type', 'text/csv; charset=utf-8')
            .header('Content-Disposition', 'attachment; filename="delinquent-accounts.csv"')
            .send(result.data);
        }
        return reply.send({
          success: true,
          data: result.data,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          statusCode,
          error: err.name || 'Error',
          code: err.code || 'DELINQUENT_REPORT_ERROR',
          message: err.message || 'Failed to generate delinquent receivables report',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );
};

/**
 * Secondary router for /api/v1/receivables endpoints to align with api-design.md
 */
export const receivablesRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get(
    '/aging',
    { preHandler: [fastify.authenticate, requirePermission('receivable.view_aging')] },
    async (request, reply) => {
      const parsed = arAgingQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid AR aging query parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }
      const actor = extractActor(request);
      const result = await getArAgingReport(parsed.data, actor, request.ip);
      if (result.format === 'csv') {
        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', 'attachment; filename="ar-aging-report.csv"')
          .send(result.data);
      }
      return reply.send({
        success: true,
        data: result.data,
        timestamp: new Date().toISOString(),
      });
    }
  );

  fastify.get(
    '/delinquent',
    { preHandler: [fastify.authenticate, requirePermission(['receivable.view', 'receivable.view_aging'], 'any')] },
    async (request, reply) => {
      const parsed = delinquentReceivablesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }
      const actor = extractActor(request);
      const result = await getDelinquentReceivablesReport(parsed.data, actor, request.ip);
      if (result.format === 'csv') {
        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', 'attachment; filename="delinquent-accounts.csv"')
          .send(result.data);
      }
      return reply.send({
        success: true,
        data: result.data,
        timestamp: new Date().toISOString(),
      });
    }
  );

  fastify.get(
    '/suspension-candidates',
    { preHandler: [fastify.authenticate, requirePermission('reports.operational')] },
    async (request, reply) => {
      const parsed = disconnectionCandidatesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_ERROR',
          message: 'Invalid parameters',
          details: parsed.error.issues.map((i: any) => ({ field: i.path.join('.'), issue: i.message })),
          timestamp: new Date().toISOString(),
        });
      }
      const actor = extractActor(request);
      const result = await getDisconnectionCandidatesReport(parsed.data, actor, request.ip);
      if (result.format === 'csv') {
        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', 'attachment; filename="disconnection-candidates.csv"')
          .send(result.data);
      }
      return reply.send({
        success: true,
        data: result.data,
        timestamp: new Date().toISOString(),
      });
    }
  );
};

