import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { pool, db } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import {
  invoices,
  invoiceItems,
  subscriberAddresses,
  subscribers,
  serviceAccounts,
  servicePlans,
  subscriberLedger,
  paymentAllocations,
  payments,
  receipts,
  paymentReversals,
  gcashTransactions,
  users,
  auditLogs,
} from '../src/db/schema.js';
import { eq, and } from 'drizzle-orm';

describe('Billing & Invoicing Engine (Phase 4)', () => {
  let server: FastifyInstance;
  let adminToken: string;
  let cashierToken: string;
  let viewerToken: string;

  let testSubscriberId: string;
  let testPlanId: string;
  let testPlanRate: number;
  let testServiceAccountId: string;

  beforeAll(async () => {
    await seedDatabase();

    // Clean up test invoices, allocations, items, and ledger from previous test runs
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

    // 1. Log in Admin
    const adminLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'Admin123!' },
    });
    adminToken = JSON.parse(adminLogin.payload).token;

    // 2. Log in Cashier
    const cashierLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'cashier', password: 'Cashier123!' },
    });
    cashierToken = JSON.parse(cashierLogin.payload).token;

    // 3. Issue Token for Viewer role
    viewerToken = server.jwt.sign({
      id: '00000000-0000-0000-0000-000000000099',
      username: 'viewer',
      fullName: 'Trainee Viewer',
      roles: ['ROLE_VIEWER'],
      permissions: ['billing.view', 'subscriber.view'],
    });

    // 4. Create base plan (₱999.00 / mo)
    const planRes = await server.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Fiber Starter 50 Mbps',
        serviceType: 'INTERNET',
        monthlyFeeCentavos: 99900,
      },
    });
    const planData = JSON.parse(planRes.payload).data;
    testPlanId = planData.id;
    testPlanRate = planData.monthlyFeeCentavos;

    // 5. Create base subscriber
    const subRes = await server.inject({
      method: 'POST',
      url: '/api/v1/subscribers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        firstName: 'Juan',
        lastName: 'Dela Cruz',
        contactNumber: '09181112233',
        streetAddress: 'Sayre Highway',
        barangay: 'Casisang',
        municipality: 'Malaybalay',
      },
    });
    testSubscriberId = JSON.parse(subRes.payload).data.id;

    // 6. Create base service account
    const saRes = await server.inject({
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
    testServiceAccountId = JSON.parse(saRes.payload).data.id;
  });

  afterAll(async () => {
    await server.close();
    await pool.end();
  });

  describe('1. RBAC & Authentication', () => {
    it('rejects unauthenticated requests to invoices endpoints with HTTP 401', async () => {
      const getRes = await server.inject({ method: 'GET', url: '/api/v1/invoices' });
      expect(getRes.statusCode).toBe(401);

      const postRes = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        payload: {
          billingPeriodStart: '2026-09-01',
          billingPeriodEnd: '2026-09-30',
        },
      });
      expect(postRes.statusCode).toBe(401);

      const voidRes = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/00000000-0000-0000-0000-000000000000/void',
        payload: { reason: 'Test void' },
      });
      expect(voidRes.statusCode).toBe(401);
    });

    it('denies Cashier from generating billing with HTTP 403', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          billingPeriodStart: '2026-09-01',
          billingPeriodEnd: '2026-09-30',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('denies Cashier from voiding an invoice with HTTP 403', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/00000000-0000-0000-0000-000000000000/void',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: { reason: 'Void invoice attempt' },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('allows Cashier to view invoices (billing.view grants invoices.read)', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/invoices',
        headers: { authorization: `Bearer ${cashierToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('allows Viewer to view invoices with HTTP 200', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/invoices',
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('2. Single Invoice Generation & Sequential Numbering', () => {
    let generatedInvoiceId: string;
    let generatedInvoiceNumber: string;

    it('generates an invoice for an active service account with sequential format INV-YYYYMM-XXXX', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: testServiceAccountId,
          billingPeriodStart: '2026-09-01',
          billingPeriodEnd: '2026-09-30',
          issueDate: '2026-09-01',
          dueDate: '2026-09-20',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data).toBeDefined();

      const inv = body.data;
      generatedInvoiceId = inv.id;
      generatedInvoiceNumber = inv.invoiceNumber;

      // Sequential numbering format check
      expect(inv.invoiceNumber).toMatch(/^INV-202609-\d{4}$/);
      expect(inv.serviceAccountId).toBe(testServiceAccountId);
      expect(inv.subscriberId).toBe(testSubscriberId);
      expect(inv.totalDueCentavos).toBe(99900);
      expect(inv.remainingBalanceCentavos).toBe(99900);
      expect(inv.allocatedCentavos).toBe(0);
      expect(inv.status).toBe('UNPAID');

      // Check line item was created
      expect(inv.lineItems).toHaveLength(1);
      expect(inv.lineItems[0].itemType).toBe('PLAN_FEE');
      expect(inv.lineItems[0].amountCentavos).toBe(99900);

      // Verify subscriber ledger debit entry
      const ledgerRows = await db
        .select()
        .from(subscriberLedger)
        .where(eq(subscriberLedger.subscriberId, testSubscriberId));

      const invDebit = ledgerRows.find((l) => l.referenceId === inv.invoiceNumber);
      expect(invDebit).toBeDefined();
      expect(invDebit?.debitCentavos).toBe(99900);
      expect(invDebit?.creditCentavos).toBe(0);
      expect(invDebit?.entryType).toBe('INVOICE');

      // Verify audit log
      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, inv.id));

      expect(auditRows.length).toBeGreaterThan(0);
      expect(auditRows[0].action).toBe('INVOICE_GENERATED');
    });

    it('supports alias endpoint /api/v1/billing/generate', async () => {
      // Create a second active service account
      const sa2Res = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: testSubscriberId,
          servicePlanId: testPlanId,
          status: 'ACTIVE',
        },
      });
      const sa2 = JSON.parse(sa2Res.payload).data;

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: sa2.id,
          billingPeriodStart: '2026-09-01',
          billingPeriodEnd: '2026-09-30',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data.invoiceNumber).toMatch(/^INV-202609-\d{4}$/);
    });
  });

  describe('3. Proration Calculation for Mid-Cycle Activation', () => {
    it('calculates prorated plan fee when service account was activated during the billing period', async () => {
      // Create service account activated on Sept 16, 2026 (15 active days out of 30)
      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: testSubscriberId,
          servicePlanId: testPlanId,
          status: 'ACTIVE',
          activationDate: '2026-09-16',
        },
      });
      const proratedSa = JSON.parse(saRes.payload).data;

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: proratedSa.id,
          billingPeriodStart: '2026-09-01',
          billingPeriodEnd: '2026-09-30',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      const inv = body.data;

      // 99900 * 15 / 30 = 49950 centavos (₱499.50)
      expect(inv.totalDueCentavos).toBe(49950);
      expect(inv.remainingBalanceCentavos).toBe(49950);
      expect(inv.lineItems[0].amountCentavos).toBe(49950);
      expect(inv.lineItems[0].description).toContain('Prorated 15/30 days');
    });
  });

  describe('4. Custom Line Items & Discounts', () => {
    it('accurately incorporates installation, device fees, and discounts', async () => {
      const saRes = await server.inject({
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
      const sa = JSON.parse(saRes.payload).data;

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: sa.id,
          billingPeriodStart: '2026-09-01',
          billingPeriodEnd: '2026-09-30',
          customLineItems: [
            {
              itemType: 'INSTALLATION',
              description: 'Standard Fiber Drop Cable Installation',
              amountCentavos: 100000, // ₱1,000.00
              quantity: 1,
            },
            {
              itemType: 'DEVICE',
              description: 'Dual-Band WiFi 6 ONU Router',
              amountCentavos: 150000, // ₱1,500.00
              quantity: 1,
            },
            {
              itemType: 'DISCOUNT',
              description: 'Promotional Welcome Rebate',
              amountCentavos: 20000, // ₱200.00 discount
              quantity: 1,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      const inv = body.data;

      // Subtotal = 99900 (plan) + 100000 (installation) + 150000 (device) = 349900
      // Discount = 20000
      // Total due = 349900 - 20000 = 329900 centavos (₱3,299.00)
      expect(inv.subtotalCentavos).toBe(349900);
      expect(inv.totalDueCentavos).toBe(329900);
      expect(inv.remainingBalanceCentavos).toBe(329900);
      expect(inv.lineItems).toHaveLength(4);
    });
  });

  describe('5. Duplicate Billing Prevention (Acceptance Test AT-11)', () => {
    it('rejects duplicate single invoice generation for the same period with HTTP 409 Conflict', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: testServiceAccountId,
          billingPeriodStart: '2026-09-01',
          billingPeriodEnd: '2026-09-30',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('DUPLICATE_BILLING_PERIOD');
      expect(body.message).toContain('already exists');
    });

    it('verifies bulk batch generation idempotency: running twice generates 0 duplicates (AT-11)', async () => {
      const periodStart = '2026-11-01';
      const periodEnd = '2026-11-30';

      // 1st Batch Run
      const firstRunRes = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          billingPeriodStart: periodStart,
          billingPeriodEnd: periodEnd,
        },
      });

      expect(firstRunRes.statusCode).toBe(201);
      const firstBody = JSON.parse(firstRunRes.payload);
      const generatedCount = firstBody.data.generatedCount;
      expect(generatedCount).toBeGreaterThan(0);
      expect(firstBody.data.skippedCount).toBe(0);

      // Verify audit log for batch run
      const batchAudits = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'INVOICE_BATCH_GENERATED'));
      expect(batchAudits.length).toBeGreaterThan(0);

      // 2nd Batch Run for the identical period (Acceptance Test AT-11)
      const secondRunRes = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          billingPeriodStart: periodStart,
          billingPeriodEnd: periodEnd,
        },
      });

      expect(secondRunRes.statusCode).toBe(201);
      const secondBody = JSON.parse(secondRunRes.payload);

      // Must produce ZERO duplicates and skip all previously billed accounts
      expect(secondBody.data.generatedCount).toBe(0);
      expect(secondBody.data.skippedCount).toBe(generatedCount);
      expect(secondBody.data.invoices).toHaveLength(0);
    });
  });

  describe('6. Automatic Advance Credit Deduction', () => {
    it('fully offsets invoice when advance credit exceeds total due, setting status to PAID', async () => {
      // Create subscriber with ₱1,500.00 advance credit (150,000 centavos)
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Maria',
          lastName: 'Santos',
          contactNumber: '09192223344',
          streetAddress: 'Fortich Street',
          barangay: 'Barangay 1',
        },
      });
      const maria = JSON.parse(subRes.payload).data;

      // Seed advance credit directly into subscriber balance
      await db
        .update(subscribers)
        .set({ advanceCreditCentavos: 150000 })
        .where(eq(subscribers.id, maria.id));

      // Create active service account (₱999.00 / mo)
      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: maria.id,
          servicePlanId: testPlanId,
          status: 'ACTIVE',
          activationDate: '2026-08-01',
        },
      });
      const mariaSa = JSON.parse(saRes.payload).data;

      // Generate invoice
      const invRes = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: mariaSa.id,
          billingPeriodStart: '2026-12-01',
          billingPeriodEnd: '2026-12-31',
        },
      });

      expect(invRes.statusCode).toBe(201);
      const inv = JSON.parse(invRes.payload).data;

      expect(inv.totalDueCentavos).toBe(99900);
      expect(inv.allocatedCentavos).toBe(99900);
      expect(inv.remainingBalanceCentavos).toBe(0);
      expect(inv.status).toBe('PAID');

      // Verify subscriber advance credit was deducted: 150,000 - 99,900 = 50,100 centavos
      const [updatedSubscriber] = await db
        .select()
        .from(subscribers)
        .where(eq(subscribers.id, maria.id));
      expect(updatedSubscriber.advanceCreditCentavos).toBe(50100);

      // Verify ledger entries for Maria
      const mariaLedger = await db
        .select()
        .from(subscriberLedger)
        .where(eq(subscriberLedger.subscriberId, maria.id));

      const invDebit = mariaLedger.find((l) => l.entryType === 'INVOICE');
      const creditApplied = mariaLedger.find((l) => l.entryType === 'ADVANCE_CREDIT');

      expect(invDebit).toBeDefined();
      expect(invDebit?.debitCentavos).toBe(99900);
      expect(creditApplied).toBeDefined();
      expect(creditApplied?.creditCentavos).toBe(99900);
    });

    it('partially offsets invoice when advance credit is less than total due, setting status to PARTIALLY_PAID', async () => {
      // Create subscriber with ₱400.00 advance credit (40,000 centavos)
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Pedro',
          lastName: 'Penduko',
          contactNumber: '09193334455',
          streetAddress: 'Purok 4',
          barangay: 'Sumpong',
        },
      });
      const pedro = JSON.parse(subRes.payload).data;

      await db
        .update(subscribers)
        .set({ advanceCreditCentavos: 40000 })
        .where(eq(subscribers.id, pedro.id));

      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: pedro.id,
          servicePlanId: testPlanId,
          status: 'ACTIVE',
          activationDate: '2026-08-01',
        },
      });
      const pedroSa = JSON.parse(saRes.payload).data;

      const invRes = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: pedroSa.id,
          billingPeriodStart: '2026-12-01',
          billingPeriodEnd: '2026-12-31',
        },
      });

      expect(invRes.statusCode).toBe(201);
      const inv = JSON.parse(invRes.payload).data;

      expect(inv.totalDueCentavos).toBe(99900);
      expect(inv.allocatedCentavos).toBe(40000);
      expect(inv.remainingBalanceCentavos).toBe(59900);
      expect(inv.status).toBe('PARTIALLY_PAID');

      // Subscriber advance credit reduced to 0
      const [updatedPedro] = await db
        .select()
        .from(subscribers)
        .where(eq(subscribers.id, pedro.id));
      expect(updatedPedro.advanceCreditCentavos).toBe(0);
    });
  });

  describe('7. Invoices List, Filters & Pagination', () => {
    it('supports pagination with limit and page parameters', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/invoices?page=1&limit=2',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toHaveLength(2);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBe(2);
      expect(body.pagination.total).toBeGreaterThanOrEqual(2);
    });

    it('filters invoices by status (PAID and UNPAID)', async () => {
      const paidRes = await server.inject({
        method: 'GET',
        url: '/api/v1/invoices?status=PAID',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(paidRes.statusCode).toBe(200);
      const paidBody = JSON.parse(paidRes.payload);
      for (const inv of paidBody.data) {
        expect(inv.status).toBe('PAID');
      }

      const unpaidRes = await server.inject({
        method: 'GET',
        url: '/api/v1/invoices?status=UNPAID',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(unpaidRes.statusCode).toBe(200);
      const unpaidBody = JSON.parse(unpaidRes.payload);
      for (const inv of unpaidBody.data) {
        expect(inv.status).toBe('UNPAID');
      }
    });

    it('filters invoices by subscriber ID', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/invoices?subscriberId=${testSubscriberId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      for (const inv of body.data) {
        expect(inv.subscriberId).toBe(testSubscriberId);
      }
    });

    it('filters invoices by search query', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/invoices?search=Cruz',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0].subscriber.lastName).toBe('Dela Cruz');
    });
  });

  describe('8. Invoice Detail Endpoint', () => {
    it('retrieves detailed invoice with relations, line items, and allocations', async () => {
      // Find an existing invoice
      const listRes = await server.inject({
        method: 'GET',
        url: '/api/v1/invoices?limit=1',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const firstInvoice = JSON.parse(listRes.payload).data[0];

      // Query detail by ID
      const detailRes = await server.inject({
        method: 'GET',
        url: `/api/v1/invoices/${firstInvoice.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(detailRes.statusCode).toBe(200);
      const detail = JSON.parse(detailRes.payload).data;

      expect(detail.id).toBe(firstInvoice.id);
      expect(detail.invoiceNumber).toBe(firstInvoice.invoiceNumber);
      expect(detail.subscriber).toBeDefined();
      expect(detail.serviceAccount).toBeDefined();
      expect(detail.lineItems).toBeDefined();
      expect(Array.isArray(detail.lineItems)).toBe(true);
      expect(detail.paymentAllocations).toBeDefined();
    });

    it('returns HTTP 404 for nonexistent invoice ID', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/invoices/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('INVOICE_NOT_FOUND');
    });
  });

  describe('9. Invoice Voiding Workflow', () => {
    let unpaidInvoiceId: string;
    let unpaidInvoiceNumber: string;
    let paidInvoiceId: string;

    beforeAll(async () => {
      // Find an unpaid invoice
      const unpaidList = await server.inject({
        method: 'GET',
        url: '/api/v1/invoices?status=UNPAID&limit=1',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const unpaidInv = JSON.parse(unpaidList.payload).data[0];
      unpaidInvoiceId = unpaidInv.id;
      unpaidInvoiceNumber = unpaidInv.invoiceNumber;

      // Find a paid invoice
      const paidList = await server.inject({
        method: 'GET',
        url: '/api/v1/invoices?status=PAID&limit=1',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const paidInv = JSON.parse(paidList.payload).data[0];
      paidInvoiceId = paidInv.id;
    });

    it('successfully voids an unpaid invoice with a valid reason and records ledger reversal', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/invoices/${unpaidInvoiceId}/void`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: 'Customer requested plan downgrade before billing finalized',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.status).toBe('VOID');

      // Verify ledger reversal entry
      const ledgerEntries = await db
        .select()
        .from(subscriberLedger)
        .where(eq(subscriberLedger.referenceId, unpaidInvoiceNumber));

      const voidReversal = ledgerEntries.find((e) => e.entryType === 'INVOICE_VOIDED');
      expect(voidReversal).toBeDefined();
      expect(voidReversal?.creditCentavos).toBe(body.data.totalDueCentavos);

      // Verify audit log
      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, unpaidInvoiceId));

      const voidAudit = auditRows.find((a) => a.action === 'INVOICE_VOIDED');
      expect(voidAudit).toBeDefined();
      expect(voidAudit?.reason).toContain('Customer requested plan downgrade');
    });

    it('rejects attempt to void an already voided invoice with HTTP 400', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/invoices/${unpaidInvoiceId}/void`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: 'Attempting second void',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('INVOICE_ALREADY_VOID');
    });

    it('rejects attempt to void a paid invoice with HTTP 400', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/invoices/${paidInvoiceId}/void`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: 'Attempting to void paid bill',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('CANNOT_VOID_PAID_INVOICE');
    });

    it('rejects void request with invalid or missing reason with HTTP 400', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/invoices/${unpaidInvoiceId}/void`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: 'tiny', // Less than 5 characters
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('INVALID_INPUT');
    });
  });

  describe('10. Concurrency & Collision Safety (Acceptance Test AT-09, AT-11)', () => {
    it('safely serializes concurrent requests for the same service account and billing period', async () => {
      // Create dedicated service account for concurrency test
      const saRes = await server.inject({
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
      const saId = JSON.parse(saRes.payload).data.id;

      const billingPayload = {
        serviceAccountId: saId,
        billingPeriodStart: '2027-01-01',
        billingPeriodEnd: '2027-01-31',
      };

      // Fire 2 concurrent requests simultaneously
      const [resA, resB] = await Promise.all([
        server.inject({
          method: 'POST',
          url: '/api/v1/invoices/generate',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: billingPayload,
        }),
        server.inject({
          method: 'POST',
          url: '/api/v1/invoices/generate',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: billingPayload,
        }),
      ]);

      const statusCodes = [resA.statusCode, resB.statusCode].sort();
      expect(statusCodes).toEqual([201, 409]);

      const conflictRes = resA.statusCode === 409 ? resA : resB;
      const conflictBody = JSON.parse(conflictRes.payload);
      expect(conflictBody.code).toBe('DUPLICATE_BILLING_PERIOD');

      // Verify exactly one invoice exists in database
      const dbInvoices = await db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.serviceAccountId, saId),
            eq(invoices.billingPeriodStart, '2027-01-01'),
            eq(invoices.billingPeriodEnd, '2027-01-31')
          )
        );
      expect(dbInvoices).toHaveLength(1);
    });

    it('generates strictly unique sequential invoice numbers under concurrent creation (AT-09)', async () => {
      // Create two distinct active service accounts
      const sa1Res = await server.inject({
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
      const sa1Id = JSON.parse(sa1Res.payload).data.id;

      const sa2Res = await server.inject({
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
      const sa2Id = JSON.parse(sa2Res.payload).data.id;

      const [res1, res2] = await Promise.all([
        server.inject({
          method: 'POST',
          url: '/api/v1/invoices/generate',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            serviceAccountId: sa1Id,
            billingPeriodStart: '2027-02-01',
            billingPeriodEnd: '2027-02-28',
          },
        }),
        server.inject({
          method: 'POST',
          url: '/api/v1/invoices/generate',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            serviceAccountId: sa2Id,
            billingPeriodStart: '2027-02-01',
            billingPeriodEnd: '2027-02-28',
          },
        }),
      ]);

      expect(res1.statusCode).toBe(201);
      expect(res2.statusCode).toBe(201);

      const inv1 = JSON.parse(res1.payload).data;
      const inv2 = JSON.parse(res2.payload).data;

      expect(inv1.invoiceNumber).not.toBe(inv2.invoiceNumber);
      expect(inv1.invoiceNumber).toMatch(/^INV-202702-\d{4}$/);
      expect(inv2.invoiceNumber).toMatch(/^INV-202702-\d{4}$/);
    });
  });

  describe('11. Lifecycle Guards & Boundary Validation', () => {
    it('rejects generating invoice for a PENDING_INSTALL service account with HTTP 400', async () => {
      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: testSubscriberId,
          servicePlanId: testPlanId,
          status: 'PENDING_INSTALL',
        },
      });
      const pendingSaId = JSON.parse(saRes.payload).data.id;

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: pendingSaId,
          billingPeriodStart: '2027-03-01',
          billingPeriodEnd: '2027-03-31',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('ACCOUNT_NOT_ACTIVE');
    });

    it('rejects single invoice generation when activation date is after billing period end with HTTP 400', async () => {
      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: testSubscriberId,
          servicePlanId: testPlanId,
          status: 'ACTIVE',
          activationDate: '2027-05-15',
        },
      });
      const futureSaId = JSON.parse(saRes.payload).data.id;

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: futureSaId,
          billingPeriodStart: '2027-04-01',
          billingPeriodEnd: '2027-04-30',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('ACCOUNT_NOT_ACTIVATED_IN_PERIOD');
    });

    it('skips accounts whose activation date is after period end during batch generation', async () => {
      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: testSubscriberId,
          servicePlanId: testPlanId,
          status: 'ACTIVE',
          activationDate: '2027-07-20',
        },
      });
      const futureSaId = JSON.parse(saRes.payload).data.id;

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          billingPeriodStart: '2027-06-01',
          billingPeriodEnd: '2027-06-30',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload).data;
      const skipped = body.skippedAccounts.find((s: any) => s.serviceAccountId === futureSaId);
      expect(skipped).toBeDefined();
      expect(skipped.reason).toContain('Activation date');
    });

    it('rejects invoice generation when billingPeriodStart > billingPeriodEnd with HTTP 400', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: testServiceAccountId,
          billingPeriodStart: '2027-09-30',
          billingPeriodEnd: '2027-09-01',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('INVALID_INPUT');
    });

    it('rejects invoice generation when dueDate < issueDate with HTTP 400', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: testServiceAccountId,
          billingPeriodStart: '2027-08-01',
          billingPeriodEnd: '2027-08-31',
          issueDate: '2027-08-15',
          dueDate: '2027-08-10',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('INVALID_INPUT');
    });

    it('rejects negative line item amounts with HTTP 400', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: testServiceAccountId,
          billingPeriodStart: '2027-08-01',
          billingPeriodEnd: '2027-08-31',
          customLineItems: [
            {
              itemType: 'INSTALLATION',
              description: 'Illegal negative fee',
              amountCentavos: -50000,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('INVALID_INPUT');
    });
  });

  describe('12. Advanced Filtering, Due Dates, and Payment Allocation Protection', () => {
    it('filters invoices by exact dueDate', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/invoices?dueDate=2026-09-16',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      for (const inv of body.data) {
        expect(inv.dueDate).toBe('2026-09-16');
      }
    });

    it('filters invoices by date range (startDate & endDate)', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/invoices?startDate=2026-09-01&endDate=2026-09-30',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('finds invoices when searching by subscriber businessName', async () => {
      // Create subscriber with unique business name
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Eduardo',
          lastName: 'Manalo',
          businessName: 'Apex Gaming Cafe',
          contactNumber: '09197778899',
          streetAddress: 'Main Ave',
          barangay: 'Barangay 9',
        },
      });
      const apexSub = JSON.parse(subRes.payload).data;

      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: apexSub.id,
          servicePlanId: testPlanId,
          status: 'ACTIVE',
          activationDate: '2026-08-01',
        },
      });
      const apexSa = JSON.parse(saRes.payload).data;

      await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: apexSa.id,
          billingPeriodStart: '2027-10-01',
          billingPeriodEnd: '2027-10-31',
        },
      });

      const searchRes = await server.inject({
        method: 'GET',
        url: '/api/v1/invoices?search=Apex Gaming',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(searchRes.statusCode).toBe(200);
      const body = JSON.parse(searchRes.payload);
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0].subscriber.businessName).toBe('Apex Gaming Cafe');
    });

    it('prevents voiding an invoice that has attached payment allocations', async () => {
      // Generate a fresh unpaid invoice
      const invRes = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: testServiceAccountId,
          billingPeriodStart: '2027-11-01',
          billingPeriodEnd: '2027-11-30',
        },
      });
      expect(invRes.statusCode).toBe(201);
      const testInv = JSON.parse(invRes.payload).data;

      // Create dummy payment and allocation directly in DB
      const [cashierUser] = await db.select({ id: users.id }).from(users).limit(1);
      const [pmt] = await db
        .insert(payments)
        .values({
          paymentNumber: `PMT-TEST-${Date.now()}`,
          subscriberId: testSubscriberId,
          cashierId: cashierUser.id,
          paymentMethod: 'CASH',
          amountCentavos: 50000,
        })
        .returning();

      await db.insert(paymentAllocations).values({
        paymentId: pmt.id,
        invoiceId: testInv.id,
        allocatedCentavos: 50000,
      });

      // Attempt to void should be rejected
      const voidRes = await server.inject({
        method: 'POST',
        url: `/api/v1/invoices/${testInv.id}/void`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: 'Attempting to void invoice with payment allocation',
        },
      });

      expect(voidRes.statusCode).toBe(400);
      const voidBody = JSON.parse(voidRes.payload);
      expect(voidBody.code).toBe('CANNOT_VOID_PAID_INVOICE');
    });

    it('correctly handles multi-account batch advance credit application and running ledger debit summation', async () => {
      // Create subscriber with ₱1,500.00 advance credit (150,000 centavos)
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Ricardo',
          lastName: 'Dalisay',
          contactNumber: '09199990001',
          streetAddress: 'Poblacion',
          barangay: 'Barangay 2',
        },
      });
      const ricardo = JSON.parse(subRes.payload).data;

      await db
        .update(subscribers)
        .set({ advanceCreditCentavos: 150000 })
        .where(eq(subscribers.id, ricardo.id));

      // Create two service accounts under Ricardo (₱999.00 / mo each)
      const sa1Res = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: ricardo.id,
          servicePlanId: testPlanId,
          status: 'ACTIVE',
          activationDate: '2026-08-01',
        },
      });
      const sa1 = JSON.parse(sa1Res.payload).data;

      const sa2Res = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: ricardo.id,
          servicePlanId: testPlanId,
          status: 'ACTIVE',
          activationDate: '2026-08-01',
        },
      });
      const sa2 = JSON.parse(sa2Res.payload).data;

      // Run batch generation for 2027-12
      const batchRes = await server.inject({
        method: 'POST',
        url: '/api/v1/invoices/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          billingPeriodStart: '2027-12-01',
          billingPeriodEnd: '2027-12-31',
        },
      });

      expect(batchRes.statusCode).toBe(201);
      const batchData = JSON.parse(batchRes.payload).data;

      const inv1 = batchData.invoices.find((i: any) => i.serviceAccountId === sa1.id);
      const inv2 = batchData.invoices.find((i: any) => i.serviceAccountId === sa2.id);

      expect(inv1).toBeDefined();
      expect(inv2).toBeDefined();

      // First account gets 99900 credit applied, status PAID
      expect(inv1.totalDueCentavos).toBe(99900);
      expect(inv1.allocatedCentavos).toBe(99900);
      expect(inv1.remainingBalanceCentavos).toBe(0);
      expect(inv1.status).toBe('PAID');

      // Second account gets remaining 50100 credit applied, status PARTIALLY_PAID
      expect(inv2.totalDueCentavos).toBe(99900);
      expect(inv2.allocatedCentavos).toBe(50100);
      expect(inv2.remainingBalanceCentavos).toBe(49800);
      expect(inv2.status).toBe('PARTIALLY_PAID');

      // Subscriber advance credit is completely consumed (0 centavos)
      const [updatedRicardo] = await db
        .select()
        .from(subscribers)
        .where(eq(subscribers.id, ricardo.id));
      expect(updatedRicardo.advanceCreditCentavos).toBe(0);

      // Verify Ricardo's running ledger net balance:
      // Debit: 99900 (inv1) + 99900 (inv2) = 199800
      // Credit: 99900 (credit1) + 50100 (credit2) = 150000
      // Net balance = 199800 - 150000 = 49800 (₱498.00)
      const ricardoLedger = await db
        .select()
        .from(subscriberLedger)
        .where(eq(subscriberLedger.subscriberId, ricardo.id));

      const totalDebit = ricardoLedger.reduce((sum, e) => sum + e.debitCentavos, 0);
      const totalCredit = ricardoLedger.reduce((sum, e) => sum + e.creditCentavos, 0);
      expect(totalDebit - totalCredit).toBe(49800);
    });
  });
});
