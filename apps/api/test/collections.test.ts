import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { pool, db } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import {
  auditLogs,
  users,
  collectionAreas,
  collectionRoutes,
  collectionBatches,
  subscribers,
  subscriberAddresses,
  servicePlans,
  serviceAccounts,
  invoices,
} from '../src/db/schema.js';
import { eq, and, desc } from 'drizzle-orm';

describe('Collection Areas, Routes & Route Sheets Module (Phase 6)', () => {
  let server: FastifyInstance;
  let adminToken: string;
  let cashierToken: string;
  let supervisorToken: string;
  let collectorUserId: string;

  beforeAll(async () => {
    await seedDatabase();
    server = buildServer();
    await server.ready();

    // 1. Admin login
    const adminLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'Admin123!' },
    });
    adminToken = JSON.parse(adminLogin.payload).token;

    // 2. Cashier login
    const cashierLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'cashier', password: 'Cashier123!' },
    });
    cashierToken = JSON.parse(cashierLogin.payload).token;

    // 3. Collection Supervisor login
    const supvLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'collector_supv', password: 'Supervisor123!' },
    });
    supervisorToken = JSON.parse(supvLogin.payload).token;

    // Fetch collector user
    const [collector] = await db
      .select()
      .from(users)
      .where(eq(users.username, 'collector1'))
      .limit(1);
    collectorUserId = collector.id;

    // Ensure prerequisite service plan exists
    let [plan] = await db.select().from(servicePlans).limit(1);
    if (!plan) {
      await server.inject({
        method: 'POST',
        url: '/api/v1/plans',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Collections Standard Plan',
          serviceType: 'INTERNET',
          monthlyFeeCentavos: 129900,
        },
      });
    }

    // Ensure prerequisite subscriber exists
    let [sub] = await db.select().from(subscribers).limit(1);
    if (!sub) {
      await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Juan',
          lastName: 'Dela Cruz',
          contactNumber: '09171234567',
          streetAddress: 'Purok 1',
          barangay: 'Casisang',
          municipality: 'Malaybalay',
        },
      });
    }
  });

  afterAll(async () => {
    await server.close();
    await pool.end();
  });

  describe('1. Authentication & RBAC Authorization', () => {
    it('rejects unauthenticated access to collection areas with HTTP 401', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/collections/areas',
      });
      expect(res.statusCode).toBe(401);
    });

    it('denies Cashier from creating a collection area with HTTP 403 Forbidden', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/areas',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          name: 'Unauthorized Area',
          barangay: 'Casisang',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('denies Cashier from deleting a collection area with HTTP 403 Forbidden', async () => {
      const res = await server.inject({
        method: 'DELETE',
        url: '/api/v1/collections/areas/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows Collection Supervisor to view collection areas', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/collections/areas',
        headers: { authorization: `Bearer ${supervisorToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('2. Collection Areas CRUD & Collector Assignment', () => {
    let createdAreaId: string;

    it('creates a new collection area with unique code and name', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/areas',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          name: 'Kalasungay Sector 1',
          code: 'AREA-KLS-1',
          barangay: 'Kalasungay',
          city: 'Malaybalay',
          description: 'Upper Kalasungay residential and agricultural zone',
          assignedCollectorId: collectorUserId,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Kalasungay Sector 1');
      expect(body.data.code).toBe('AREA-KLS-1');
      expect(body.data.barangay).toBe('Kalasungay');
      expect(body.data.assignedCollector?.fullName).toBe('Pedro Penduko (Field Collector)');

      createdAreaId = body.data.id;

      // Verify audit log
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'COLLECTION_AREA_CREATED'),
            eq(auditLogs.entityId, createdAreaId)
          )
        )
        .limit(1);
      expect(audit).toBeDefined();
      expect(audit.actorName).toContain('Carlos Lim');
    });

    it('rejects duplicate collection area name with HTTP 409 Conflict', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/areas',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Kalasungay Sector 1',
          code: 'AREA-KLS-DIFF',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('AREA_NAME_EXISTS');
    });

    it('rejects duplicate collection area code with HTTP 409 Conflict', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/areas',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Different Name Area',
          code: 'AREA-KLS-1',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('AREA_CODE_EXISTS');
    });

    it('retrieves collection area by ID with route count and account count', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/collections/areas/${createdAreaId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.id).toBe(createdAreaId);
      expect(typeof body.data.routeCount).toBe('number');
      expect(typeof body.data.accountCount).toBe('number');
    });

    it('updates collection area description, barangay, and status', async () => {
      const res = await server.inject({
        method: 'PUT',
        url: `/api/v1/collections/areas/${createdAreaId}`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          description: 'Updated Kalasungay description notes',
          city: 'Malaybalay City',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.description).toBe('Updated Kalasungay description notes');
      expect(body.data.city).toBe('Malaybalay City');

      // Verify audit log
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'COLLECTION_AREA_UPDATED'),
            eq(auditLogs.entityId, createdAreaId)
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      expect(audit).toBeDefined();
    });

    it('assigns/reassigns collector to area via dedicated endpoint', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/collections/areas/${createdAreaId}/assign-collector`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          collectorId: collectorUserId,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.assignedCollectorId).toBe(collectorUserId);

      // Verify audit log
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'COLLECTOR_ASSIGNED_TO_AREA'),
            eq(auditLogs.entityId, createdAreaId)
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      expect(audit).toBeDefined();
      expect(audit.newValues).toHaveProperty('assignedCollectorId', collectorUserId);
    });

    it('queries collection areas with search filter', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/collections/areas?search=Kalasungay',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data.some((a: any) => a.id === createdAreaId)).toBe(true);
    });

    it('deletes collection area without batches', async () => {
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/collections/areas/${createdAreaId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);

      const check = await server.inject({
        method: 'GET',
        url: `/api/v1/collections/areas/${createdAreaId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(check.statusCode).toBe(404);
    });

    it('rejects deleting a collection area that has associated batches', async () => {
      // Find area with existing batches
      const [batch] = await db.select().from(collectionBatches).limit(1);
      if (batch) {
        const res = await server.inject({
          method: 'DELETE',
          url: `/api/v1/collections/areas/${batch.collectionAreaId}`,
          headers: { authorization: `Bearer ${adminToken}` },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.payload);
        expect(body.code).toBe('AREA_HAS_BATCHES');
      }
    });

    it('rejects deleting a collection area that has associated service accounts', async () => {
      const areaRes = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/areas',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          name: `Area With Accounts ${Date.now()}`,
          code: `AREA-W-ACC-${Date.now().toString().slice(-4)}`,
        },
      });
      expect(areaRes.statusCode).toBe(201);
      const area = JSON.parse(areaRes.payload).data;

      const [plan] = await db.select().from(servicePlans).limit(1);
      const [sub] = await db.select().from(subscribers).limit(1);
      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: sub.id,
          servicePlanId: plan.id,
          collectionAreaId: area.id,
          status: 'ACTIVE',
        },
      });
      expect(saRes.statusCode).toBe(201);

      const delRes = await server.inject({
        method: 'DELETE',
        url: `/api/v1/collections/areas/${area.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(delRes.statusCode).toBe(400);
      const body = JSON.parse(delRes.payload);
      expect(body.code).toBe('AREA_HAS_ACCOUNTS');
    });
  });

  describe('3. Collection Routes Management', () => {
    let testAreaId: string;
    let testRouteId: string;

    beforeAll(async () => {
      // Create a dedicated area for route tests
      const [area] = await db
        .select()
        .from(collectionAreas)
        .where(eq(collectionAreas.name, 'Casisang'))
        .limit(1);
      testAreaId = area.id;
    });

    it('creates a new collection route under an area', async () => {
      const routeCode = `TEST-R-${Date.now().toString().slice(-4)}`;
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/routes',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          collectionAreaId: testAreaId,
          routeCode,
          name: 'Route 99 - Mountain View',
          description: 'Purok 5 to 7 hillside houses',
          assignedCollectorId: collectorUserId,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.routeCode).toBe(routeCode);
      expect(body.data.name).toBe('Route 99 - Mountain View');
      expect(body.data.collectionArea.name).toBe('Casisang');

      testRouteId = body.data.id;
    });

    it('rejects duplicate route code with HTTP 409 Conflict', async () => {
      const [route] = await db.select().from(collectionRoutes).where(eq(collectionRoutes.id, testRouteId)).limit(1);

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/routes',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          collectionAreaId: testAreaId,
          routeCode: route.routeCode,
          name: 'Conflicting Route Name',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('ROUTE_CODE_EXISTS');
    });

    it('lists collection routes filtered by area', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/collections/routes?collectionAreaId=${testAreaId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data.some((r: any) => r.id === testRouteId)).toBe(true);
    });

    it('updates route name and collector', async () => {
      const res = await server.inject({
        method: 'PUT',
        url: `/api/v1/collections/routes/${testRouteId}`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          name: 'Route 99 - Mountain View Updated',
          description: 'Updated route notes',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.name).toBe('Route 99 - Mountain View Updated');
    });

    it('deletes collection route', async () => {
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/collections/routes/${testRouteId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);

      const check = await server.inject({
        method: 'GET',
        url: `/api/v1/collections/routes/${testRouteId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(check.statusCode).toBe(404);
    });

    it('rejects deleting a collection route that has associated service accounts', async () => {
      const routeCode = `TEST-R-ACC-${Date.now().toString().slice(-4)}`;
      const routeRes = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/routes',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          collectionAreaId: testAreaId,
          routeCode,
          name: 'Route With Accounts Test',
        },
      });
      expect(routeRes.statusCode).toBe(201);
      const route = JSON.parse(routeRes.payload).data;

      const [plan] = await db.select().from(servicePlans).limit(1);
      const [sub] = await db.select().from(subscribers).limit(1);
      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: sub.id,
          servicePlanId: plan.id,
          collectionAreaId: testAreaId,
          collectionRouteId: route.id,
          status: 'ACTIVE',
        },
      });
      expect(saRes.statusCode).toBe(201);

      const delRes = await server.inject({
        method: 'DELETE',
        url: `/api/v1/collections/routes/${route.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(delRes.statusCode).toBe(400);
      const body = JSON.parse(delRes.payload);
      expect(body.code).toBe('ROUTE_HAS_ACCOUNTS');
    });
  });

  describe('4. Field Route Sheet Generation', () => {
    let routeSheetAreaId: string;
    let subscriberWithOverdueId: string;
    let serviceAccountId: string;

    beforeAll(async () => {
      // 1. Fetch or create Casisang area
      const [area] = await db
        .select()
        .from(collectionAreas)
        .where(eq(collectionAreas.name, 'Casisang'))
        .limit(1);
      routeSheetAreaId = area.id;

      // 2. Fetch a plan
      const [plan] = await db.select().from(servicePlans).limit(1);

      // 3. Create a subscriber residing in Casisang
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Eduardo',
          lastName: 'RouteSheetTest',
          contactNumber: '09179876543',
          streetAddress: 'Purok 3, Casisang Highway',
          barangay: 'Casisang',
          municipality: 'Malaybalay',
        },
      });
      const subBody = JSON.parse(subRes.payload);
      subscriberWithOverdueId = subBody.data.id;

      // 4. Create a service account in Casisang
      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: subscriberWithOverdueId,
          servicePlanId: plan.id,
          collectorId: collectorUserId,
          currentRateCentavos: 129900,
          status: 'ACTIVE',
          activationDate: '2026-08-01',
        },
      });
      const saBody = JSON.parse(saRes.payload);
      serviceAccountId = saBody.data.id;

      // Set collectionAreaId on the service account
      await db
        .update(serviceAccounts)
        .set({ collectionAreaId: routeSheetAreaId })
        .where(eq(serviceAccounts.id, serviceAccountId));

      // 5. Generate an invoice for this account
      await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId,
          billingPeriodStart: '2026-08-01',
          billingPeriodEnd: '2026-08-31',
          issueDate: '2026-08-01',
          dueDate: '2026-08-20',
        },
      });
    });

    it('generates a route sheet for an area listing accounts with arrears', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/collections/areas/${routeSheetAreaId}/route-sheet`,
        headers: { authorization: `Bearer ${supervisorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.area.id).toBe(routeSheetAreaId);
      expect(body.data.area.name).toBe('Casisang');
      expect(body.data.totalAccounts).toBeGreaterThanOrEqual(1);
      expect(body.data.totalDelinquentAccounts).toBeGreaterThanOrEqual(1);
      expect(body.data.totalArrearsCentavos).toBeGreaterThan(0);

      const targetAccount = body.data.accounts.find(
        (a: any) => a.serviceAccountId === serviceAccountId
      );
      expect(targetAccount).toBeDefined();
      expect(targetAccount.subscriberName).toContain('RouteSheetTest');
      expect(targetAccount.contactNumber).toBe('09179876543');
      expect(targetAccount.address).toContain('Purok 3, Casisang Highway');
      expect(targetAccount.openInvoiceCount).toBeGreaterThanOrEqual(1);
      expect(targetAccount.totalArrearsCentavos).toBe(129900);
      expect(targetAccount.netDueCentavos).toBe(129900);
      expect(targetAccount.oldestInvoiceDueDate).toBe('2026-08-20');
    });

    it('generates a route sheet for a collection batch', async () => {
      // Open a batch for Casisang
      const batchRes = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/batches',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          collectorId: collectorUserId,
          collectionAreaId: routeSheetAreaId,
        },
      });
      const batch = JSON.parse(batchRes.payload).data;

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/collections/batches/${batch.id}/route-sheet`,
        headers: { authorization: `Bearer ${supervisorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.area.name).toBe('Casisang');
      expect(body.data.collector.id).toBe(collectorUserId);
      expect(body.data.accounts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('5. Route-Specific Route Sheet & Collector Assignment API', () => {
    let specificRouteAreaId: string;
    let routeAId: string;
    let routeBId: string;
    let accountOnRouteAId: string;
    let accountOnRouteBId: string;

    beforeAll(async () => {
      // 1. Create dedicated area
      const areaRes = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/areas',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          name: `Route Specific Area ${Date.now()}`,
          code: `AREA-SPEC-${Date.now().toString().slice(-4)}`,
        },
      });
      specificRouteAreaId = JSON.parse(areaRes.payload).data.id;

      // 2. Create Route A and Route B under this area
      const routeARes = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/routes',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          collectionAreaId: specificRouteAreaId,
          routeCode: `ROUT-A-${Date.now().toString().slice(-4)}`,
          name: 'Route Alpha',
        },
      });
      routeAId = JSON.parse(routeARes.payload).data.id;

      const routeBRes = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/routes',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          collectionAreaId: specificRouteAreaId,
          routeCode: `ROUT-B-${Date.now().toString().slice(-4)}`,
          name: 'Route Beta',
        },
      });
      routeBId = JSON.parse(routeBRes.payload).data.id;

      const [plan] = await db.select().from(servicePlans).limit(1);
      const [sub] = await db.select().from(subscribers).limit(1);

      // 3. Create Account 1 on Route A
      const sa1Res = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: sub.id,
          servicePlanId: plan.id,
          collectionAreaId: specificRouteAreaId,
          collectionRouteId: routeAId,
          status: 'ACTIVE',
        },
      });
      accountOnRouteAId = JSON.parse(sa1Res.payload).data.id;

      // Generate overdue invoice for Account 1
      await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: accountOnRouteAId,
          billingPeriodStart: '2026-07-01',
          billingPeriodEnd: '2026-07-31',
          issueDate: '2026-07-01',
          dueDate: '2026-07-20',
        },
      });

      // 4. Create Account 2 on Route B
      const sa2Res = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: sub.id,
          servicePlanId: plan.id,
          collectionAreaId: specificRouteAreaId,
          collectionRouteId: routeBId,
          status: 'ACTIVE',
        },
      });
      accountOnRouteBId = JSON.parse(sa2Res.payload).data.id;

      // Generate invoice for Account 2
      await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: accountOnRouteBId,
          billingPeriodStart: '2026-07-01',
          billingPeriodEnd: '2026-07-31',
          issueDate: '2026-07-01',
          dueDate: '2026-07-20',
        },
      });
    });

    it('assigns collector, area, and route via PATCH /api/v1/service-accounts/:id/collector', async () => {
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/service-accounts/${accountOnRouteAId}/collector`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          collectorId: collectorUserId,
          collectionAreaId: specificRouteAreaId,
          collectionRouteId: routeAId,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.collectorId).toBe(collectorUserId);
      expect(body.data.collectionAreaId).toBe(specificRouteAreaId);
      expect(body.data.collectionRouteId).toBe(routeAId);

      // Verify audit log
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'SERVICE_ACCOUNT_COLLECTOR_ASSIGNED'),
            eq(auditLogs.entityId, accountOnRouteAId)
          )
        )
        .limit(1);
      expect(audit).toBeDefined();
    });

    it('generates route sheet specifically for Route A without leaking Route B accounts', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/collections/routes/${routeAId}/route-sheet`,
        headers: { authorization: `Bearer ${supervisorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.route.id).toBe(routeAId);

      const hasRouteAAccount = body.data.accounts.some((a: any) => a.serviceAccountId === accountOnRouteAId);
      const hasRouteBAccount = body.data.accounts.some((a: any) => a.serviceAccountId === accountOnRouteBId);

      expect(hasRouteAAccount).toBe(true);
      expect(hasRouteBAccount).toBe(false);
    });

    it('supports overdueOnly filter parameter on route sheets', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/collections/routes/${routeAId}/route-sheet?overdueOnly=true`,
        headers: { authorization: `Bearer ${supervisorToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.accounts.every((a: any) => a.isOverdue === true)).toBe(true);
    });
  });
});
