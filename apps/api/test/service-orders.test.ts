import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { pool, db } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import {
  users,
  subscribers,
  subscriberAddresses,
  servicePlans,
  serviceAccounts,
  serviceOrders,
  auditLogs,
} from '../src/db/schema.js';
import { eq, and, desc } from 'drizzle-orm';

describe('Service Orders Engine (Phase 6)', () => {
  let server: FastifyInstance;
  let adminToken: string;
  let cashierToken: string;
  let techToken: string;
  let techUserId: string;

  let testSubscriberId: string;
  let testPlanId: string;
  let activeServiceAccountId: string;
  let pendingServiceAccountId: string;

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

    // 3. Technician login
    const techLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'technician', password: 'Tech123!' },
    });
    techToken = JSON.parse(techLogin.payload).token;

    // Fetch technician user ID
    const [tech] = await db
      .select()
      .from(users)
      .where(eq(users.username, 'technician'))
      .limit(1);
    techUserId = tech.id;

    // 4. Create base plan
    const planRes = await server.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Fiber Plan 100 Mbps',
        serviceType: 'INTERNET',
        monthlyFeeCentavos: 159900,
        installationFeeCentavos: 150000,
      },
    });
    testPlanId = JSON.parse(planRes.payload).data.id;

    // 5. Create base subscriber
    const subRes = await server.inject({
      method: 'POST',
      url: '/api/v1/subscribers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        firstName: 'Rodrigo',
        lastName: 'ServiceOrderUser',
        contactNumber: '09171122334',
        streetAddress: 'Fortich Street Zone 4',
        barangay: 'Poblacion',
        municipality: 'Malaybalay',
      },
    });
    testSubscriberId = JSON.parse(subRes.payload).data.id;

    // 6. Create ACTIVE service account
    const activeSaRes = await server.inject({
      method: 'POST',
      url: '/api/v1/service-accounts',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        subscriberId: testSubscriberId,
        servicePlanId: testPlanId,
        status: 'ACTIVE',
        activationDate: '2026-08-01',
      },
    });
    activeServiceAccountId = JSON.parse(activeSaRes.payload).data.id;

    // 7. Create PENDING_INSTALL service account
    const pendingSaRes = await server.inject({
      method: 'POST',
      url: '/api/v1/service-accounts',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        subscriberId: testSubscriberId,
        servicePlanId: testPlanId,
        status: 'PENDING_INSTALL',
      },
    });
    pendingServiceAccountId = JSON.parse(pendingSaRes.payload).data.id;
  });

  afterAll(async () => {
    await db.delete(serviceOrders);
    if (server) {
      await server.close();
    }
    await pool.end();
  });

  describe('1. RBAC & Authentication', () => {
    it('rejects unauthenticated requests to service orders with HTTP 401', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/service-orders',
      });
      expect(res.statusCode).toBe(401);
    });

    it('denies Cashier from creating a service order with HTTP 403 Forbidden', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          serviceAccountId: activeServiceAccountId,
          orderType: 'REPAIR',
          description: 'No internet connection',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows Technician to read service orders list', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${techToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('2. Sequential Numbering (SO-YYYYMM-XXXX) & Advisory Locking', () => {
    it('generates sequential service order numbers with monotonic format SO-YYYYMM-XXXX', async () => {
      const res1 = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: activeServiceAccountId,
          orderType: 'REPAIR',
          description: 'LOS red light on fiber modem',
          priority: 'HIGH',
        },
      });

      expect(res1.statusCode).toBe(201);
      const order1 = JSON.parse(res1.payload).data;
      expect(order1.orderNumber).toMatch(/^SO-\d{6}-\d{4}$/);

      const res2 = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: activeServiceAccountId,
          orderType: 'REPAIR',
          description: 'Intermittent packet loss',
          priority: 'NORMAL',
        },
      });

      expect(res2.statusCode).toBe(201);
      const order2 = JSON.parse(res2.payload).data;
      expect(order2.orderNumber).toMatch(/^SO-\d{6}-\d{4}$/);

      // Verify sequence strictly increments
      const seq1 = parseInt(order1.orderNumber.split('-')[2], 10);
      const seq2 = parseInt(order2.orderNumber.split('-')[2], 10);
      expect(seq2).toBe(seq1 + 1);
    });

    it('handles concurrent service order creation without number collisions', async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        server.inject({
          method: 'POST',
          url: '/api/v1/service-orders',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            serviceAccountId: activeServiceAccountId,
            orderType: 'REPAIR',
            description: `Concurrent order test #${i + 1}`,
          },
        })
      );

      const responses = await Promise.all(promises);
      const numbers = new Set<string>();

      for (const r of responses) {
        expect(r.statusCode).toBe(201);
        const data = JSON.parse(r.payload).data;
        expect(data.orderNumber).toMatch(/^SO-\d{6}-\d{4}$/);
        expect(numbers.has(data.orderNumber)).toBe(false);
        numbers.add(data.orderNumber);
      }

      expect(numbers.size).toBe(5);
    });
  });

  describe('3. Lifecycle State Machine Transitions', () => {
    let testOrderId: string;

    it('creates service order in PENDING status when no technician is initially assigned', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: activeServiceAccountId,
          orderType: 'REPAIR',
          description: 'Frayed drop wire near post 12',
          priority: 'NORMAL',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data.status).toBe('PENDING');
      expect(body.data.assignedTechnicianId).toBeNull();
      testOrderId = body.data.id;
    });

    it('transitions PENDING -> ASSIGNED when a technician is assigned', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${testOrderId}/assign`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          technicianId: techUserId,
          scheduledDate: '2026-09-20',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.status).toBe('ASSIGNED');
      expect(body.data.assignedTechnicianId).toBe(techUserId);
      expect(body.data.assignedTechnician.username).toBe('technician');
      expect(body.data.scheduledDate).toBe('2026-09-20');

      // Verify audit log
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'SERVICE_ORDER_ASSIGNED'),
            eq(auditLogs.entityId, testOrderId)
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      expect(audit).toBeDefined();
    });

    it('transitions ASSIGNED -> IN_PROGRESS when technician starts work', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${testOrderId}/status`,
        headers: { authorization: `Bearer ${techToken}` },
        payload: {
          status: 'IN_PROGRESS',
          reason: 'Technician on site diagnosing line',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.status).toBe('IN_PROGRESS');

      // Verify audit log
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'SERVICE_ORDER_STATUS_CHANGED'),
            eq(auditLogs.entityId, testOrderId)
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      expect(audit).toBeDefined();
      expect(audit.newValues).toHaveProperty('status', 'IN_PROGRESS');
    });

    it('transitions IN_PROGRESS -> COMPLETED with resolution notes and materials', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${testOrderId}/complete`,
        headers: { authorization: `Bearer ${techToken}` },
        payload: {
          resolutionNotes: 'Replaced splice and re-terminated fiber optical connector. Signal restored to -18 dBm.',
          materialsUsed: [
            { item: 'Fiber Fast Connector SC/APC', quantity: 2, unit: 'pcs' },
            { item: 'Drop Wire Tension Clamp', quantity: 1, unit: 'pcs' },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.status).toBe('COMPLETED');
      expect(body.data.resolutionNotes).toContain('Signal restored to -18 dBm');
      expect(body.data.materialsUsed.length).toBe(2);
      expect(body.data.completedAt).not.toBeNull();
    });

    it('blocks subsequent modifications on a COMPLETED service order (terminal state)', async () => {
      const res = await server.inject({
        method: 'PUT',
        url: `/api/v1/service-orders/${testOrderId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          description: 'Trying to modify completed order',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('TERMINAL_STATE_IMMUTABLE');
    });

    it('transitions PENDING -> CANCELLED with cancellation reason', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: activeServiceAccountId,
          orderType: 'REPAIR',
          description: 'Subscriber reported slow speed',
        },
      });
      const order = JSON.parse(createRes.payload).data;

      const cancelRes = await server.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${order.id}/cancel`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: 'Subscriber called back; speed normalized after router reboot',
        },
      });

      expect(cancelRes.statusCode).toBe(200);
      const cancelled = JSON.parse(cancelRes.payload).data;
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancellationReason).toContain('router reboot');
      expect(cancelled.cancelledAt).not.toBeNull();

      // Blocks completion of a cancelled order
      const completeRes = await server.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${order.id}/complete`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          resolutionNotes: 'Attempting to complete cancelled order',
        },
      });
      expect(completeRes.statusCode).toBe(400);
    });
  });

  describe('4. Automatic Service Account Status Synchronization', () => {
    it('INSTALLATION completion: transitions PENDING_INSTALL service account to ACTIVE and sets activationDate', async () => {
      // Create INSTALLATION order for pending account
      const orderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: pendingServiceAccountId,
          orderType: 'INSTALLATION',
          description: 'Standard fiber drop installation with ONU modem',
          assignedTechnicianId: techUserId,
          scheduledDate: '2026-09-17',
          feeCentavos: 150000,
        },
      });
      expect(orderRes.statusCode).toBe(201);
      const order = JSON.parse(orderRes.payload).data;
      expect(order.status).toBe('ASSIGNED');

      // Complete INSTALLATION order
      const compRes = await server.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${order.id}/complete`,
        headers: { authorization: `Bearer ${techToken}` },
        payload: {
          resolutionNotes: 'Modem provisioned and activated. Speed test verified 100 Mbps downstream.',
          completedAt: '2026-09-17T14:30:00Z',
        },
      });
      expect(compRes.statusCode).toBe(200);

      // Verify service account status is now ACTIVE with activationDate set
      const [sa] = await db
        .select()
        .from(serviceAccounts)
        .where(eq(serviceAccounts.id, pendingServiceAccountId))
        .limit(1);

      expect(sa.status).toBe('ACTIVE');
      expect(sa.activationDate).toBe('2026-09-17');

      // Verify audit log for status change
      const [statusAudit] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'SERVICE_ACCOUNT_STATUS_CHANGED'),
            eq(auditLogs.entityId, pendingServiceAccountId)
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);

      expect(statusAudit).toBeDefined();
      expect(statusAudit.newValues).toHaveProperty('status', 'ACTIVE');
    });

    it('DISCONNECTION completion: transitions ACTIVE service account to SUSPENDED by default', async () => {
      // Create DISCONNECTION order (temporary)
      const orderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: activeServiceAccountId,
          orderType: 'DISCONNECTION',
          description: 'Delinquent subscriber over 60 days arrears',
          disconnectionType: 'TEMPORARY',
          assignedTechnicianId: techUserId,
        },
      });
      expect(orderRes.statusCode).toBe(201);
      const order = JSON.parse(orderRes.payload).data;

      // Complete DISCONNECTION order
      const compRes = await server.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${order.id}/complete`,
        headers: { authorization: `Bearer ${techToken}` },
        payload: {
          resolutionNotes: 'Port disabled at fiber distribution hub terminal #4.',
          disconnectionType: 'TEMPORARY',
        },
      });
      expect(compRes.statusCode).toBe(200);

      // Verify service account is now SUSPENDED
      const [sa] = await db
        .select()
        .from(serviceAccounts)
        .where(eq(serviceAccounts.id, activeServiceAccountId))
        .limit(1);

      expect(sa.status).toBe('SUSPENDED');
    });

    it('RECONNECTION completion: restores SUSPENDED service account back to ACTIVE', async () => {
      // Create RECONNECTION order
      const orderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: activeServiceAccountId,
          orderType: 'RECONNECTION',
          description: 'Subscriber settled past due balance and reconnection fee',
          feeCentavos: 50000,
          assignedTechnicianId: techUserId,
        },
      });
      expect(orderRes.statusCode).toBe(201);
      const order = JSON.parse(orderRes.payload).data;

      // Complete RECONNECTION order
      const compRes = await server.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${order.id}/complete`,
        headers: { authorization: `Bearer ${techToken}` },
        payload: {
          resolutionNotes: 'Port re-enabled at FDH terminal #4. Signal verified.',
        },
      });
      expect(compRes.statusCode).toBe(200);

      // Verify service account is now ACTIVE
      const [sa] = await db
        .select()
        .from(serviceAccounts)
        .where(eq(serviceAccounts.id, activeServiceAccountId))
        .limit(1);

      expect(sa.status).toBe('ACTIVE');
    });

    it('DISCONNECTION completion with PERMANENT type: transitions service account to TERMINATED', async () => {
      // Create permanent DISCONNECTION order
      const orderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: activeServiceAccountId,
          orderType: 'DISCONNECTION',
          description: 'Voluntary permanent subscription cancellation',
          disconnectionType: 'PERMANENT',
          assignedTechnicianId: techUserId,
        },
      });
      expect(orderRes.statusCode).toBe(201);
      const order = JSON.parse(orderRes.payload).data;

      // Complete DISCONNECTION order
      const compRes = await server.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${order.id}/complete`,
        headers: { authorization: `Bearer ${techToken}` },
        payload: {
          resolutionNotes: 'Drop wire retrieved and modem pulled out. Account terminated.',
          disconnectionType: 'PERMANENT',
        },
      });
      expect(compRes.statusCode).toBe(200);

      // Verify service account is now TERMINATED
      const [sa] = await db
        .select()
        .from(serviceAccounts)
        .where(eq(serviceAccounts.id, activeServiceAccountId))
        .limit(1);

      expect(sa.status).toBe('TERMINATED');
    });

    it('RELOCATION completion: updates installation address and keeps service active', async () => {
      // 1. Create a new address for subscriber
      const [newAddr] = await db
        .insert(subscriberAddresses)
        .values({
          subscriberId: testSubscriberId,
          addressType: 'RELOCATION',
          streetAddress: 'New Relocation Residence, Purok 8',
          barangay: 'Sumpong',
          municipality: 'Malaybalay',
          province: 'Bukidnon',
          isPrimary: false,
        })
        .returning();

      // Reset account to ACTIVE for test
      await db
        .update(serviceAccounts)
        .set({ status: 'ACTIVE' })
        .where(eq(serviceAccounts.id, activeServiceAccountId));

      // 2. Create RELOCATION order
      const orderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: activeServiceAccountId,
          orderType: 'RELOCATION',
          description: 'Subscriber relocated to new house in Sumpong',
          targetAddressId: newAddr.id,
          feeCentavos: 100000,
          assignedTechnicianId: techUserId,
        },
      });
      expect(orderRes.statusCode).toBe(201);
      const order = JSON.parse(orderRes.payload).data;

      // 3. Complete RELOCATION order
      const compRes = await server.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${order.id}/complete`,
        headers: { authorization: `Bearer ${techToken}` },
        payload: {
          resolutionNotes: 'Installed new drop cable to new address. Signal optimal.',
          targetAddressId: newAddr.id,
        },
      });
      expect(compRes.statusCode).toBe(200);

      // Verify service account installationAddressId was updated
      const [sa] = await db
        .select()
        .from(serviceAccounts)
        .where(eq(serviceAccounts.id, activeServiceAccountId))
        .limit(1);

      expect(sa.installationAddressId).toBe(newAddr.id);
      expect(sa.status).toBe('ACTIVE');
    });
  });

  describe('5. Search, Filter & Audit Logging', () => {
    it('filters service orders by orderType, status, and search term', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/service-orders?orderType=INSTALLATION&status=COMPLETED',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.every((o: any) => o.orderType === 'INSTALLATION' && o.status === 'COMPLETED')).toBe(true);
    });

    it('verifies structured audit log entry created on service order complete', async () => {
      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'SERVICE_ORDER_COMPLETED'))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);

      expect(audit).toBeDefined();
      expect(audit.entityType).toBe('SERVICE_ORDER');
      expect(audit.actorName).toBe('Juan Dela Cruz (Technician)');
    });
  });

  describe('6. Concurrency, Robustness, and State Machine Guards', () => {
    it('prevents concurrent double-completion of the same service order with advisory locks', async () => {
      // Create a service order
      const orderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: activeServiceAccountId,
          orderType: 'REPAIR',
          description: 'Testing concurrency race on completion',
          assignedTechnicianId: techUserId,
        },
      });
      expect(orderRes.statusCode).toBe(201);
      const order = JSON.parse(orderRes.payload).data;

      // Launch 2 simultaneous completion requests
      const [res1, res2] = await Promise.all([
        server.inject({
          method: 'POST',
          url: `/api/v1/service-orders/${order.id}/complete`,
          headers: { authorization: `Bearer ${techToken}` },
          payload: { resolutionNotes: 'Concurrent resolution attempt 1' },
        }),
        server.inject({
          method: 'POST',
          url: `/api/v1/service-orders/${order.id}/complete`,
          headers: { authorization: `Bearer ${techToken}` },
          payload: { resolutionNotes: 'Concurrent resolution attempt 2' },
        }),
      ]);

      const statuses = [res1.statusCode, res2.statusCode].sort();
      expect(statuses).toEqual([200, 400]);

      const failedRes = res1.statusCode === 400 ? res1 : res2;
      const failedBody = JSON.parse(failedRes.payload);
      expect(failedBody.code).toBe('ORDER_ALREADY_COMPLETED');
    });

    it('prevents concurrent double-cancellation of the same service order with advisory locks', async () => {
      // Create a service order
      const orderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: activeServiceAccountId,
          orderType: 'REPAIR',
          description: 'Testing concurrency race on cancellation',
        },
      });
      expect(orderRes.statusCode).toBe(201);
      const order = JSON.parse(orderRes.payload).data;

      // Launch 2 simultaneous cancellation requests
      const [res1, res2] = await Promise.all([
        server.inject({
          method: 'POST',
          url: `/api/v1/service-orders/${order.id}/cancel`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { reason: 'Concurrent cancellation 1' },
        }),
        server.inject({
          method: 'POST',
          url: `/api/v1/service-orders/${order.id}/cancel`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { reason: 'Concurrent cancellation 2' },
        }),
      ]);

      const statuses = [res1.statusCode, res2.statusCode].sort();
      expect(statuses).toEqual([200, 400]);

      const failedRes = res1.statusCode === 400 ? res1 : res2;
      const failedBody = JSON.parse(failedRes.payload);
      expect(failedBody.code).toBe('ORDER_ALREADY_CANCELLED');
    });

    it('rejects transitioning to IN_PROGRESS when technician is not assigned', async () => {
      // Create unassigned service order
      const orderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: activeServiceAccountId,
          orderType: 'REPAIR',
          description: 'Unassigned order testing technician required guard',
        },
      });
      const order = JSON.parse(orderRes.payload).data;

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${order.id}/status`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          status: 'IN_PROGRESS',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('TECHNICIAN_REQUIRED');
    });

    it('rejects transitioning to COMPLETED via status endpoint', async () => {
      const orderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: activeServiceAccountId,
          orderType: 'REPAIR',
          description: 'Testing invalid status change bypass',
          assignedTechnicianId: techUserId,
        },
      });
      const order = JSON.parse(orderRes.payload).data;

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${order.id}/status`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          status: 'COMPLETED',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects completing RELOCATION order when target address is missing', async () => {
      const orderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: activeServiceAccountId,
          orderType: 'RELOCATION',
          description: 'Relocation without address on complete',
          assignedTechnicianId: techUserId,
        },
      });
      const order = JSON.parse(orderRes.payload).data;

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${order.id}/complete`,
        headers: { authorization: `Bearer ${techToken}` },
        payload: {
          resolutionNotes: 'Attempted complete without target address',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('TARGET_ADDRESS_REQUIRED');
    });

    it('rejects targetAddressId that belongs to another subscriber', async () => {
      // 1. Create a second subscriber with an address
      const otherSubRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Another',
          lastName: 'Subscriber',
          contactNumber: '09170001122',
          streetAddress: 'Other Street 123',
          barangay: 'Sumpong',
          municipality: 'Malaybalay',
        },
      });
      const otherSub = JSON.parse(otherSubRes.payload).data;

      const [otherAddress] = await db
        .select()
        .from(subscriberAddresses)
        .where(eq(subscriberAddresses.subscriberId, otherSub.id))
        .limit(1);

      // Attempt to create relocation order pointing to other subscriber's address
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: activeServiceAccountId,
          orderType: 'RELOCATION',
          description: 'Malicious relocation address hijacking attempt',
          targetAddressId: otherAddress.id,
        },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('TARGET_ADDRESS_NOT_FOUND');
    });
  });
});
