import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { pool, db } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { auditLogs, servicePlans } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('Service Plans Module (Phase 3)', () => {
  let server: FastifyInstance;
  let adminToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    await seedDatabase();
    server = buildServer();
    await server.ready();

    // Log in Admin
    const adminLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'Admin123!' },
    });
    adminToken = JSON.parse(adminLogin.payload).token;

    // Log in Cashier
    const cashierLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'cashier', password: 'Cashier123!' },
    });
    cashierToken = JSON.parse(cashierLogin.payload).token;
  });

  afterAll(async () => {
    await server.close();
    await pool.end();
  });

  describe('RBAC & Authentication Protections', () => {
    it('rejects unauthenticated request to list plans with HTTP 401', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/plans',
      });
      expect(response.statusCode).toBe(401);
    });

    it('denies Cashier from creating a service plan with HTTP 403 Forbidden', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/plans',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          name: 'Unauthorized Plan',
          serviceType: 'INTERNET',
          monthlyFeeCentavos: 150000,
        },
      });

      expect(response.statusCode).toBe(403);
      const error = JSON.parse(response.payload);
      expect(error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('allows Cashier with plans.read permission to list plans', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/plans',
        headers: { authorization: `Bearer ${cashierToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('Validation & Financial Integer Centavos Enforcement', () => {
    it('rejects floating-point monthlyFeeCentavos with HTTP 400', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/plans',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Invalid Float Plan',
          serviceType: 'INTERNET',
          monthlyFeeCentavos: 1499.5, // Not an integer centavo!
        },
      });

      expect(response.statusCode).toBe(400);
      const error = JSON.parse(response.payload);
      expect(error.code).toBe('INVALID_INPUT');
      expect(error.details.some((d: { issue: string }) => d.issue.includes('integer'))).toBe(true);
    });

    it('rejects negative monthlyFeeCentavos with HTTP 400', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/plans',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Negative Fee Plan',
          serviceType: 'INTERNET',
          monthlyFeeCentavos: -5000,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects invalid service type with HTTP 400', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/plans',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Invalid Type Plan',
          serviceType: 'SATELLITE_DISH',
          monthlyFeeCentavos: 100000,
        },
      });

      expect(response.statusCode).toBe(400);
      const error = JSON.parse(response.payload);
      expect(error.details.some((d: { issue: string }) => d.issue.includes('Service type'))).toBe(true);
    });
  });

  describe('CRUD Lifecycle & Service Types', () => {
    let createdPlanId: string;
    const testCode = `FIBER-${Date.now().toString().slice(-4)}`;

    it('creates an INTERNET plan with integer centavos and verifies audit log', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/plans',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Fiber Fast 50 Mbps',
          planCode: testCode,
          serviceType: 'INTERNET',
          monthlyFeeCentavos: 129900, // ₱1,299.00
          installationFeeCentavos: 150000, // ₱1,500.00
          bandwidthMbps: 50,
          isActive: true,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.data.planCode).toBe(testCode);
      expect(body.data.monthlyFeeCentavos).toBe(129900);
      expect(body.data.monthlyRecurringCentavos).toBe(129900);
      expect(body.data.bandwidthMbps).toBe(50);
      expect(body.data.serviceType).toBe('INTERNET');
      expect(body.data.isActive).toBe(true);
      createdPlanId = body.data.id;

      // Verify audit log record
      const audit = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, createdPlanId));
      expect(audit.length).toBeGreaterThan(0);
      expect(audit[0].action).toBe('PLAN_CREATED');
      expect(audit[0].entityType).toBe('SERVICE_PLAN');
    });

    it('creates a CABLE plan successfully', async () => {
      const cableCode = `CATV-${Date.now().toString().slice(-4)}`;
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/plans',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Cable Deluxe 80 Channels',
          planCode: cableCode,
          serviceType: 'CABLE',
          monthlyFeeCentavos: 75000, // ₱750.00
          channelCount: 80,
          isActive: true,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.data.channelCount).toBe(80);
      expect(body.data.monthlyFeeCentavos).toBe(75000);
    });

    it('creates a BUNDLE plan successfully via alias endpoint /api/v1/service-plans', async () => {
      const bundleCode = `BNDL-${Date.now().toString().slice(-4)}`;
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/service-plans',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Fiber + Cable All-In',
          planCode: bundleCode,
          serviceType: 'BUNDLE',
          monthlyFeeCentavos: 189900, // ₱1,899.00
          bandwidthMbps: 100,
          channelCount: 120,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.data.planCode).toBe(bundleCode);
      expect(body.data.bandwidthMbps).toBe(100);
      expect(body.data.channelCount).toBe(120);
    });

    it('rejects duplicate plan code with HTTP 409 Conflict', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/plans',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Duplicate Plan Code',
          planCode: testCode,
          serviceType: 'INTERNET',
          monthlyFeeCentavos: 99900,
        },
      });

      expect(response.statusCode).toBe(409);
      const error = JSON.parse(response.payload);
      expect(error.code).toBe('PLAN_CODE_EXISTS');
    });

    it('retrieves plan by ID', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/plans/${createdPlanId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.id).toBe(createdPlanId);
      expect(body.data.planCode).toBe(testCode);
    });

    it('returns HTTP 404 for non-existent plan ID', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/plans/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(404);
      const error = JSON.parse(response.payload);
      expect(error.code).toBe('PLAN_NOT_FOUND');
    });

    it('updates plan name, rate, bandwidth, and isActive via PATCH', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/plans/${createdPlanId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Fiber Ultra 75 Mbps Updated',
          monthlyFeeCentavos: 139900,
          bandwidthMbps: 75,
          isActive: false,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.name).toBe('Fiber Ultra 75 Mbps Updated');
      expect(body.data.monthlyFeeCentavos).toBe(139900);
      expect(body.data.bandwidthMbps).toBe(75);
      expect(body.data.isActive).toBe(false);

      // Verify audit log
      const audit = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, createdPlanId));
      const updateLogs = audit.filter((a) => a.action === 'PLAN_UPDATED');
      expect(updateLogs.length).toBeGreaterThan(0);
    });

    it('filters plans by serviceType and isActive', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/plans?serviceType=INTERNET&isActive=false',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.some((p: { id: string }) => p.id === createdPlanId)).toBe(true);
    });
  });
});
