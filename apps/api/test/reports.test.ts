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

describe('Reports, Dunning Management & Analytics Engine (Phase 7 - Reports)', () => {
  let server: FastifyInstance;
  let adminToken: string;
  let cashierToken: string;
  let supervisorToken: string;
  let accountingToken: string;
  let techToken: string;

  let testPlanId: string;
  let testAreaId: string;

  // Account IDs for the 5 aging buckets
  let accCurrentId: string;
  let acc1to30Id: string;
  let acc31to60Id: string;
  let acc61to90Id: string;
  let acc90PlusId: string;

  let sub1Id: string;
  let sub2Id: string;

  // Helper date generators
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

    // Clean up test database
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

    // 3. Supervisor login
    const supvLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'collector_supv', password: 'Supervisor123!' },
    });
    supervisorToken = JSON.parse(supvLogin.payload).token;

    // 4. Accounting login
    const acctLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'accounting', password: 'Accounting123!' },
    });
    accountingToken = JSON.parse(acctLogin.payload).token;

    // 5. Tech login
    const techLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'technician', password: 'Tech123!' },
    });
    techToken = JSON.parse(techLogin.payload).token;

    // Fetch default collection area
    const [area] = await db.select().from(collectionAreas).limit(1);
    testAreaId = area.id;

    // Create Service Plan (?1,000.00 / mo = 100000 centavos)
    const planRes = await server.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Reports Test Plan',
        planCode: `RTP-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`,
        serviceType: 'INTERNET',
        monthlyFeeCentavos: 100000,
        installationFeeCentavos: 50000,
      },
    });
    testPlanId = JSON.parse(planRes.payload).data.id;

    // Create Subscriber 1 (Barangay Casisang)
    const sub1Res = await server.inject({
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
    sub1Id = JSON.parse(sub1Res.payload).data.id;

    // Create Subscriber 2 (Barangay Sumpong)
    const sub2Res = await server.inject({
      method: 'POST',
      url: '/api/v1/subscribers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        firstName: 'Maria',
        lastName: 'Santos',
        contactNumber: '09181234567',
        streetAddress: 'Purok 3',
        barangay: 'Sumpong',
        municipality: 'Malaybalay',
      },
    });
    sub2Id = JSON.parse(sub2Res.payload).data.id;

    // Helper to create service account and overdue invoice
    async function createAccountWithInvoice(
      subId: string,
      accountSuffix: string,
      dueDate: string,
      amountCentavos: number,
      status: string = 'ACTIVE'
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
      const saData = JSON.parse(saRes.payload).data;

      // Insert invoice directly with specific past due date
      const [inv] = await db
        .insert(invoices)
        .values({
          invoiceNumber: `INV-REP-${accountSuffix}`,
          serviceAccountId: saData.id,
          subscriberId: subId,
          billingPeriodStart: daysAgo(120),
          billingPeriodEnd: daysAgo(90),
          issueDate: daysAgo(90),
          dueDate: dueDate,
          subtotalCentavos: amountCentavos,
          vatCentavos: 0,
          totalDueCentavos: amountCentavos,
          allocatedCentavos: 0,
          remainingBalanceCentavos: amountCentavos,
          status: 'UNPAID',
        })
        .returning();

      return { saId: saData.id, invId: inv.id };
    }

    // 1. Account CURRENT (due in 10 days) -> ?1,000.00
    const acc1 = await createAccountWithInvoice(sub1Id, 'CURR', daysAhead(10), 100000);
    accCurrentId = acc1.saId;

    // 2. Account 1-30 Days Overdue (due 15 days ago) -> ?2,000.00
    const acc2 = await createAccountWithInvoice(sub1Id, '1TO30', daysAgo(15), 200000);
    acc1to30Id = acc2.saId;

    // 3. Account 31-60 Days Overdue (due 45 days ago) -> ?3,000.00
    const acc3 = await createAccountWithInvoice(sub1Id, '31TO60', daysAgo(45), 300000);
    acc31to60Id = acc3.saId;

    // 4. Account 61-90 Days Overdue (due 75 days ago) -> ?4,000.00
    const acc4 = await createAccountWithInvoice(sub2Id, '61TO90', daysAgo(75), 400000);
    acc61to90Id = acc4.saId;

    // 5. Account 90+ Days Overdue (due 105 days ago) -> ?5,000.00
    const acc5 = await createAccountWithInvoice(sub2Id, '90PLUS', daysAgo(105), 500000);
    acc90PlusId = acc5.saId;
  });

  afterAll(async () => {
    await server.close();
  });

  // ============================================================================
  // 1. Accounts Receivable (AR) Aging Report
  // ============================================================================
  describe('GET /api/v1/reports/ar-aging', () => {
    it('calculates delinquent balances categorized into the 5 standard buckets', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/ar-aging',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.summary).toBeDefined();

      const summary = json.data.summary;
      expect(summary.currentCentavos).toBe(100000);       // ?1,000
      expect(summary.days1to30Centavos).toBe(200000);     // ?2,000
      expect(summary.days31to60Centavos).toBe(300000);    // ?3,000
      expect(summary.days61to90Centavos).toBe(400000);    // ?4,000
      expect(summary.days90PlusCentavos).toBe(500000);    // ?5,000
      expect(summary.totalOverdueCentavos).toBe(1400000); // ?14,000
      expect(summary.totalReceivableCentavos).toBe(1500000); // ?15,000
      expect(summary.accountCount).toBe(5);
    });

    it('aggregates by subscriber (default)', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/ar-aging?groupBy=subscriber',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.groupBy).toBe('subscriber');
      expect(json.data.items).toHaveLength(2); // sub1 and sub2

      const sub1Item = json.data.items.find((i: any) => i.subscriberId === sub1Id);
      expect(sub1Item).toBeDefined();
      expect(sub1Item.currentCentavos).toBe(100000);
      expect(sub1Item.days1to30Centavos).toBe(200000);
      expect(sub1Item.days31to60Centavos).toBe(300000);
      expect(sub1Item.totalCentavos).toBe(600000);

      const sub2Item = json.data.items.find((i: any) => i.subscriberId === sub2Id);
      expect(sub2Item).toBeDefined();
      expect(sub2Item.days61to90Centavos).toBe(400000);
      expect(sub2Item.days90PlusCentavos).toBe(500000);
      expect(sub2Item.totalCentavos).toBe(900000);
    });

    it('aggregates by service_account', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/ar-aging?groupBy=service_account',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.groupBy).toBe('service_account');
      expect(json.data.items).toHaveLength(5);

      const currItem = json.data.items.find((i: any) => i.serviceAccountId === accCurrentId);
      expect(currItem).toBeDefined();
      expect(currItem.currentCentavos).toBe(100000);
      expect(currItem.days1to30Centavos).toBe(0);
    });

    it('aggregates by barangay', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/ar-aging?groupBy=barangay',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.groupBy).toBe('barangay');
      expect(json.data.items.length).toBeGreaterThanOrEqual(2);

      const casisang = json.data.items.find((i: any) => i.barangay === 'Casisang');
      expect(casisang).toBeDefined();
      expect(casisang.totalCentavos).toBe(600000);

      const sumpong = json.data.items.find((i: any) => i.barangay === 'Sumpong');
      expect(sumpong).toBeDefined();
      expect(sumpong.totalCentavos).toBe(900000);
    });

    it('aggregates by collection_area', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/ar-aging?groupBy=collection_area',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.groupBy).toBe('collection_area');
      expect(json.data.items.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by barangay correctly', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/ar-aging?barangay=Sumpong',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.items).toHaveLength(1);
      expect(json.data.summary.totalReceivableCentavos).toBe(900000);
    });

    it('exports AR aging report as CSV when format=csv', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/ar-aging?format=csv',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment; filename="ar-aging-report.csv"');
      expect(res.payload).toContain('Account Number');
      expect(res.payload).toContain('Total Balance (PHP)');
      expect(res.payload).toContain('Juan Dela Cruz');
    });

    it('supports groupBy=summary returning clean bucket totals with empty items array', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/ar-aging?groupBy=summary',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.groupBy).toBe('summary');
      expect(json.data.items).toEqual([]);
      expect(json.data.summary.totalReceivableCentavos).toBe(1500000);
      expect(json.data.summary.totalOverdueCentavos).toBe(1400000);
    });

    it('exports summary CSV when groupBy=summary and format=csv', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/ar-aging?groupBy=summary&format=csv',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.payload).toContain('Aging Bucket,Amount (PHP)');
      expect(res.payload).toContain('Current,1000.00');
      expect(res.payload).toContain('Total Overdue,14000.00');
      expect(res.payload).toContain('Total Receivable,15000.00');
    });

    it('excludes DRAFT invoices from AR aging calculation even if past due', async () => {
      // Create a DRAFT invoice with past due date
      await db.insert(invoices).values({
        invoiceNumber: 'INV-REP-DRAFT-PAST',
        serviceAccountId: accCurrentId,
        subscriberId: sub1Id,
        billingPeriodStart: daysAgo(100),
        billingPeriodEnd: daysAgo(70),
        issueDate: daysAgo(70),
        dueDate: daysAgo(60),
        subtotalCentavos: 999900,
        vatCentavos: 0,
        totalDueCentavos: 999900,
        allocatedCentavos: 0,
        remainingBalanceCentavos: 999900,
        status: 'DRAFT', // DRAFT status!
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/ar-aging',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      // Total receivable must remain 1,500,000 centavos, ignoring 999,900 DRAFT invoice
      expect(json.data.summary.totalReceivableCentavos).toBe(1500000);
    });

    it('is also accessible via alias /api/v1/receivables/aging', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/receivables/aging',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.summary.totalReceivableCentavos).toBe(1500000);
    });
  });

  // ============================================================================
  // 2. Disconnection Candidates List
  // ============================================================================
  describe('GET /api/v1/reports/disconnection-candidates', () => {
    it('queries active accounts exceeding 60+ days threshold by default', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/disconnection-candidates',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(2); // acc61to90 (75 days) and acc90Plus (105 days)

      const candidateIds = json.data.candidates.map((c: any) => c.serviceAccountId);
      expect(candidateIds).toContain(acc61to90Id);
      expect(candidateIds).toContain(acc90PlusId);
      expect(candidateIds).not.toContain(accCurrentId);
      expect(candidateIds).not.toContain(acc1to30Id);
      expect(candidateIds).not.toContain(acc31to60Id);
    });

    it('respects custom thresholdDays (e.g. 90+ days)', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/disconnection-candidates?thresholdDays=90',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.total).toBe(1);
      expect(json.data.candidates[0].serviceAccountId).toBe(acc90PlusId);
      expect(json.data.candidates[0].totalOverdueCentavos).toBe(500000);
    });

    it('filters disconnection candidates by minimum overdue balance', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/disconnection-candidates?thresholdDays=60&minOverdueCentavos=450000',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.total).toBe(1);
      expect(json.data.candidates[0].serviceAccountId).toBe(acc90PlusId);
    });

    it('exports disconnection candidates as CSV when format=csv', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/disconnection-candidates?format=csv',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('disconnection-candidates.csv');
      expect(res.payload).toContain('Service Account,Subscriber Account');
      expect(res.payload).toContain('Maria Santos');
    });

    it('is also accessible via alias /api/v1/receivables/suspension-candidates', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/receivables/suspension-candidates',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(2);
    });
  });

  // ============================================================================
  // 3. Daily Collection Summary Report
  // ============================================================================
  describe('GET /api/v1/reports/daily-collection', () => {
    beforeAll(async () => {
      // Post payments using different methods today
      await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: sub1Id,
          amountCentavos: 50000,
          paymentMethod: 'CASH',
        },
      });

      await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: sub1Id,
          amountCentavos: 50000,
          paymentMethod: 'GCASH',
          referenceNumber: '123456789012',
        },
      });

      await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: sub2Id,
          amountCentavos: 100000,
          paymentMethod: 'CHECK',
          referenceNumber: 'CHK-998877',
        },
      });
    });

    it('provides breakdown by cashier and payment method', async () => {
      const today = new Date().toISOString().split('T')[0];
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/daily-collection?date=${today}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);

      const data = json.data;
      expect(data.totalPayments).toBe(3);
      expect(data.totalCollectedCentavos).toBe(200000); // ?2,000.00
      expect(data.byMethod.CASH.totalCentavos).toBe(50000);
      expect(data.byMethod.GCASH.totalCentavos).toBe(50000);
      expect(data.byMethod.CHECK.totalCentavos).toBe(100000);

      expect(data.byCashier.length).toBeGreaterThanOrEqual(1);
      const cashierRow = data.byCashier.find((c: any) => c.cashierUsername === 'cashier');
      expect(cashierRow).toBeDefined();
      expect(cashierRow.totalCentavos).toBe(200000);
      expect(cashierRow.cashCentavos).toBe(50000);
      expect(cashierRow.gcashCentavos).toBe(50000);
      expect(cashierRow.checkCentavos).toBe(100000);
    });

    it('exports daily collection summary as CSV when format=csv', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/daily-collection?format=csv',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('daily-collection-summary.csv');
      expect(res.payload).toContain('Cashier Username');
      expect(res.payload).toContain('cashier');
      expect(res.payload).toContain('TOTAL');
    });
  });

  // ============================================================================
  // 4. Billing & Revenue Summary Report
  // ============================================================================
  describe('GET /api/v1/reports/billing-revenue', () => {
    it('summarizes total invoices billed, payments collected, and outstanding balance', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/billing-revenue?startDate=${daysAgo(100)}&endDate=${daysAhead(30)}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);

      const data = json.data;
      expect(data.totalInvoicesGenerated).toBe(5);
      expect(data.totalCentavosBilled).toBe(1500000); // ?15,000.00
      expect(data.totalPaymentsCollected).toBe(3);
      expect(data.totalCentavosCollected).toBe(200000); // ?2,000.00
      expect(data.overallBalanceOutstandingCentavos).toBeGreaterThan(0);
      expect(data.statusBreakdown.length).toBeGreaterThanOrEqual(1);
    });

    it('exports billing & revenue report as CSV when format=csv', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/billing-revenue?format=csv&startDate=${daysAgo(100)}&endDate=${daysAhead(30)}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('billing-revenue-summary.csv');
      expect(res.payload).toContain('Total Invoices Generated');
      expect(res.payload).toContain('Total Billed (PHP)');
      expect(res.payload).toContain('Total Collected (PHP)');
    });

    it('supports alias /monthly-revenue', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/reports/monthly-revenue?startDate=${daysAgo(100)}&endDate=${daysAhead(30)}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.totalInvoicesGenerated).toBe(5);
    });
  });

  // ============================================================================
  // 5. Delinquent Receivables Report (PRODUCT.md Section 14)
  // ============================================================================
  describe('GET /api/v1/receivables/delinquent & GET /api/v1/reports/delinquent', () => {
    it('returns overdue accounts list with calculated arrears, oldest unpaid invoice, and plan details', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/receivables/delinquent',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(4);
      expect(json.data.totalArrearsCentavos).toBe(1200000); // 1.4M overdue - 200k payments FIFO allocated = 1.2M
      expect(json.data.accounts.length).toBe(4);

      // Verify account details
      const first = json.data.accounts[0];
      expect(first.subscriber).toBeDefined();
      expect(first.serviceAccount).toBeDefined();
      expect(first.plan).toBeDefined();
      expect(first.oldestUnpaidInvoice).toBeDefined();
      expect(first.oldestUnpaidInvoice.invoiceNumber).toBeDefined();
      expect(first.oldestUnpaidInvoice.daysOverdue).toBeGreaterThan(0);
      expect(first.totalArrearsCentavos).toBeGreaterThan(0);
    });

    it('filters delinquent accounts by barangay', async () => {
      const resCasisang = await server.inject({
        method: 'GET',
        url: '/api/v1/receivables/delinquent?barangay=Casisang',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(resCasisang.statusCode).toBe(200);
      const jsonCasisang = JSON.parse(resCasisang.payload);
      expect(jsonCasisang.data.total).toBe(2);
      expect(jsonCasisang.data.accounts.every((a: any) => a.subscriber.fullName === 'Juan Dela Cruz')).toBe(true);

      const resSumpong = await server.inject({
        method: 'GET',
        url: '/api/v1/receivables/delinquent?barangay=Sumpong',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(resSumpong.statusCode).toBe(200);
      const jsonSumpong = JSON.parse(resSumpong.payload);
      expect(jsonSumpong.data.total).toBe(2);
      expect(jsonSumpong.data.accounts.every((a: any) => a.subscriber.fullName === 'Maria Santos')).toBe(true);
    });

    it('supports sorting by totalArrearsCentavos and daysOverdue', async () => {
      const resAsc = await server.inject({
        method: 'GET',
        url: '/api/v1/receivables/delinquent?sortBy=totalArrearsCentavos&sortOrder=asc',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(resAsc.statusCode).toBe(200);
      const jsonAsc = JSON.parse(resAsc.payload);
      expect(jsonAsc.data.accounts[0].totalArrearsCentavos).toBe(200000); // Lowest arrears first

      const resDesc = await server.inject({
        method: 'GET',
        url: '/api/v1/receivables/delinquent?sortBy=daysOverdue&sortOrder=desc',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(resDesc.statusCode).toBe(200);
      const jsonDesc = JSON.parse(resDesc.payload);
      expect(jsonDesc.data.accounts[0].daysOverdue).toBeGreaterThanOrEqual(100); // 105 days overdue
    });

    it('supports pagination with page and limit parameters', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/receivables/delinquent?page=1&limit=2',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.total).toBe(4);
      expect(json.data.page).toBe(1);
      expect(json.data.limit).toBe(2);
      expect(json.data.accounts.length).toBe(2);
    });

    it('exports delinquent accounts to CSV and sanitizes formula injection attempts', async () => {
      // Create a subscriber with formula injection in name
      const subFormulaRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: '=cmd|\' /C calc\'!A0',
          lastName: '+SUM(1,2)',
          contactNumber: '09170009999',
          streetAddress: '@DDE("cmd";"calc")',
          barangay: '-FormulaZone',
          municipality: 'Malaybalay',
        },
      });
      const subFormulaId = JSON.parse(subFormulaRes.payload).data.id;

      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: subFormulaId,
          servicePlanId: testPlanId,
          collectionAreaId: testAreaId,
          status: 'ACTIVE',
        },
      });
      const saId = JSON.parse(saRes.payload).data.id;

      await db.insert(invoices).values({
        invoiceNumber: 'INV-FORMULA-TEST',
        serviceAccountId: saId,
        subscriberId: subFormulaId,
        billingPeriodStart: daysAgo(50),
        billingPeriodEnd: daysAgo(20),
        issueDate: daysAgo(20),
        dueDate: daysAgo(10),
        subtotalCentavos: 100000,
        vatCentavos: 0,
        totalDueCentavos: 100000,
        allocatedCentavos: 0,
        remainingBalanceCentavos: 100000,
        status: 'UNPAID',
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/receivables/delinquent?format=csv',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('delinquent-accounts.csv');

      // The raw CSV text must contain prefixed single quotes before =, +, @, - to prevent execution
      expect(res.payload).toContain('\'=cmd|\' /C calc\'!A0');
      expect(res.payload).toContain('Subscriber Account,Subscriber Name');
    });

    it('is also accessible via alias /api/v1/reports/delinquent', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/delinquent',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.success).toBe(true);
      expect(json.data.total).toBeGreaterThanOrEqual(4);
    });
  });

  // ============================================================================
  // 6. RBAC Permissions Enforcement
  // ============================================================================
  describe('RBAC Authorization for Reports', () => {
    it('grants access to Accounting user for financial and operational reports', async () => {
      const resAging = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/ar-aging',
        headers: { authorization: `Bearer ${accountingToken}` },
      });
      expect(resAging.statusCode).toBe(200);

      const resDaily = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/daily-collection',
        headers: { authorization: `Bearer ${accountingToken}` },
      });
      expect(resDaily.statusCode).toBe(200);

      const resCandidates = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/disconnection-candidates',
        headers: { authorization: `Bearer ${accountingToken}` },
      });
      expect(resCandidates.statusCode).toBe(200);

      const resDelinquent = await server.inject({
        method: 'GET',
        url: '/api/v1/receivables/delinquent',
        headers: { authorization: `Bearer ${accountingToken}` },
      });
      expect(resDelinquent.statusCode).toBe(200);
    });

    it('grants Collection Supervisor access to operational reports but blocks financial reports', async () => {
      // Supervisor has reports.operational
      const resCandidates = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/disconnection-candidates',
        headers: { authorization: `Bearer ${supervisorToken}` },
      });
      expect(resCandidates.statusCode).toBe(200);

      // Supervisor has receivable.view_aging
      const resAging = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/ar-aging',
        headers: { authorization: `Bearer ${supervisorToken}` },
      });
      expect(resAging.statusCode).toBe(200);

      // Supervisor has receivable.view
      const resDelinquent = await server.inject({
        method: 'GET',
        url: '/api/v1/receivables/delinquent',
        headers: { authorization: `Bearer ${supervisorToken}` },
      });
      expect(resDelinquent.statusCode).toBe(200);

      // Supervisor does NOT have reports.financial
      const resDaily = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/daily-collection',
        headers: { authorization: `Bearer ${supervisorToken}` },
      });
      expect(resDaily.statusCode).toBe(403);
    });

    it('denies Cashier access to reports requiring reports.financial and receivable.view_aging', async () => {
      const resDaily = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/daily-collection',
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(resDaily.statusCode).toBe(403);

      const resAging = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/ar-aging',
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(resAging.statusCode).toBe(403);
    });

    it('denies Technician access to all financial reports with HTTP 403', async () => {
      const resRev = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/billing-revenue',
        headers: { authorization: `Bearer ${techToken}` },
      });
      expect(resRev.statusCode).toBe(403);

      const resDelinquent = await server.inject({
        method: 'GET',
        url: '/api/v1/receivables/delinquent',
        headers: { authorization: `Bearer ${techToken}` },
      });
      expect(resDelinquent.statusCode).toBe(403);
    });
  });

  // ============================================================================
  // 7. Structured Audit Logging
  // ============================================================================
  describe('Structured Audit Logging for Reports', () => {
    it('persists REPORT_EXPORTED audit entries on report generation', async () => {
      const logs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'REPORT_EXPORTED'))
        .orderBy(desc(auditLogs.createdAt));

      expect(logs.length).toBeGreaterThan(0);
      const entityIds = logs.map((l) => l.entityId);
      expect(entityIds).toContain('AR_AGING');
      expect(entityIds).toContain('DISCONNECTION_CANDIDATES');
      expect(entityIds).toContain('DAILY_COLLECTION');
      expect(entityIds).toContain('BILLING_REVENUE');
      expect(entityIds).toContain('DELINQUENT_RECEIVABLES');
    });
  });
});
