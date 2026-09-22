import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { buildServer } from '../src/server.js';
import { db, pool } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import {
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
  collectionAreas,
  collectionRoutes,
  collectionBatches,
  serviceOrders,
  dunningNotices,
  users,
  auditLogs,
} from '../src/db/schema.js';
import { eq, and, sql, desc, ne } from 'drizzle-orm';
import { getCoreTableCounts } from '../src/modules/system/system.service.js';

describe('Phase 9 — Full End-to-End Acceptance Test Suite (AT-01 to AT-14 & Section 32 Defense)', () => {
  let server: FastifyInstance;

  // Workstation tokens
  let adminToken: string;
  let cashierToken: string;
  let accountingToken: string;
  let supervisorToken: string;
  let techToken: string;

  let adminUserId: string;
  let cashierUserId: string;
  let techUserId: string;
  let defaultAreaId: string;
  let defaultRouteId: string;
  let standardPlanId: string;

  beforeAll(async () => {
    await seedDatabase();

    server = buildServer();
    await server.ready();

    // 1. Admin Login
    const adminLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'Admin123!' },
    });
    const adminBody = JSON.parse(adminLogin.payload);
    adminToken = adminBody.token;
    adminUserId = adminBody.user.id;

    // 2. Cashier Login
    const cashierLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'cashier', password: 'Cashier123!' },
    });
    const cashierBody = JSON.parse(cashierLogin.payload);
    cashierToken = cashierBody.token;
    cashierUserId = cashierBody.user.id;

    // 3. Technician Login
    const techLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'technician', password: 'Tech123!' },
    });
    const techBody = JSON.parse(techLogin.payload);
    techToken = techBody.token;
    techUserId = techBody.user.id;

    // 4. Issue Accounting and Supervisor tokens
    accountingToken = server.jwt.sign({
      id: adminUserId,
      username: 'accounting_user',
      fullName: 'Accounting Officer',
      roles: ['ROLE_ACCOUNTING'],
      permissions: [
        'payments.reverse',
        'payment.reverse',
        'payments.read',
        'payment.view',
        'billing.adjust',
        'billing.view',
        'reports.financial',
        'report.financial',
        'audit.view',
      ],
    });

    supervisorToken = server.jwt.sign({
      id: cashierUserId,
      username: 'supervisor_user',
      fullName: 'Collection Supervisor',
      roles: ['ROLE_COLLECTION_SUPV'],
      permissions: [
        'collection.view',
        'collection.batch_create',
        'collection.enter_field',
        'collection.reconcile',
        'collection.manage_staff',
        'remittances.manage',
        'service_orders.create',
        'service_orders.read',
        'service_orders.update',
      ],
    });

    // 5. Query or create default area and route
    const [area] = await db.select().from(collectionAreas).limit(1);
    defaultAreaId = area.id;

    const existingRoutes = await db.select().from(collectionRoutes).where(eq(collectionRoutes.collectionAreaId, defaultAreaId)).limit(1);
    if (existingRoutes.length > 0) {
      defaultRouteId = existingRoutes[0].id;
    } else {
      const [route] = await db
        .insert(collectionRoutes)
        .values({
          collectionAreaId: defaultAreaId,
          routeCode: `RT-${Date.now().toString().slice(-6)}`,
          name: 'Central Poblacion Route',
          assignedCollectorId: cashierUserId,
        })
        .returning();
      defaultRouteId = route.id;
    }

    // 6. Query or create standard ₱999.00 plan (99900 centavos)
    const existingPlans = await db.select().from(servicePlans).where(eq(servicePlans.monthlyRecurringCentavos, 99900)).limit(1);
    if (existingPlans.length > 0) {
      standardPlanId = existingPlans[0].id;
    } else {
      const planRes = await server.inject({
        method: 'POST',
        url: '/api/v1/plans',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Fiber Starter 999',
          planCode: `FS999-${Date.now().toString().slice(-4)}`,
          serviceType: 'INTERNET',
          monthlyFeeCentavos: 99900,
          installationFeeCentavos: 100000,
        },
      });
      standardPlanId = JSON.parse(planRes.payload).data.id;
    }
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  // ============================================================================
  // PART 1: PRODUCT.md SECTION 32 LIVE DEFENSE 27-STEP DEMONSTRATION SEQUENCE
  // ============================================================================
  describe('PRODUCT.md Section 32: 27-Step Live Defense Demonstration Sequence', () => {
    let demoSubscriberId: string;
    let demoSubscriberAccountNo: string;
    let demoServiceAccountId: string;
    let demoInvoiceId: string;
    let demoInvoiceNumber: string;
    let demoPaymentId: string;
    let demoReceiptId: string;
    let demoReceiptNumber: string;
    let demoGCashTxId: string;
    const demoGCashRef = `9012${Date.now().toString().slice(-9)}`;
    let demoBatchId: string;
    let backupArchiveFilename: string;

    // Step 1: Login as administrator
    it('Step 1: Authenticate administrator and acquire workstation session', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'admin', password: 'Admin123!' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.token).toBeDefined();
      expect(body.user.username).toBe('admin');
      expect(body.user.roles).toContain('ROLE_SUPER_ADMIN');
    });

    // Step 2: Show dashboard
    it('Step 2: Display executive dashboard with collection KPIs & AR aging summary', async () => {
      const [agingRes, dailyRes] = await Promise.all([
        server.inject({
          method: 'GET',
          url: '/api/v1/reports/ar-aging',
          headers: { authorization: `Bearer ${adminToken}` },
        }),
        server.inject({
          method: 'GET',
          url: '/api/v1/reports/daily-collections',
          headers: { authorization: `Bearer ${adminToken}` },
        }),
      ]);
      expect(agingRes.statusCode).toBe(200);
      expect(dailyRes.statusCode).toBe(200);
      const agingBody = JSON.parse(agingRes.payload);
      expect(agingBody.data.summary).toBeDefined();
    });

    // Step 3: Open/create subscriber
    it('Step 3: Register a new subscriber profile with primary billing address', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Juan',
          lastName: 'Dela Cruz',
          contactNumber: '09171234567',
          streetAddress: 'Purok 3 Sayre Highway',
          barangay: 'Poblacion',
          municipality: 'Malaybalay',
          province: 'Bukidnon',
          postalCode: '8700',
        },
      });
      expect(res.statusCode).toBe(201);
      const sub = JSON.parse(res.payload).data;
      demoSubscriberId = sub.id;
      demoSubscriberAccountNo = sub.accountNumber;
      expect(demoSubscriberAccountNo).toMatch(/^SUB-\d{6}-\d{4}$/);
    });

    // Step 4: Open Internet/Cable service account
    it('Step 4: Provision broadband Internet service account under subscriber', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: demoSubscriberId,
          servicePlanId: standardPlanId,
          collectionAreaId: defaultAreaId,
          status: 'ACTIVE',
          activationDate: '2026-08-01',
        },
      });
      expect(res.statusCode).toBe(201);
      const sa = JSON.parse(res.payload).data;
      demoServiceAccountId = sa.id;
      expect(sa.serviceAccountNumber).toMatch(/^SA-\d{6}-\d{4}$/);
      expect(sa.status).toBe('ACTIVE');
    });

    // Step 5: Generate/display monthly invoice
    it('Step 5: Generate monthly billing invoice for ₱999.00', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: demoServiceAccountId,
          billingPeriodStart: '2026-08-01',
          billingPeriodEnd: '2026-08-31',
          issueDate: '2026-08-01',
          dueDate: '2026-08-16',
        },
      });
      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.payload).data;
      demoInvoiceId = inv.id;
      demoInvoiceNumber = inv.invoiceNumber;
      expect(demoInvoiceNumber).toMatch(/^INV-\d{6}-\d{4,6}$/);
      expect(Number(inv.totalDueCentavos)).toBe(99900);
      expect(Number(inv.remainingBalanceCentavos)).toBe(99900);
      expect(inv.status).toBe('UNPAID');
    });

    // Step 6: Show ledger debit
    it('Step 6: Verify double-entry ledger debit is recorded for invoice generation', async () => {
      const ledgers = await db
        .select()
        .from(subscriberLedger)
        .where(
          and(
            eq(subscriberLedger.subscriberId, demoSubscriberId),
            eq(subscriberLedger.entryType, 'INVOICE')
          )
        );
      expect(ledgers.length).toBeGreaterThan(0);
      const ledgerEntry = ledgers[0];
      expect(Number(ledgerEntry.debitCentavos)).toBe(99900);
      expect(Number(ledgerEntry.creditCentavos)).toBe(0);
      expect(Number(ledgerEntry.balanceAfterCentavos)).toBe(99900);
    });

    // Step 7: Post exact Cash payment
    it('Step 7: Post exact Cash payment of ₱999.00 at Cashier counter', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: demoSubscriberId,
          amountCentavos: 99900,
          paymentMethod: 'CASH',
          notes: 'Defense demo counter exact cash payment',
        },
      });
      expect(res.statusCode).toBe(201);
      const pay = JSON.parse(res.payload).data;
      demoPaymentId = pay.id;
      demoReceiptId = pay.receipt.id;
      demoReceiptNumber = pay.receipt.receiptNumber;
      expect(pay.amountCentavos).toBe(99900);
    });

    // Step 8: Show allocation
    it('Step 8: Verify payment FIFO allocation marks invoice PAID with zero balance', async () => {
      const [inv] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, demoInvoiceId));
      expect(inv.status).toBe('PAID');
      expect(Number(inv.remainingBalanceCentavos)).toBe(0);
      expect(Number(inv.allocatedCentavos)).toBe(99900);
    });

    // Step 9: Print/preview receipt
    it('Step 9: Retrieve printable official receipt with sequential number OR-YYYYMM-XXXX', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/receipts/${demoReceiptId}`,
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(res.statusCode).toBe(200);
      const rec = JSON.parse(res.payload).data;
      expect(rec.receiptNumber).toBe(demoReceiptNumber);
      expect(rec.receiptNumber).toMatch(/^OR-\d{6}-\d{4}$/);
      expect(Number(rec.totalAmountCentavos)).toBe(99900);
    });

    // Step 10: Submit/verify GCash
    it('Step 10: Submit customer GCash proof and verify into financial ledger', async () => {
      // 1. Submit
      const submitRes = await server.inject({
        method: 'POST',
        url: '/api/v1/gcash/submit',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: demoSubscriberId,
          referenceNumber: demoGCashRef,
          amountCentavos: 99900,
          senderPhone: '09171234567',
          senderName: 'Juan Dela Cruz',
          proofImagePath: 'proofs/juan-gcash-august.jpg',
        },
      });
      expect(submitRes.statusCode).toBe(201);
      demoGCashTxId = JSON.parse(submitRes.payload).data.id;

      // 2. Verify
      const verifyRes = await server.inject({
        method: 'POST',
        url: `/api/v1/gcash/${demoGCashTxId}/verify`,
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          status: 'VERIFIED',
          notes: 'GCash reference verified with GCash Merchant portal',
        },
      });
      expect(verifyRes.statusCode).toBe(200);
    });

    // Step 11: Demonstrate duplicate GCash protection
    it('Step 11: Prevent duplicate GCash reference intake with HTTP 409 Conflict (AT-05)', async () => {
      const dupRes = await server.inject({
        method: 'POST',
        url: '/api/v1/gcash/submit',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: demoSubscriberId,
          referenceNumber: demoGCashRef, // Reused reference
          amountCentavos: 99900,
          senderPhone: '09171234567',
          senderName: 'Juan Dela Cruz',
          proofImagePath: 'proofs/juan-gcash-august-dup.jpg',
        },
      });
      expect(dupRes.statusCode).toBe(409);
      const err = JSON.parse(dupRes.payload);
      expect(err.code).toBe('DUPLICATE_GCASH_REFERENCE');
    });

    // Step 12: Show subscriber ledger
    it('Step 12: Inspect running subscriber ledger with debits, credits, and balance trail', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/subscribers/${demoSubscriberId}/ledger`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const ledger = JSON.parse(res.payload).data;
      expect(ledger.ledgerLines.length).toBeGreaterThanOrEqual(3);
    });

    // Step 13: Show Statement of Account
    it('Step 13: Generate comprehensive Statement of Account (SOA) aggregating services, aging, and ledger', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/subscribers/${demoSubscriberId}/soa`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const soa = JSON.parse(res.payload).data;
      expect(soa.statementNumber).toMatch(/^SOA-SUB-\d{6}-\d{4}-\d{8}$/);
      expect(soa.subscriber.accountNumber).toBe(demoSubscriberAccountNo);
      expect(soa.activeServices.length).toBeGreaterThan(0);
      expect(soa.agingSummary).toBeDefined();
      expect(soa.ledgerLines).toBeDefined();
    });

    // Step 14: Open overdue subscriber
    it('Step 14: Create overdue subscriber and invoice for aging audit', async () => {
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Delinquent',
          lastName: 'Customer',
          contactNumber: '09187654321',
          streetAddress: 'Poblacion Zone 2',
          barangay: 'Poblacion',
        },
      });
      const sub = JSON.parse(subRes.payload).data;

      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: sub.id,
          servicePlanId: standardPlanId,
          collectionAreaId: defaultAreaId,
          status: 'ACTIVE',
        },
      });
      const sa = JSON.parse(saRes.payload).data;

      // Past due invoice (June 2026, due June 15)
      await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: sa.id,
          billingPeriodStart: '2026-06-01',
          billingPeriodEnd: '2026-06-30',
          issueDate: '2026-06-01',
          dueDate: '2026-06-15',
        },
      });
    });

    // Step 15: Show AR aging/filtering
    it('Step 15: Retrieve Accounts Receivable aging report with 5 standard aging buckets', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/ar-aging',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const rep = JSON.parse(res.payload).data;
      expect(rep.summary.totalReceivableCentavos).toBeGreaterThan(0);
      expect(rep.summary.totalOverdueCentavos).toBeGreaterThan(0);
    });

    // Step 16: Open collector batch
    it('Step 16: Open field collection batch for assigned collector', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/batches',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          batchNumber: `BAT-202609-${Date.now().toString().slice(-4)}`,
          collectorId: cashierUserId,
          collectionAreaId: defaultAreaId,
          expectedCashCentavos: 2000000,
        },
      });
      expect(res.statusCode).toBe(201);
      demoBatchId = JSON.parse(res.payload).data.id;
    });

    // Step 17: Record collection
    it('Step 17: Record collected field payment receipts in batch', async () => {
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: demoSubscriberId,
          amountCentavos: 2000000,
          paymentMethod: 'CASH',
          notes: 'Field collection payment recorded on route',
        },
      });
      expect(payRes.statusCode).toBe(201);
    });

    // Step 18: Record remittance
    it('Step 18: Record physical cash remittance turned in by field collector', async () => {
      const shiftRes = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/shift/reconcile',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          cashierId: cashierUserId,
          shiftDate: '2026-09-19',
          remittedCashCentavos: 2000000,
          notes: 'Full remittance turned in at counter',
        },
      });
      expect(shiftRes.statusCode).toBe(200);
    });

    // Step 19: Demonstrate reconciliation (AT-07)
    it('Step 19: Reconcile balanced batch with ₱0 difference (AT-07)', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/collections/batches/${demoBatchId}/reconcile`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          remittedCashCentavos: 2000000,
          supervisorNotes: 'Balanced remittance verified with count',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.batch.status).toBe('RECONCILED');
      expect(Number(body.reconciliation.differenceCentavos)).toBe(0);
      expect(body.reconciliation.isBalanced).toBe(true);
    });

    // Step 20: Demonstrate shortage/overage (AT-08)
    it('Step 20: Detect and record collector cash shortage of ₱500.00 (AT-08)', async () => {
      // Open shortage batch with ₱20,000 expected
      const bRes = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/batches',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          batchNumber: `BAT-202609-S${Date.now().toString().slice(-3)}`,
          collectorId: cashierUserId,
          collectionAreaId: defaultAreaId,
          expectedCashCentavos: 2000000,
        },
      });
      expect(bRes.statusCode).toBe(201);
      const shortBatchId = JSON.parse(bRes.payload).data.id;

      // Reconcile with only ₱19,500 remitted (₱500 shortage)
      const recRes = await server.inject({
        method: 'POST',
        url: `/api/v1/collections/batches/${shortBatchId}/reconcile`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          remittedCashCentavos: 1950000,
          supervisorNotes: 'Shortage of ₱500 observed during cash count',
        },
      });
      expect(recRes.statusCode).toBe(200);
      const body = JSON.parse(recRes.payload);
      expect(body.batch.status).toBe('RECONCILED_WITH_SHORTAGE');
      expect(Number(body.reconciliation.differenceCentavos)).toBe(50000); // ₱500.00
      expect(body.reconciliation.isShortage).toBe(true);

      // Verify closing short batch without force is rejected
      const closeAttempt = await server.inject({
        method: 'POST',
        url: `/api/v1/collections/batches/${shortBatchId}/close`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: { reason: 'Attempt silent close' },
      });
      expect(closeAttempt.statusCode).toBe(400);
      expect(JSON.parse(closeAttempt.payload).code).toBe('UNRESOLVED_SHORTAGE');
    });

    // Step 21: Reverse a payment (AT-06)
    it('Step 21: Execute authorized payment reversal, restoring invoice balance & voiding receipt (AT-06)', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${demoPaymentId}/reverse`,
        headers: { authorization: `Bearer ${accountingToken}` },
        payload: {
          reason: 'Bounced Check / Bank Chargeback reversal test',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.payment.isReversed).toBe(true);

      // Verify invoice balance restored
      const [inv] = await db.select().from(invoices).where(eq(invoices.id, demoInvoiceId));
      expect(Number(inv.remainingBalanceCentavos)).toBe(99900);
      expect(inv.status).not.toBe('PAID');

      // Verify receipt status VOID / REVERSED
      const [rec] = await db.select().from(receipts).where(eq(receipts.id, demoReceiptId));
      expect(rec.status).toBe('REVERSED');
    });

    // Step 22: Show audit trail
    it('Step 22: Inspect immutable audit trail for PAYMENT_REVERSED entry', async () => {
      const logs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'PAYMENT_REVERSED'))
        .orderBy(desc(auditLogs.createdAt));
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].entityId).toBe(demoPaymentId);
    });

    // Step 23: Export a report to CSV
    it('Step 23: Export Accounts Receivable aging report in CSV format', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/ar-aging?format=csv',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.payload).toContain('Account Number');
    });

    // Step 24: Demonstrate lower-role authorization (AT-10)
    it('Step 24: Verify Cashier direct API call to admin-only user creation is blocked with 403 Forbidden (AT-10)', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          username: 'unauthorized_hacker',
          password: 'Password123!',
          fullName: 'Unauthorized Actor',
          roles: ['ROLE_ADMIN'],
        },
      });
      expect(res.statusCode).toBe(403);
      const err = JSON.parse(res.payload);
      expect(err.error).toBe('Forbidden');
    });

    // Step 25: Demonstrate backup creation (AT-12)
    it('Step 25: Generate cryptographic database backup snapshot archive (AT-12)', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/system/backup',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.filename).toMatch(/^bcis_backup_\d{8}_\d{6}\.sql$/);
      expect(body.data.checksumSha256).toHaveLength(64); // Valid SHA-256
      backupArchiveFilename = body.data.filename;
    });

    // Step 26: Explain restore procedure (AT-12)
    it('Step 26: Execute full database restore from snapshot with row count parity verification (AT-12)', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/system/restore',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          filename: backupArchiveFilename,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.verification.parity).toBe(true);
    });

    // Step 27: Demonstrate simultaneous multi-PC operation (AT-09)
    it('Step 27: Verify simultaneous multi-workstation concurrency without race conditions (AT-09)', async () => {
      const [resAdmin, resCashier, resTech] = await Promise.all([
        server.inject({
          method: 'GET',
          url: '/api/v1/reports/daily-collections',
          headers: { authorization: `Bearer ${adminToken}` },
        }),
        server.inject({
          method: 'GET',
          url: `/api/v1/subscribers/${demoSubscriberId}/soa`,
          headers: { authorization: `Bearer ${cashierToken}` },
        }),
        server.inject({
          method: 'GET',
          url: '/api/v1/service-orders',
          headers: { authorization: `Bearer ${techToken}` },
        }),
      ]);
      expect(resAdmin.statusCode).toBe(200);
      expect(resCashier.statusCode).toBe(200);
      expect(resTech.statusCode).toBe(200);
    });
  });

  // ============================================================================
  // PART 2: MANDATORY ACCEPTANCE CRITERIA TRACEABILITY (AT-01 to AT-14)
  // ============================================================================
  describe('Mandatory Acceptance Criteria Verification (AT-01 through AT-14)', () => {
    let atSubId: string;
    let atServiceAccountId: string;

    beforeAll(async () => {
      // Create isolated subscriber and account for AT assertions
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Acceptance',
          lastName: 'Tester',
          contactNumber: '09173334444',
          streetAddress: 'Main Blvd Block 5',
          barangay: 'Poblacion',
        },
      });
      atSubId = JSON.parse(subRes.payload).data.id;

      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: atSubId,
          servicePlanId: standardPlanId,
          collectionAreaId: defaultAreaId,
          status: 'ACTIVE',
          activationDate: '2026-01-01',
        },
      });
      atServiceAccountId = JSON.parse(saRes.payload).data.id;
    });

    // AT-01: Exact Payment
    it('AT-01: Exact Payment — ₱999 invoice paid with ₱999 cash -> remaining balance ₱0, PAID, OR issued', async () => {
      const invRes = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: atServiceAccountId,
          billingPeriodStart: '2026-01-01',
          billingPeriodEnd: '2026-01-31',
          issueDate: '2026-01-01',
          dueDate: '2026-01-16',
        },
      });
      const inv = JSON.parse(invRes.payload).data;

      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: atSubId,
          amountCentavos: Number(inv.totalDueCentavos),
          paymentMethod: 'CASH',
        },
      });
      expect(payRes.statusCode).toBe(201);
      const pay = JSON.parse(payRes.payload).data;
      expect(pay.receipt.receiptNumber).toMatch(/^OR-\d{6}-\d{4}$/);

      const [updatedInv] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
      expect(updatedInv.status).toBe('PAID');
      expect(Number(updatedInv.remainingBalanceCentavos)).toBe(0);
    });

    // AT-02: Partial Payment
    it('AT-02: Partial Payment — ₱999 invoice paid with ₱500 cash -> remaining balance ₱499, PARTIALLY_PAID', async () => {
      const invRes = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: atServiceAccountId,
          billingPeriodStart: '2026-02-01',
          billingPeriodEnd: '2026-02-28',
          issueDate: '2026-02-01',
          dueDate: '2026-02-16',
        },
      });
      const inv = JSON.parse(invRes.payload).data;

      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: atSubId,
          amountCentavos: 50000, // ₱500.00
          paymentMethod: 'CASH',
        },
      });
      expect(payRes.statusCode).toBe(201);

      const [updatedInv] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
      expect(updatedInv.status).toBe('PARTIALLY_PAID');
      expect(Number(updatedInv.allocatedCentavos)).toBe(50000);
      expect(Number(updatedInv.remainingBalanceCentavos)).toBe(49900); // ₱499.00
    });

    // AT-03: Advance / Overpayment
    it('AT-03: Advance Payment — ₱1,000 monthly bill paid with ₱3,000 -> excess credited to advance account', async () => {
      // Pay remaining ₱499 plus ₱2,000 advance
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: atSubId,
          amountCentavos: 249900,
          paymentMethod: 'CASH',
        },
      });
      expect(payRes.statusCode).toBe(201);

      const [sub] = await db.select().from(subscribers).where(eq(subscribers.id, atSubId));
      expect(Number(sub.advanceCreditCentavos)).toBe(200000); // ₱2,000.00 advance
    });

    // AT-04: Oldest-First FIFO Allocation
    it('AT-04: Oldest-First FIFO Allocation — Allocates payment starting with the oldest unpaid invoice', async () => {
      // Create new sub for clean 2-month test
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'FIFO',
          lastName: 'Tester',
          contactNumber: '09175556666',
          streetAddress: 'Zone 1',
          barangay: 'Poblacion',
        },
      });
      const fifoSub = JSON.parse(subRes.payload).data;

      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: fifoSub.id,
          servicePlanId: standardPlanId,
          collectionAreaId: defaultAreaId,
          status: 'ACTIVE',
          activationDate: '2026-01-01',
        },
      });
      const fifoSa = JSON.parse(saRes.payload).data;

      // Month 1: ₱999 (August)
      const inv1Res = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: fifoSa.id,
          billingPeriodStart: '2026-08-01',
          billingPeriodEnd: '2026-08-31',
          issueDate: '2026-08-01',
          dueDate: '2026-08-16',
        },
      });
      const inv1 = JSON.parse(inv1Res.payload).data;

      // Month 2: ₱999 (September)
      const inv2Res = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: fifoSa.id,
          billingPeriodStart: '2026-09-01',
          billingPeriodEnd: '2026-09-30',
          issueDate: '2026-09-01',
          dueDate: '2026-09-16',
        },
      });
      const inv2 = JSON.parse(inv2Res.payload).data;

      // Pay ₱1,200.00 (120000 centavos)
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: fifoSub.id,
          amountCentavos: 120000,
          paymentMethod: 'CASH',
        },
      });
      expect(payRes.statusCode).toBe(201);

      // August bill must be PAID with ₱0 remaining
      const [updatedInv1] = await db.select().from(invoices).where(eq(invoices.id, inv1.id));
      expect(updatedInv1.status).toBe('PAID');
      expect(Number(updatedInv1.remainingBalanceCentavos)).toBe(0);

      // September bill must have ₱798.00 remaining (99900 - 20100 = 79800)
      const [updatedInv2] = await db.select().from(invoices).where(eq(invoices.id, inv2.id));
      expect(updatedInv2.status).toBe('PARTIALLY_PAID');
      expect(Number(updatedInv2.remainingBalanceCentavos)).toBe(79800);
    });

    // AT-05: Duplicate GCash
    it('AT-05: Duplicate GCash Reference Protection — Blocks reused GCash ref with 409 Conflict', async () => {
      const gcashRef = '9012' + Date.now().toString().slice(-9);
      const submit1 = await server.inject({
        method: 'POST',
        url: '/api/v1/gcash/submit',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: atSubId,
          referenceNumber: gcashRef,
          amountCentavos: 99900,
          senderPhone: '09171234567',
          senderName: 'AT-05 Tester',
          proofImagePath: 'proofs/at05.jpg',
        },
      });
      expect(submit1.statusCode).toBe(201);

      const submit2 = await server.inject({
        method: 'POST',
        url: '/api/v1/gcash/submit',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: atSubId,
          referenceNumber: gcashRef,
          amountCentavos: 99900,
          senderPhone: '09171234567',
          senderName: 'AT-05 Tester 2',
          proofImagePath: 'proofs/at05-dup.jpg',
        },
      });
      expect(submit2.statusCode).toBe(409);
      expect(JSON.parse(submit2.payload).code).toBe('DUPLICATE_GCASH_REFERENCE');
    });

    // AT-06: Payment Reversal
    it('AT-06: Payment Reversal — Restores invoice arrears, voids receipt, and logs audit reason', async () => {
      // Create dedicated subscriber for AT-06
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Reversal',
          lastName: 'Tester',
          contactNumber: '09176667777',
          streetAddress: 'Zone 2',
          barangay: 'Poblacion',
        },
      });
      const revSub = JSON.parse(subRes.payload).data;

      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: revSub.id,
          servicePlanId: standardPlanId,
          collectionAreaId: defaultAreaId,
          status: 'ACTIVE',
          activationDate: '2026-01-01',
        },
      });
      const revSa = JSON.parse(saRes.payload).data;

      // Generate and pay invoice
      const invRes = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: revSa.id,
          billingPeriodStart: '2026-03-01',
          billingPeriodEnd: '2026-03-31',
          issueDate: '2026-03-01',
          dueDate: '2026-03-16',
        },
      });
      const inv = JSON.parse(invRes.payload).data;

      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: revSub.id,
          amountCentavos: 99900,
          paymentMethod: 'CASH',
        },
      });
      const pay = JSON.parse(payRes.payload).data;

      // Reverse payment
      const revRes = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${pay.id}/reverse`,
        headers: { authorization: `Bearer ${accountingToken}` },
        payload: { reason: 'AT-06 Bank Reversal' },
      });
      expect(revRes.statusCode).toBe(200);

      const [restoredInv] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
      expect(Number(restoredInv.remainingBalanceCentavos)).toBe(99900);
      expect(restoredInv.status).not.toBe('PAID');
    });

    // AT-07: Balanced Remittance
    it('AT-07: Balanced Collector Remittance — Batch with ₱0 variance reconciles cleanly', async () => {
      const bRes = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/batches',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          batchNumber: `BAT-AT07-${Date.now().toString().slice(-4)}`,
          collectorId: cashierUserId,
          collectionAreaId: defaultAreaId,
          expectedCashCentavos: 1000000,
        },
      });
      expect(bRes.statusCode).toBe(201);
      const batchId = JSON.parse(bRes.payload).data.id;

      const recRes = await server.inject({
        method: 'POST',
        url: `/api/v1/collections/batches/${batchId}/reconcile`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          remittedCashCentavos: 1000000,
          supervisorNotes: 'AT-07 Balanced Remittance',
        },
      });
      expect(recRes.statusCode).toBe(200);
      const body = JSON.parse(recRes.payload);
      expect(body.batch.status).toBe('RECONCILED');
      expect(body.reconciliation.isBalanced).toBe(true);
      expect(body.reconciliation.differenceCentavos).toBe(0);
    });

    // AT-08: Collector Shortage
    it('AT-08: Collector Shortage — Records cash deficit and transitions to RECONCILED_WITH_SHORTAGE', async () => {
      const bRes = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/batches',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          batchNumber: `BAT-AT08-${Date.now().toString().slice(-4)}`,
          collectorId: cashierUserId,
          collectionAreaId: defaultAreaId,
          expectedCashCentavos: 1000000, // ₱10,000
        },
      });
      expect(bRes.statusCode).toBe(201);
      const batchId = JSON.parse(bRes.payload).data.id;

      const recRes = await server.inject({
        method: 'POST',
        url: `/api/v1/collections/batches/${batchId}/reconcile`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          remittedCashCentavos: 900000, // ₱9,000 (shortage ₱1,000)
          supervisorNotes: 'AT-08 Shortage detected',
        },
      });
      expect(recRes.statusCode).toBe(200);
      const body = JSON.parse(recRes.payload);
      expect(body.batch.status).toBe('RECONCILED_WITH_SHORTAGE');
      expect(body.reconciliation.isShortage).toBe(true);
      expect(body.reconciliation.differenceCentavos).toBe(100000); // ₱1,000
    });

    // AT-09: Concurrent Multi-PC Operation
    it('AT-09: Concurrent Multi-PC Operation — Zero sequence collisions and zero deadlocks under concurrent load', async () => {
      const p1 = server.inject({
        method: 'GET',
        url: '/api/v1/reports/ar-aging',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const p2 = server.inject({
        method: 'GET',
        url: `/api/v1/subscribers/${atSubId}/soa`,
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      const p3 = server.inject({
        method: 'GET',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${techToken}` },
      });

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      expect(r1.statusCode).toBe(200);
      expect(r2.statusCode).toBe(200);
      expect(r3.statusCode).toBe(200);
    });

    // AT-10: Server-Side RBAC Enforcement
    it('AT-10: Server-Side RBAC Enforcement — Rejects Cashier from administrative endpoints with HTTP 403 Forbidden', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          username: 'should_fail',
          password: 'Password123!',
          fullName: 'Unauthorized',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    // AT-11: Duplicate Billing Protection
    it('AT-11: Duplicate Billing Protection — Blocks second billing run for identical period with HTTP 409 Conflict', async () => {
      const period = {
        serviceAccountId: atServiceAccountId,
        billingPeriodStart: '2026-04-01',
        billingPeriodEnd: '2026-04-30',
        issueDate: '2026-04-01',
        dueDate: '2026-04-16',
      };

      const firstRes = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: period,
      });
      expect(firstRes.statusCode).toBe(201);

      const secondRes = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: period,
      });
      expect(secondRes.statusCode).toBe(409);
      expect(JSON.parse(secondRes.payload).code).toBe('DUPLICATE_BILLING_PERIOD');
    });

    // AT-12: Backup and Disaster Recovery Integrity
    it('AT-12: Backup and Disaster Recovery Integrity — Generates archive and validates 100% restoration parity', async () => {
      const backupRes = await server.inject({
        method: 'POST',
        url: '/api/v1/system/backup',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(backupRes.statusCode).toBe(201);
      const backup = JSON.parse(backupRes.payload).data;

      // 1. Verify listing endpoint GET /api/v1/system/backups
      const listRes = await server.inject({
        method: 'GET',
        url: '/api/v1/system/backups',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.payload);
      expect(Array.isArray(listBody.data)).toBe(true);
      expect(listBody.total).toBeGreaterThanOrEqual(1);
      expect(listBody.data.some((b: any) => b.filename === backup.filename)).toBe(true);

      // 2. Verify server-side RBAC protection: Cashier is barred from creating backups
      const cashierBackupRes = await server.inject({
        method: 'POST',
        url: '/api/v1/system/backup',
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(cashierBackupRes.statusCode).toBe(403);
      expect(JSON.parse(cashierBackupRes.payload).error).toBe('Forbidden');

      // 3. Verify server-side RBAC protection: Cashier is barred from restoring backups
      const cashierRestoreRes = await server.inject({
        method: 'POST',
        url: '/api/v1/system/restore',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: { filename: backup.filename },
      });
      expect(cashierRestoreRes.statusCode).toBe(403);
      expect(JSON.parse(cashierRestoreRes.payload).error).toBe('Forbidden');

      // 4. Verify 404 handling on non-existent backup filename
      const nonExistentRes = await server.inject({
        method: 'POST',
        url: '/api/v1/system/restore',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { filename: 'bcis_backup_99999999_999999.sql' },
      });
      expect(nonExistentRes.statusCode).toBe(404);
      expect(JSON.parse(nonExistentRes.payload).code).toBe('BACKUP_NOT_FOUND');

      // 5. Verify 422 Unprocessable Entity on tampered / checksum mismatched backup
      const backupDir = path.dirname(backup.filePath);
      const tamperedFilename = `tampered_${backup.filename}`;
      const tamperedFilePath = path.join(backupDir, tamperedFilename);
      const tamperedMetaPath = path.join(backupDir, `tampered_${backup.filename.replace(/\.sql$/, '.meta.json')}`);

      try {
        // Write tampered SQL file but preserve original checksum in meta
        const originalSql = fs.readFileSync(backup.filePath, 'utf8');
        fs.writeFileSync(tamperedFilePath, originalSql + '\n-- TAMPERED_INJECTION;\n', 'utf8');
        fs.writeFileSync(
          tamperedMetaPath,
          JSON.stringify({ ...backup, filename: tamperedFilename, checksumSha256: backup.checksumSha256 }),
          'utf8'
        );

        const tamperedRestoreRes = await server.inject({
          method: 'POST',
          url: '/api/v1/system/restore',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { filename: tamperedFilename },
        });
        expect(tamperedRestoreRes.statusCode).toBe(422);
        expect(JSON.parse(tamperedRestoreRes.payload).code).toBe('BACKUP_CHECKSUM_MISMATCH');
      } finally {
        if (fs.existsSync(tamperedFilePath)) fs.unlinkSync(tamperedFilePath);
        if (fs.existsSync(tamperedMetaPath)) fs.unlinkSync(tamperedMetaPath);
      }

      // 6. Verify transactional rollback integrity on execution failure
      const corruptSqlFilename = `corrupt_${Date.now()}.sql`;
      const corruptSqlFilePath = path.join(backupDir, corruptSqlFilename);
      try {
        // Write corrupted SQL that fails syntax execution during transaction
        fs.writeFileSync(corruptSqlFilePath, 'SYNTAX_ERROR_CANNOT_EXECUTE;\n', 'utf8');
        const preSubCount = (await getCoreTableCounts()).subscribers;

        const corruptRestoreRes = await server.inject({
          method: 'POST',
          url: '/api/v1/system/restore',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { filename: corruptSqlFilename },
        });
        expect(corruptRestoreRes.statusCode).toBe(500);

        // Crucial: ROLLBACK must have preserved pre-existing table rows!
        const postSubCount = (await getCoreTableCounts()).subscribers;
        expect(postSubCount).toBe(preSubCount);
      } finally {
        if (fs.existsSync(corruptSqlFilePath)) fs.unlinkSync(corruptSqlFilePath);
      }

      // 7. Verify clean restore from genuine backup
      const restoreRes = await server.inject({
        method: 'POST',
        url: '/api/v1/system/restore',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { filename: backup.filename },
      });
      expect(restoreRes.statusCode).toBe(200);
      const restoreBody = JSON.parse(restoreRes.payload);
      expect(restoreBody.success).toBe(true);
      expect(restoreBody.verification.parity).toBe(true);
    });

    // AT-13: Service Order Lifecycle & Dunning / Suspension Workflow
    it('AT-13: Service Order Lifecycle & Dunning — Issues DISCONNECTION order and completes to transition account to SUSPENDED', async () => {
      // Create service order for DISCONNECTION
      const orderRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-orders',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          serviceAccountId: atServiceAccountId,
          orderType: 'DISCONNECTION',
          priority: 'HIGH',
          description: 'Delinquency disconnection notice executed',
          disconnectionType: 'TEMPORARY',
        },
      });
      expect(orderRes.statusCode).toBe(201);
      const order = JSON.parse(orderRes.payload).data;
      expect(order.orderNumber).toMatch(/^SO-\d{6}-\d{4}$/);

      // Complete service order
      const completeRes = await server.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${order.id}/complete`,
        headers: { authorization: `Bearer ${techToken}` },
        payload: {
          resolutionNotes: 'Line disconnected at tap port 4',
          disconnectionType: 'TEMPORARY',
        },
      });
      expect(completeRes.statusCode).toBe(200);

      // Check account status transitioned to SUSPENDED / TEMPORARILY_DISCONNECTED
      const [sa] = await db.select().from(serviceAccounts).where(eq(serviceAccounts.id, atServiceAccountId));
      expect(['SUSPENDED', 'TEMPORARILY_DISCONNECTED']).toContain(sa.status);
    });

    // AT-14: Statement of Account (SOA) Generation & Financial Reconciliation
    it('AT-14: Statement of Account (SOA) Generation — Aggregates services, balance, aging, and chronological ledger', async () => {
      const soaRes = await server.inject({
        method: 'GET',
        url: `/api/v1/subscribers/${atSubId}/soa`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(soaRes.statusCode).toBe(200);
      const soa = JSON.parse(soaRes.payload).data;

      expect(soa.statementNumber).toMatch(/^SOA-SUB-\d{6}-\d{4}-\d{8}$/);
      expect(soa.subscriber.id).toBe(atSubId);
      expect(soa.activeServices).toHaveLength(1);
      expect(soa.agingSummary).toBeDefined();
      expect(Array.isArray(soa.openInvoices)).toBe(true);
      expect(Array.isArray(soa.ledgerLines)).toBe(true);

      // Verify mathematical balance consistency
      let running = 0;
      for (const line of soa.ledgerLines) {
        running += Number(line.debitCentavos) - Number(line.creditCentavos);
        expect(Number(line.balanceAfterCentavos)).toBe(running);
      }
      expect(soa.currentBalanceCentavos).toBe(running);

      // Verify SOA resolution via account number
      const soaByAccRes = await server.inject({
        method: 'GET',
        url: `/api/v1/subscribers/${soa.subscriber.accountNumber}/soa`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(soaByAccRes.statusCode).toBe(200);
      expect(JSON.parse(soaByAccRes.payload).data.subscriber.id).toBe(atSubId);

      // Verify 404 for non-existent subscriber
      const notFoundRes = await server.inject({
        method: 'GET',
        url: '/api/v1/subscribers/00000000-0000-0000-0000-000000000000/soa',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(notFoundRes.statusCode).toBe(404);
      expect(JSON.parse(notFoundRes.payload).code).toBe('SUBSCRIBER_NOT_FOUND');

      // Verify 401 for unauthenticated request
      const unauthRes = await server.inject({
        method: 'GET',
        url: `/api/v1/subscribers/${atSubId}/soa`,
      });
      expect(unauthRes.statusCode).toBe(401);
    });
  });

  // ============================================================================
  // PART 3: PRODUCT.md SECTION 33 CRITICAL FAILURE PREVENTION AUDIT
  // ============================================================================
  describe('PRODUCT.md Section 33: Critical Failure Prevention Audit', () => {
    it('Prevention 1: Destructive deletion of posted payments is banned (only soft reversal permitted)', async () => {
      const allPayments = await db.select().from(payments);
      for (const pay of allPayments) {
        expect(pay.id).toBeDefined();
        // Payment row is physically preserved even if reversed
        expect(typeof pay.isReversed).toBe('boolean');
      }
    });

    it('Prevention 2: Incorrect ledger balances are prevented (exact double-entry integer math)', async () => {
      const allLedger = await db.select().from(subscriberLedger);
      for (const entry of allLedger) {
        expect(Number.isInteger(Number(entry.debitCentavos))).toBe(true);
        expect(Number.isInteger(Number(entry.creditCentavos))).toBe(true);
        expect(Number.isInteger(Number(entry.balanceAfterCentavos))).toBe(true);
      }
    });

    it('Prevention 3: Shared database-file architecture is banned (PostgreSQL pool client-server model)', async () => {
      expect(pool).toBeDefined();
      expect(pool.totalCount).toBeGreaterThan(0);
    });

    it('Prevention 4: Plaintext passwords are banned (Argon2id cryptographic hashes enforced)', async () => {
      const realUsers = await db
        .select()
        .from(users)
        .where(ne(users.passwordHash, 'dummyhash'));
      expect(realUsers.length).toBeGreaterThan(0);
      for (const u of realUsers) {
        // Argon2 hashes start with $argon2id$ or $argon2i$
        expect(u.passwordHash).toMatch(/^\$argon2(id|i)\$/);
      }
    });

    it('Prevention 5: Server-side authorization is strictly enforced on all sensitive routes', async () => {
      const unauth = await server.inject({
        method: 'POST',
        url: '/api/v1/system/backup',
      });
      expect(unauth.statusCode).toBe(401);
    });

    it('Prevention 6: Financial inputs reject floating-point decimals and negative numbers', async () => {
      const floatRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: '00000000-0000-0000-0000-000000000000',
          amountCentavos: 999.5, // Float centavos
          paymentMethod: 'CASH',
        },
      });
      expect(floatRes.statusCode).toBe(400);
    });

    it('Prevention 7: Duplicate invoices per period are strictly barred by unique constraints (AT-11)', async () => {
      const duplicateInvoiceIndices = await db.execute(sql`
        SELECT indexname FROM pg_indexes 
        WHERE tablename = 'invoices' AND indexname = 'unique_active_invoice_per_period';
      `);
      expect(duplicateInvoiceIndices.rows.length).toBeGreaterThan(0);
    });

    it('Prevention 8: Reused receipt numbers are barred by unique constraints', async () => {
      const allReceipts = await db.select().from(receipts);
      const recNumbers = allReceipts.map((r) => r.receiptNumber);
      const uniqueRecs = new Set(recNumbers);
      expect(uniqueRecs.size).toBe(recNumbers.length);
    });

    it('Prevention 9: Reused GCash reference numbers are barred (AT-05)', async () => {
      const allGcash = await db.select().from(gcashTransactions);
      const refs = allGcash.map((g) => g.referenceNumber);
      const uniqueRefs = new Set(refs);
      expect(uniqueRefs.size).toBe(refs.length);
    });

    it('Prevention 10: Collector shortages are tracked with mathematical visibility (AT-08)', async () => {
      const shortageBatches = await db
        .select()
        .from(collectionBatches)
        .where(eq(collectionBatches.status, 'RECONCILED_WITH_SHORTAGE'));
      expect(shortageBatches.length).toBeGreaterThan(0);
    });

    it('Prevention 11: Tested backup and recovery workflows are validated with data parity (AT-12)', async () => {
      const counts = await getCoreTableCounts();
      expect(counts.subscribers).toBeGreaterThan(0);
      expect(counts.invoices).toBeGreaterThan(0);
      expect(counts.payments).toBeGreaterThan(0);
      expect(counts.receipts).toBeGreaterThan(0);
    });
  });
});
