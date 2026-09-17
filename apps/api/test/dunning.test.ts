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
  invoices,
  invoiceItems,
  payments,
  paymentAllocations,
  receipts,
  paymentReversals,
  gcashTransactions,
  subscriberLedger,
  serviceOrders,
  collectionAreas,
  dunningNotices,
  auditLogs,
} from '../src/db/schema.js';
import { eq, and, desc } from 'drizzle-orm';

describe('Dunning Management Module (Phase 7 - Dunning)', () => {
  let server: FastifyInstance;
  let adminToken: string;
  let cashierToken: string;
  let supervisorToken: string;
  let accountingToken: string;
  let techToken: string;

  let testPlanId: string;
  let testAreaId: string;

  let sub1Id: string;
  let sub2Id: string;
  let sa1Id: string; // 45 days overdue (Level 1: 30-59)
  let sa2Id: string; // 75 days overdue (Level 2: 60-89)
  let sa3Id: string; // 100 days overdue (Level 3: 90+)
  let saCurrentId: string; // not overdue

  function daysAgo(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().split('T')[0];
  }

  function daysAhead(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
  }

  beforeAll(async () => {
    await seedDatabase();

    // Clean up test data
    await db.delete(dunningNotices);
    await db.delete(serviceOrders);
    await db.delete(paymentReversals);
    await db.delete(receipts);
    await db.delete(paymentAllocations);
    await db.delete(payments);
    await db.delete(gcashTransactions);
    await db.delete(invoiceItems);
    await db.delete(invoices);
    await db.delete(subscriberLedger);
    await db.delete(serviceAccounts);
    await db.delete(subscriberAddresses);
    await db.delete(subscribers);
    await db.delete(auditLogs);

    server = buildServer();
    await server.ready();

    // Logins
    const adminLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'Admin123!' },
    });
    adminToken = JSON.parse(adminLogin.payload).token;

    const cashierLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'cashier', password: 'Cashier123!' },
    });
    cashierToken = JSON.parse(cashierLogin.payload).token;

    const supvLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'collector_supv', password: 'Supervisor123!' },
    });
    supervisorToken = JSON.parse(supvLogin.payload).token;

    const acctLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'accounting', password: 'Accounting123!' },
    });
    accountingToken = JSON.parse(acctLogin.payload).token;

    const techLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'technician', password: 'Tech123!' },
    });
    techToken = JSON.parse(techLogin.payload).token;

    const [area] = await db.select().from(collectionAreas).limit(1);
    testAreaId = area.id;

    // Service plan
    const planRes = await server.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Dunning Plan 50 Mbps',
        serviceType: 'INTERNET',
        monthlyFeeCentavos: 129900,
      },
    });
    testPlanId = JSON.parse(planRes.payload).data.id;

    // Subscriber 1
    const sub1Res = await server.inject({
      method: 'POST',
      url: '/api/v1/subscribers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        firstName: 'Pedro',
        lastName: 'Penduko',
        contactNumber: '09172223344',
        streetAddress: 'Zone 1',
        barangay: 'Casisang',
        municipality: 'Malaybalay',
      },
    });
    sub1Id = JSON.parse(sub1Res.payload).data.id;

    // Subscriber 2
    const sub2Res = await server.inject({
      method: 'POST',
      url: '/api/v1/subscribers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        firstName: 'Gabriela',
        lastName: 'Silang',
        contactNumber: '09173334455',
        streetAddress: 'Zone 2',
        barangay: 'Sumpong',
        municipality: 'Malaybalay',
      },
    });
    sub2Id = JSON.parse(sub2Res.payload).data.id;

    // Helper to create active account + invoice
    async function setupAccountWithInvoice(
      subId: string,
      code: string,
      due: string,
      amountCentavos: number
    ) {
      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: subId,
          servicePlanId: testPlanId,
          collectionAreaId: testAreaId,
          status: 'ACTIVE',
        },
      });
      const sa = JSON.parse(saRes.payload).data;

      await db.insert(invoices).values({
        invoiceNumber: `INV-DUN-${code}`,
        serviceAccountId: sa.id,
        subscriberId: subId,
        billingPeriodStart: daysAgo(120),
        billingPeriodEnd: daysAgo(90),
        issueDate: daysAgo(90),
        dueDate: due,
        subtotalCentavos: amountCentavos,
        totalDueCentavos: amountCentavos,
        allocatedCentavos: 0,
        remainingBalanceCentavos: amountCentavos,
        status: 'UNPAID',
      });

      return sa.id;
    }

    // 1. sa1: 45 days overdue -> ?1,299.00
    sa1Id = await setupAccountWithInvoice(sub1Id, '45D', daysAgo(45), 129900);

    // 2. sa2: 75 days overdue -> ?2,598.00
    sa2Id = await setupAccountWithInvoice(sub2Id, '75D', daysAgo(75), 259800);

    // 3. sa3: 100 days overdue -> ?3,897.00
    sa3Id = await setupAccountWithInvoice(sub2Id, '100D', daysAgo(100), 389700);

    // 4. saCurrent: not overdue (due 15 days in future)
    saCurrentId = await setupAccountWithInvoice(sub1Id, 'CURR', daysAhead(15), 129900);
  });

  afterAll(async () => {
    await server.close();
  });

  // ============================================================================
  // 1. Dunning Notices Generation
  // ============================================================================
  describe('POST /api/v1/dunning/notices/generate', () => {
    it('generates dunning notices for all overdue accounts exceeding minDaysOverdue', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/dunning/notices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          minDaysOverdue: 30,
          notes: 'Batch month-end dunning notice run',
        },
      });

      expect(res.statusCode).toBe(201);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.count).toBe(3); // sa1 (45d), sa2 (75d), sa3 (100d)
      expect(json.data.skippedCount).toBe(0);

      const notices = json.data.generated;
      expect(notices).toHaveLength(3);

      // Verify notice numbers start with DUN-YYYYMM-
      for (const n of notices) {
        expect(n.noticeNumber).toMatch(/^DUN-\d{6}-\d{4}$/);
        expect(n.status).toBe('ISSUED');
      }

      // Check auto notice levels
      const n1 = notices.find((n: any) => n.serviceAccountId === sa1Id);
      expect(n1).toBeDefined();
      expect(n1.noticeLevel).toBe(1); // 45 days -> Level 1
      expect(n1.overdueBalanceCentavos).toBe(129900);

      const n2 = notices.find((n: any) => n.serviceAccountId === sa2Id);
      expect(n2).toBeDefined();
      expect(n2.noticeLevel).toBe(2); // 75 days -> Level 2
      expect(n2.overdueBalanceCentavos).toBe(259800);

      const n3 = notices.find((n: any) => n.serviceAccountId === sa3Id);
      expect(n3).toBeDefined();
      expect(n3.noticeLevel).toBe(3); // 100 days -> Level 3
      expect(n3.overdueBalanceCentavos).toBe(389700);
    });

    it('prevents duplicate active notices: skips accounts that already have an active notice at the same level', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/dunning/notices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { minDaysOverdue: 30 },
      });

      expect(res.statusCode).toBe(201);
      const json = JSON.parse(res.payload);
      expect(json.data.count).toBe(0); // None generated
      expect(json.data.skippedCount).toBe(3); // All 3 skipped
    });

    it('supports alias POST /api/v1/dunning/generate', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/dunning/generate',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: { minDaysOverdue: 30 },
      });

      expect(res.statusCode).toBe(201);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.skippedCount).toBe(3);
    });
  });

  // ============================================================================
  // 2. Querying Dunning Notices
  // ============================================================================
  describe('GET /api/v1/dunning/notices', () => {
    it('returns paginated list of notices with metadata and linked details', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/dunning/notices',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.meta.total).toBe(3);
      expect(json.data).toHaveLength(3);

      const notice = json.data[0];
      expect(notice.noticeNumber).toBeDefined();
      expect(notice.serviceAccount).toBeDefined();
      expect(notice.serviceAccount.serviceAccountNumber).toBeDefined();
      expect(notice.subscriber).toBeDefined();
      expect(notice.subscriber.firstName).toBeDefined();
    });

    it('filters notices by status', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/dunning/notices?status=ISSUED',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data).toHaveLength(3);
    });

    it('filters notices by noticeLevel', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/dunning/notices?noticeLevel=2',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].serviceAccountId).toBe(sa2Id);
    });

    it('fetches single dunning notice by ID', async () => {
      const listRes = await server.inject({
        method: 'GET',
        url: '/api/v1/dunning/notices',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const firstNotice = JSON.parse(listRes.payload).data[0];

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/dunning/notices/${firstNotice.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.id).toBe(firstNotice.id);
      expect(json.data.noticeNumber).toBe(firstNotice.noticeNumber);
    });

    it('returns 404 for non-existent notice ID', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/dunning/notices/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.payload).code).toBe('NOT_FOUND');
    });
  });

  // ============================================================================
  // 3. Notice Lifecycle Transitions (DELIVER, RESOLVE, CANCEL)
  // ============================================================================
  describe('Dunning Lifecycle State Machine', () => {
    let testNoticeId: string;
    let cancelNoticeId: string;

    beforeAll(async () => {
      const listRes = await server.inject({
        method: 'GET',
        url: '/api/v1/dunning/notices',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const data = JSON.parse(listRes.payload).data;
      testNoticeId = data[0].id;
      cancelNoticeId = data[1].id;
    });

    it('transitions ISSUED -> DELIVERED when delivery is recorded', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/dunning/notices/${testNoticeId}/deliver`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          deliveryNotes: 'Delivered in person to subscriber residence, signed by spouse',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('DELIVERED');
      expect(json.data.deliveredAt).toBeDefined();
      expect(json.data.deliveryNotes).toContain('signed by spouse');
    });

    it('transitions DELIVERED -> RESOLVED when payment or arrangement is made', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/dunning/notices/${testNoticeId}/resolve`,
        headers: { authorization: `Bearer ${accountingToken}` },
        payload: {
          resolvedReason: 'Delinquent balance settled via GCash verification',
          notes: 'Full payment verified on GCash Ref 123456789012',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('RESOLVED');
      expect(json.data.resolvedAt).toBeDefined();
      expect(json.data.resolvedReason).toContain('settled via GCash');
    });

    it('rejects delivering a notice that is already RESOLVED with HTTP 400', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/dunning/notices/${testNoticeId}/deliver`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { deliveryNotes: 'Attempt delivery' },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('transitions ISSUED -> CANCELLED when disputed or voided', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/dunning/notices/${cancelNoticeId}/cancel`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: 'Billing error: Invoice was generated with incorrect rate and credited',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('CANCELLED');
      expect(json.data.notes).toContain('Billing error');
    });

    it('rejects cancelling an already RESOLVED notice with HTTP 400', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/dunning/notices/${testNoticeId}/cancel`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { reason: 'Try cancel resolved' },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  // ============================================================================
  // 4. Integration with Disconnection Queue & Service Orders
  // ============================================================================
  describe('Integration: Dunning to Disconnection Service Orders', () => {
    let activeNoticeId: string;

    beforeAll(async () => {
      // Find notice that is still ISSUED (sa3: 100 days overdue)
      const listRes = await server.inject({
        method: 'GET',
        url: '/api/v1/dunning/notices?status=ISSUED',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      activeNoticeId = JSON.parse(listRes.payload).data[0].id;
    });

    it('creates a DISCONNECTION service order directly from an active dunning notice', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/dunning/notices/${activeNoticeId}/create-disconnection-order`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(201);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);

      const order = json.data;
      expect(order.orderNumber).toMatch(/^SO-\d{6}-\d{4}$/);
      expect(order.orderType).toBe('DISCONNECTION');
      expect(order.status).toBe('PENDING');
      expect(order.priority).toBe('HIGH');
      expect(order.disconnectionType).toBe('TEMPORARY');
      expect(order.description).toContain('Disconnection order generated from Dunning Notice');
    });

    it('rejects duplicate active disconnection orders for the same account with HTTP 409', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/dunning/notices/${activeNoticeId}/create-disconnection-order`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.payload).code).toBe('ACTIVE_ORDER_EXISTS');
    });

    it('integrates dunning status into reports/disconnection-candidates', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/disconnection-candidates',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      const candidates = json.data.candidates;

      // Candidate accounts should reflect dunning notice presence
      const candidateWithDunning = candidates.find((c: any) => c.hasDunningNotice === true);
      expect(candidateWithDunning).toBeDefined();
      expect(candidateWithDunning.latestDunningNoticeNumber).toMatch(/^DUN-/);
      expect(candidateWithDunning.latestDunningNoticeStatus).toBeDefined();
    });
  });

  // ============================================================================
  // 5. RBAC Authorization for Dunning
  // ============================================================================
  describe('RBAC Authorization for Dunning Module', () => {
    it('grants access to Collection Supervisor for dunning actions', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/dunning/notices',
        headers: { authorization: `Bearer ${supervisorToken}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('grants access to Accounting user for dunning actions', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/dunning/notices',
        headers: { authorization: `Bearer ${accountingToken}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('denies Cashier access to dunning actions with HTTP 403 Forbidden', async () => {
      const resGen = await server.inject({
        method: 'POST',
        url: '/api/v1/dunning/notices/generate',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: { minDaysOverdue: 30 },
      });
      expect(resGen.statusCode).toBe(403);

      const resList = await server.inject({
        method: 'GET',
        url: '/api/v1/dunning/notices',
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(resList.statusCode).toBe(403);
    });

    it('denies Technician access to dunning actions with HTTP 403 Forbidden', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/dunning/notices',
        headers: { authorization: `Bearer ${techToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ============================================================================
  // 6. Structured Audit Logging
  // ============================================================================
  describe('Structured Audit Logging for Dunning', () => {
    it('persists structured audit log entries for all dunning lifecycle events', async () => {
      const logs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityType, 'DUNNING_NOTICE'))
        .orderBy(desc(auditLogs.createdAt));

      expect(logs.length).toBeGreaterThan(0);
      const actions = logs.map((l) => l.action);
      expect(actions).toContain('DUNNING_NOTICE_GENERATED');
      expect(actions).toContain('DUNNING_NOTICE_DELIVERED');
      expect(actions).toContain('DUNNING_NOTICE_RESOLVED');
      expect(actions).toContain('DUNNING_NOTICE_CANCELLED');

      // Check service order generated from dunning audit entry
      const soLogs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'DISCONNECTION_ORDER_FROM_DUNNING'));
      expect(soLogs.length).toBe(1);
      expect(soLogs[0].entityType).toBe('SERVICE_ORDER');
    });
  });
});
