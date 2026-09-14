import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { pool, db } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { auditLogs, serviceAccounts } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('Service Accounts Module (Phase 3)', () => {
  let server: FastifyInstance;
  let adminToken: string;
  let cashierToken: string;
  let subscriberId: string;
  let planId: string;
  let planRateCentavos: number;

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

    // Create prerequisite plan
    const planRes = await server.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Fiber Starter 25 Mbps',
        serviceType: 'INTERNET',
        monthlyFeeCentavos: 99900, // ₱999.00
      },
    });
    const planBody = JSON.parse(planRes.payload);
    planId = planBody.data.id;
    planRateCentavos = planBody.data.monthlyFeeCentavos;

    // Create prerequisite subscriber
    const subRes = await server.inject({
      method: 'POST',
      url: '/api/v1/subscribers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        firstName: 'Bernardo',
        lastName: 'Carpio',
        contactNumber: '09170001122',
        streetAddress: 'Mt. Kitanglad Road',
        barangay: 'Dalwangan',
        municipality: 'Malaybalay',
      },
    });
    const subBody = JSON.parse(subRes.payload);
    subscriberId = subBody.data.id;
  });

  afterAll(async () => {
    await server.close();
    await pool.end();
  });

  describe('RBAC & Authentication', () => {
    it('rejects unauthenticated request to list service accounts with HTTP 401', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/service-accounts',
      });
      expect(response.statusCode).toBe(401);
    });

    it('denies Cashier from creating a service account with HTTP 403 Forbidden', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId,
          servicePlanId: planId,
        },
      });

      expect(response.statusCode).toBe(403);
      const error = JSON.parse(response.payload);
      expect(error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('allows Cashier to view service accounts list', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${cashierToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('Provisioning & Constraints', () => {
    it('rejects creating service account with non-existent subscriber ID with HTTP 404', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: '00000000-0000-0000-0000-000000000000',
          servicePlanId: planId,
        },
      });

      expect(response.statusCode).toBe(404);
      const error = JSON.parse(response.payload);
      expect(error.code).toBe('SUBSCRIBER_NOT_FOUND');
    });

    it('rejects creating service account with non-existent plan ID with HTTP 404', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId,
          servicePlanId: '00000000-0000-0000-0000-000000000000',
        },
      });

      expect(response.statusCode).toBe(404);
      const error = JSON.parse(response.payload);
      expect(error.code).toBe('PLAN_NOT_FOUND');
    });
  });

  describe('Lifecycle Management & Audit Logging', () => {
    let serviceAccountId: string;
    let serviceAccountNumber: string;

    it('creates a service account with auto-generated number and defaults rate to plan', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId,
          servicePlanId: planId,
          billingDayOfMonth: 5,
          status: 'PENDING',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.data.id).toBeDefined();
      expect(body.data.serviceAccountNumber).toMatch(/^SA-\d{6}-\d{4}$/);
      expect(body.data.currentRateCentavos).toBe(planRateCentavos);
      expect(body.data.billingDayOfMonth).toBe(5);
      expect(body.data.status).toBe('PENDING');
      expect(body.data.subscriber).toBeDefined();
      expect(body.data.plan).toBeDefined();
      expect(body.data.installationAddress).toBeDefined(); // Fallback to primary address

      serviceAccountId = body.data.id;
      serviceAccountNumber = body.data.serviceAccountNumber;

      // Verify audit log
      const audit = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, serviceAccountId));
      expect(audit.length).toBeGreaterThan(0);
      expect(audit[0].action).toBe('SERVICE_ACCOUNT_CREATED');
      expect(audit[0].entityType).toBe('SERVICE_ACCOUNT');
    });

    it('provisions a second service account with custom installation address and rate override', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId,
          servicePlanId: planId,
          streetAddress: 'Branch Office, Capitol Compound',
          barangay: 'Poblacion',
          municipality: 'Malaybalay',
          currentRateCentavos: 89900, // Discounted rate: ₱899.00
          status: 'ACTIVE',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.data.currentRateCentavos).toBe(89900);
      expect(body.data.status).toBe('ACTIVE');
      expect(body.data.activationDate).toBeDefined(); // Auto-set today on active
      expect(body.data.installationAddress.streetAddress).toBe('Branch Office, Capitol Compound');
      expect(body.data.installationAddress.barangay).toBe('Poblacion');
    });

    it('retrieves service account by ID', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/service-accounts/${serviceAccountId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.id).toBe(serviceAccountId);
      expect(body.data.serviceAccountNumber).toBe(serviceAccountNumber);
      expect(body.data.subscriber.id).toBe(subscriberId);
      expect(body.data.plan.id).toBe(planId);
    });

    it('retrieves service account by account number', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/service-accounts/${serviceAccountNumber}`,
        headers: { authorization: `Bearer ${cashierToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.id).toBe(serviceAccountId);
    });

    it('transitions status from PENDING to ACTIVE via PATCH /status', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/service-accounts/${serviceAccountId}/status`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          status: 'ACTIVE',
          reason: 'Installation completed by technician team Alpha',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.status).toBe('ACTIVE');
      expect(body.data.activationDate).toBeDefined();

      // Verify audit log
      const audit = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, serviceAccountId));
      const statusLogs = audit.filter((a) => a.action === 'SERVICE_ACCOUNT_STATUS_CHANGED');
      expect(statusLogs.length).toBeGreaterThan(0);
      expect(statusLogs[0].reason).toBe('Installation completed by technician team Alpha');
    });

    it('transitions status from ACTIVE to SUSPENDED via PATCH /status', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/service-accounts/${serviceAccountId}/status`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          status: 'SUSPENDED',
          reason: '60+ days overdue arrears',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.status).toBe('SUSPENDED');
    });

    it('transitions status from SUSPENDED back to ACTIVE upon reconnection', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/service-accounts/${serviceAccountId}/status`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          status: 'ACTIVE',
          reason: 'Full balance settled and reconnection fee paid',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.status).toBe('ACTIVE');
    });

    it('transitions status to TERMINATED', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/service-accounts/${serviceAccountId}/status`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          status: 'TERMINATED',
          reason: 'Subscriber relocated outside coverage area',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.status).toBe('TERMINATED');
    });

    it('updates service account attributes via general PATCH /:id', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/service-accounts/${serviceAccountId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          billingDayOfMonth: 15,
          currentRateCentavos: 105000,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.billingDayOfMonth).toBe(15);
      expect(body.data.currentRateCentavos).toBe(105000);

      // Verify audit log
      const audit = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, serviceAccountId));
      const updateLogs = audit.filter((a) => a.action === 'SERVICE_ACCOUNT_UPDATED');
      expect(updateLogs.length).toBeGreaterThan(0);
    });

    it('lists service accounts filtered by subscriberId and status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/service-accounts?subscriberId=${subscriberId}&status=TERMINATED`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0].id).toBe(serviceAccountId);
      expect(body.data[0].status).toBe('TERMINATED');
    });
  });
});
