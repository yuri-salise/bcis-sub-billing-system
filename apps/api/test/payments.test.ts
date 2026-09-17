import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { db } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import {
  payments,
  paymentAllocations,
  receipts,
  paymentReversals,
  gcashTransactions,
  collectionBatches,
  collectionAreas,
  invoices,
  invoiceItems,
  subscriberAddresses,
  subscribers,
  serviceAccounts,
  servicePlans,
  subscriberLedger,
  users,
  auditLogs,
} from '../src/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { InvoiceStatus, PaymentMethod } from '@bcis/shared-types';

describe('Payments, FIFO Allocation, Receipts, GCash & Remittance Engine (Phase 5)', () => {
  let server: FastifyInstance;
  let adminToken: string;
  let cashierToken: string;
  let accountingToken: string;
  let supervisorToken: string;
  let viewerToken: string;

  let testSubscriberId: string;
  let testPlanId: string;
  let testServiceAccountId: string;

  beforeAll(async () => {
    await seedDatabase();

    // Clean up test data from prior runs
    await db.delete(paymentReversals);
    await db.delete(receipts);
    await db.delete(paymentAllocations);
    await db.delete(payments);
    await db.delete(gcashTransactions);
    await db.delete(collectionBatches);
    await db.delete(collectionAreas);
    await db.delete(invoiceItems);
    await db.delete(invoices);
    await db.delete(subscriberLedger);
    await db.delete(serviceAccounts);
    await db.delete(subscriberAddresses);
    await db.delete(subscribers);

    server = buildServer();
    await server.ready();

    // 1. Log in Admin (Super Admin)
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

    // 3. Create or find Accounting, Supervisor, and Viewer users in DB
    const findOrCreateUser = async (username: string, fullName: string, email: string) => {
      const [existing] = await db.select().from(users).where(eq(users.username, username));
      if (existing) return existing;
      const [created] = await db
        .insert(users)
        .values({
          username,
          passwordHash: 'dummyhash',
          fullName,
          email,
          isActive: true,
        })
        .returning();
      return created;
    };

    const accountingUser = await findOrCreateUser('accounting_test', 'Accounting Officer', 'accounting@bcis.local');
    const supervisorUser = await findOrCreateUser('supervisor_test', 'Collection Supervisor', 'supervisor@bcis.local');
    const viewerUser = await findOrCreateUser('viewer_test', 'Trainee Viewer', 'viewer@bcis.local');

    // Create demo collection area if not existing
    const [existingArea] = await db.select().from(collectionAreas).where(eq(collectionAreas.name, 'Malaybalay Central Area'));
    const area = existingArea || (await db
      .insert(collectionAreas)
      .values({
        name: 'Malaybalay Central Area',
        description: 'Poblacion collection sector',
      })
      .returning())[0];

    // 4. Issue Tokens
    accountingToken = server.jwt.sign({
      id: accountingUser.id,
      username: accountingUser.username,
      fullName: accountingUser.fullName,
      roles: ['ROLE_ACCOUNTING'],
      permissions: ['payments.reverse', 'payment.reverse', 'payments.read', 'payment.view', 'remittances.manage', 'collection.reconcile'],
    });

    supervisorToken = server.jwt.sign({
      id: supervisorUser.id,
      username: supervisorUser.username,
      fullName: supervisorUser.fullName,
      roles: ['ROLE_COLLECTION_SUPV'],
      permissions: ['remittances.manage', 'collection.reconcile', 'collection.batch_create', 'collection.view'],
    });

    viewerToken = server.jwt.sign({
      id: viewerUser.id,
      username: viewerUser.username,
      fullName: viewerUser.fullName,
      roles: ['ROLE_VIEWER'],
      permissions: ['payments.read', 'payment.view', 'billing.view', 'collection.view', 'receipt.view'],
    });

    // 5. Create Base Plan (₱999.00 / mo)
    const planRes = await server.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Fiber Standard 50 Mbps',
        serviceType: 'INTERNET',
        monthlyFeeCentavos: 99900,
      },
    });
    const planData = JSON.parse(planRes.payload).data;
    testPlanId = planData.id;

    // 6. Create Base Subscriber
    const subRes = await server.inject({
      method: 'POST',
      url: '/api/v1/subscribers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        firstName: 'Maria',
        lastName: 'Santos',
        contactNumber: '09179876543',
        streetAddress: 'Poblacion Road',
        barangay: 'Barangay 1',
        municipality: 'Malaybalay',
      },
    });
    const subData = JSON.parse(subRes.payload).data;
    testSubscriberId = subData.id;

    // 7. Create Service Account
    const saRes = await server.inject({
      method: 'POST',
      url: '/api/v1/service-accounts',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        subscriberId: testSubscriberId,
        servicePlanId: testPlanId,
        status: 'ACTIVE',
        activationDate: '2026-01-01',
        billingDayOfMonth: 1,
        currentRateCentavos: 99900,
        streetAddress: 'Poblacion Road',
        barangay: 'Barangay 1',
      },
    });
    testServiceAccountId = JSON.parse(saRes.payload).data.id;
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  // ============================================================================
  // AT-01: Exact Payment
  // ============================================================================
  describe('AT-01: Exact Payment', () => {
    let invoiceId: string;
    let invoiceNumber: string;

    beforeAll(async () => {
      // Generate ₱999.00 invoice
      const invRes = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: testServiceAccountId,
          billingPeriodStart: '2026-05-01',
          billingPeriodEnd: '2026-05-31',
          issueDate: '2026-05-01',
          dueDate: '2026-05-16',
        },
      });
      const invData = JSON.parse(invRes.payload).data;
      invoiceId = invData.id;
      invoiceNumber = invData.invoiceNumber;
    });

    it('posts exact payment of ₱999.00: marks invoice PAID, zeroes balance, creates receipt, balances ledger', async () => {
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: testSubscriberId,
          amountCentavos: 99900,
          paymentMethod: 'CASH',
          notes: 'Counter exact payment for May 2026',
        },
      });

      expect(payRes.statusCode).toBe(201);
      const resBody = JSON.parse(payRes.payload);
      expect(resBody.success).toBe(true);

      const payment = resBody.data;
      expect(payment.amountCentavos).toBe(99900);
      expect(payment.paymentMethod).toBe('CASH');
      expect(payment.isReversed).toBe(false);

      // Verify Official Receipt generated
      expect(payment.receipt).toBeDefined();
      expect(payment.receipt.receiptNumber).toMatch(/^OR-\d{6}-\d{4}$/);
      expect(payment.receipt.status).toBe('ISSUED');
      expect(payment.receipt.totalAmountCentavos).toBe(99900);

      // Verify Allocation
      expect(payment.allocations).toHaveLength(1);
      const alloc = payment.allocations[0];
      expect(alloc.invoiceId).toBe(invoiceId);
      expect(alloc.allocatedAmountCentavos).toBe(99900);
      expect(alloc.newRemainingBalanceCentavos).toBe(0);
      expect(alloc.newStatus).toBe(InvoiceStatus.PAID);

      // Verify Invoice in DB
      const [updatedInv] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId));

      expect(updatedInv.status).toBe('PAID');
      expect(updatedInv.remainingBalanceCentavos).toBe(0);
      expect(updatedInv.allocatedCentavos).toBe(99900);

      // Verify Subscriber Ledger has payment credit
      const ledgerEntries = await db
        .select()
        .from(subscriberLedger)
        .where(
          and(
            eq(subscriberLedger.subscriberId, testSubscriberId),
            eq(subscriberLedger.entryType, 'PAYMENT')
          )
        );

      expect(ledgerEntries.length).toBeGreaterThanOrEqual(1);
      const lastEntry = ledgerEntries[ledgerEntries.length - 1];
      expect(lastEntry.creditCentavos).toBe(99900);
      expect(lastEntry.debitCentavos).toBe(0);
      // Double entry balance: invoice was +99900, payment was -99900 -> net balance 0
      expect(lastEntry.balanceAfterCentavos).toBe(0);
    });
  });

  // ============================================================================
  // AT-02: Partial Payment
  // ============================================================================
  describe('AT-02: Partial Payment', () => {
    let invoiceId: string;

    beforeAll(async () => {
      // Generate ₱999.00 invoice for June 2026
      const invRes = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: testServiceAccountId,
          billingPeriodStart: '2026-06-01',
          billingPeriodEnd: '2026-06-30',
          issueDate: '2026-06-01',
          dueDate: '2026-06-16',
        },
      });
      invoiceId = JSON.parse(invRes.payload).data.id;
    });

    it('posts partial payment of ₱500.00: sets remaining balance to ₱499.00 and status PARTIALLY_PAID', async () => {
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: testSubscriberId,
          amountCentavos: 50000,
          paymentMethod: 'CASH',
          notes: 'Partial payment ₱500',
        },
      });

      expect(payRes.statusCode).toBe(201);
      const resBody = JSON.parse(payRes.payload);
      const payment = resBody.data;

      expect(payment.amountCentavos).toBe(50000);
      expect(payment.allocations).toHaveLength(1);
      expect(payment.allocations[0].allocatedAmountCentavos).toBe(50000);
      expect(payment.allocations[0].newRemainingBalanceCentavos).toBe(49900);
      expect(payment.allocations[0].newStatus).toBe(InvoiceStatus.PARTIALLY_PAID);

      // Verify DB invoice record
      const [inv] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId));

      expect(inv.status).toBe('PARTIALLY_PAID');
      expect(inv.allocatedCentavos).toBe(50000);
      expect(inv.remainingBalanceCentavos).toBe(49900);
    });
  });

  // ============================================================================
  // AT-03: Advance Payment / Overpayment
  // ============================================================================
  describe('AT-03: Advance Payment', () => {
    let freshSubId: string;
    let freshSaId: string;
    let invoiceId: string;

    beforeAll(async () => {
      // Create separate subscriber to verify advance balance isolation
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Carlos',
          lastName: 'Garcia',
          contactNumber: '09201234567',
          streetAddress: 'Fortich St',
          barangay: 'Barangay 2',
        },
      });
      freshSubId = JSON.parse(subRes.payload).data.id;

      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: freshSubId,
          servicePlanId: testPlanId,
          status: 'ACTIVE',
          activationDate: '2026-01-01',
          billingDayOfMonth: 1,
          currentRateCentavos: 100000,
          streetAddress: 'Fortich St',
          barangay: 'Barangay 2',
        },
      });
      freshSaId = JSON.parse(saRes.payload).data.id;

      // Generate single ₱1,000.00 bill
      const invRes = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: freshSaId,
          billingPeriodStart: '2026-07-01',
          billingPeriodEnd: '2026-07-31',
          issueDate: '2026-07-01',
          dueDate: '2026-07-16',
        },
      });
      invoiceId = JSON.parse(invRes.payload).data.id;
    });

    it('receives ₱3,000 payment for ₱1,000 bill: settles invoice and adds ₱2,000 to advanceCreditCentavos', async () => {
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: freshSubId,
          amountCentavos: 300000, // ₱3,000
          paymentMethod: 'CASH',
          notes: 'Advance quarterly payment',
        },
      });

      expect(payRes.statusCode).toBe(201);
      const resBody = JSON.parse(payRes.payload);
      const payment = resBody.data;

      expect(payment.amountCentavos).toBe(300000);
      expect(payment.advanceCreditAddedCentavos).toBe(200000);
      expect(payment.subscriberAdvanceCreditCentavos).toBe(200000);

      // Verify invoice is completely PAID
      const [inv] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId));
      expect(inv.status).toBe('PAID');
      expect(inv.remainingBalanceCentavos).toBe(0);
      expect(inv.allocatedCentavos).toBe(100000);

      // Verify subscriber advanceCreditCentavos in DB
      const [sub] = await db
        .select()
        .from(subscribers)
        .where(eq(subscribers.id, freshSubId));
      expect(sub.advanceCreditCentavos).toBe(200000);

      // Verify subscriber running ledger balance is -₱2,000 (credit in customer's favor)
      const ledger = await db
        .select()
        .from(subscriberLedger)
        .where(eq(subscriberLedger.subscriberId, freshSubId))
        .orderBy(subscriberLedger.createdAt);

      const lastEntry = ledger[ledger.length - 1];
      expect(lastEntry.balanceAfterCentavos).toBe(-200000);
    });
  });

  // ============================================================================
  // AT-04: Oldest-First (FIFO) Allocation
  // ============================================================================
  describe('AT-04: Oldest-First FIFO Allocation across Multiple Invoices', () => {
    let fifoSubId: string;
    let fifoSaId: string;
    let augustInvoiceId: string;
    let septemberInvoiceId: string;

    beforeAll(async () => {
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Elena',
          lastName: 'Reyes',
          contactNumber: '09351234567',
          streetAddress: 'Magsaysay St',
          barangay: 'Barangay 3',
        },
      });
      fifoSubId = JSON.parse(subRes.payload).data.id;

      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: fifoSubId,
          servicePlanId: testPlanId,
          status: 'ACTIVE',
          activationDate: '2026-01-01',
          billingDayOfMonth: 1,
          currentRateCentavos: 99900,
          streetAddress: 'Magsaysay St',
          barangay: 'Barangay 3',
        },
      });
      fifoSaId = JSON.parse(saRes.payload).data.id;

      // Invoice 1: August (Due 2026-08-15) - ₱999.00
      const augRes = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: fifoSaId,
          billingPeriodStart: '2026-08-01',
          billingPeriodEnd: '2026-08-31',
          issueDate: '2026-08-01',
          dueDate: '2026-08-15',
        },
      });
      augustInvoiceId = JSON.parse(augRes.payload).data.id;

      // Invoice 2: September (Due 2026-09-15) - ₱999.00
      const sepRes = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: fifoSaId,
          billingPeriodStart: '2026-09-01',
          billingPeriodEnd: '2026-09-30',
          issueDate: '2026-09-01',
          dueDate: '2026-09-15',
        },
      });
      septemberInvoiceId = JSON.parse(sepRes.payload).data.id;
    });

    it('allocates ₱1,200 payment: August becomes ₱0 (PAID), September becomes ₱798 remaining (PARTIALLY_PAID)', async () => {
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: fifoSubId,
          amountCentavos: 120000, // ₱1,200.00
          paymentMethod: 'CASH',
          notes: 'FIFO allocation test payment',
        },
      });

      expect(payRes.statusCode).toBe(201);
      const resBody = JSON.parse(payRes.payload);
      const payment = resBody.data;

      expect(payment.allocations).toHaveLength(2);

      // Allocation 1: August invoice (oldest first)
      const allocAug = payment.allocations.find((a: any) => a.invoiceId === augustInvoiceId);
      expect(allocAug).toBeDefined();
      expect(allocAug.allocatedAmountCentavos).toBe(99900);
      expect(allocAug.newRemainingBalanceCentavos).toBe(0);
      expect(allocAug.newStatus).toBe(InvoiceStatus.PAID);

      // Allocation 2: September invoice
      const allocSep = payment.allocations.find((a: any) => a.invoiceId === septemberInvoiceId);
      expect(allocSep).toBeDefined();
      expect(allocSep.allocatedAmountCentavos).toBe(20100);
      expect(allocSep.newRemainingBalanceCentavos).toBe(79800); // 99900 - 20100 = 79800 (₱798.00)
      expect(allocSep.newStatus).toBe(InvoiceStatus.PARTIALLY_PAID);

      // Verify Database Invoices
      const [dbAug] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, augustInvoiceId));
      expect(dbAug.status).toBe('PAID');
      expect(dbAug.remainingBalanceCentavos).toBe(0);

      const [dbSep] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, septemberInvoiceId));
      expect(dbSep.status).toBe('PARTIALLY_PAID');
      expect(dbSep.remainingBalanceCentavos).toBe(79800);
    });
  });

  // ============================================================================
  // AT-05: Duplicate GCash Reference Rejection
  // ============================================================================
  describe('AT-05: GCash Intake & Duplicate Reference Rejection', () => {
    const referenceNumber = '9012345678901';

    it('submits initial GCash transaction successfully into intake queue', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/gcash/intake',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          referenceNumber,
          subscriberId: testSubscriberId,
          senderName: 'Pedro Penduko',
          senderPhone: '09171112233',
          amountCentavos: 99900,
          proofImagePath: 'uploads/proofs/gcash_9012345678901.jpg',
        },
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.payload).data;
      expect(data.referenceNumber).toBe(referenceNumber);
      expect(data.status).toBe('PENDING_VERIFICATION');
    });

    it('rejects duplicate GCash submission with HTTP 409 Conflict', async () => {
      const duplicateRes = await server.inject({
        method: 'POST',
        url: '/api/v1/gcash/intake',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          referenceNumber,
          subscriberId: testSubscriberId,
          senderName: 'Fraud Attempt',
          senderPhone: '09179998877',
          amountCentavos: 99900,
          proofImagePath: 'uploads/proofs/fake.jpg',
        },
      });

      expect(duplicateRes.statusCode).toBe(409);
      const err = JSON.parse(duplicateRes.payload);
      expect(err.code).toBe('DUPLICATE_GCASH_REFERENCE');
    });

    it('lists pending submission in GCash verification queue', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/gcash/queue',
        headers: { authorization: `Bearer ${cashierToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toBeInstanceOf(Array);
      const found = body.data.find((tx: any) => tx.referenceNumber === referenceNumber);
      expect(found).toBeDefined();
      expect(found.status).toBe('PENDING_VERIFICATION');
    });

    it('verifies pending GCash transaction: creates payment, receipt, and marks VERIFIED', async () => {
      const queueRes = await server.inject({
        method: 'GET',
        url: '/api/v1/gcash/queue',
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      const tx = JSON.parse(queueRes.payload).data.find(
        (item: any) => item.referenceNumber === referenceNumber
      );

      const verifyRes = await server.inject({
        method: 'POST',
        url: `/api/v1/gcash/${tx.id}/verify`,
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          notes: 'Legitimate GCash receipt confirmed with SMS',
        },
      });

      expect(verifyRes.statusCode).toBe(200);
      const body = JSON.parse(verifyRes.payload);
      expect(body.gcash.status).toBe('VERIFIED');
      expect(body.payment).toBeDefined();
      expect(body.payment.paymentMethod).toBe('GCASH');
      expect(body.payment.referenceNumber).toBe(referenceNumber);

      // Verify cannot verify twice
      const secondVerify = await server.inject({
        method: 'POST',
        url: `/api/v1/gcash/${tx.id}/verify`,
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(secondVerify.statusCode).toBe(400);
    });

    it('rejects duplicate posting attempt for already processed GCash reference', async () => {
      const directPayRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: testSubscriberId,
          amountCentavos: 99900,
          paymentMethod: 'GCASH',
          referenceNumber, // Already used above
        },
      });

      expect(directPayRes.statusCode).toBe(409);
      expect(JSON.parse(directPayRes.payload).code).toBe('DUPLICATE_REFERENCE_NUMBER');
    });

    it('rejects a fake GCash submission with documented reason', async () => {
      const intakeRes = await server.inject({
        method: 'POST',
        url: '/api/v1/gcash/intake',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          referenceNumber: '8888888888888',
          subscriberId: testSubscriberId,
          senderName: 'Bad Screenshot',
          senderPhone: '09170001122',
          amountCentavos: 50000,
          proofImagePath: 'uploads/proofs/bad.jpg',
        },
      });
      const fakeTxId = JSON.parse(intakeRes.payload).data.id;

      const rejectRes = await server.inject({
        method: 'POST',
        url: `/api/v1/gcash/${fakeTxId}/reject`,
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          reason: 'Screenshot is blurry and reference does not match gateway',
        },
      });

      expect(rejectRes.statusCode).toBe(200);
      const body = JSON.parse(rejectRes.payload);
      expect(body.gcash.status).toBe('REJECTED');
      expect(body.gcash.rejectionReason).toContain('blurry');
    });
  });

  // ============================================================================
  // AT-06: Payment Reversal Workflow
  // ============================================================================
  describe('AT-06: Payment Reversal', () => {
    let reversalSubId: string;
    let reversalSaId: string;
    let invoiceId: string;
    let paymentId: string;

    beforeAll(async () => {
      // Create dedicated subscriber
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Rosa',
          lastName: 'Alcantara',
          contactNumber: '09172223344',
          streetAddress: 'Rivera St',
          barangay: 'Barangay 4',
        },
      });
      reversalSubId = JSON.parse(subRes.payload).data.id;

      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: reversalSubId,
          servicePlanId: testPlanId,
          status: 'ACTIVE',
          activationDate: '2026-01-01',
          billingDayOfMonth: 1,
          currentRateCentavos: 99900,
          streetAddress: 'Rivera St',
          barangay: 'Barangay 4',
        },
      });
      reversalSaId = JSON.parse(saRes.payload).data.id;

      // Issue ₱999.00 invoice
      const invRes = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: reversalSaId,
          billingPeriodStart: '2026-10-01',
          billingPeriodEnd: '2026-10-31',
          issueDate: '2026-10-01',
          dueDate: '2026-10-15',
        },
      });
      invoiceId = JSON.parse(invRes.payload).data.id;

      // Post ₱500.00 payment (leaving balance ₱499.00, PARTIALLY_PAID)
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: reversalSubId,
          amountCentavos: 50000,
          paymentMethod: 'CHECK',
          referenceNumber: 'CHK-998811',
          notes: 'Check payment subject to clearing',
        },
      });
      paymentId = JSON.parse(payRes.payload).data.id;
    });

    it('enforces RBAC: Cashier cannot reverse payment (HTTP 403 Forbidden)', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${paymentId}/reverse`,
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          reason: 'Cashier trying to reverse without accounting privileges',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('executes payment reversal by Accounting: restores invoice balance, voids receipt, records reversal', async () => {
      const reverseRes = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${paymentId}/reverse`,
        headers: { authorization: `Bearer ${accountingToken}` },
        payload: {
          reason: 'Bounced Check / Bank Chargeback (Dishonored check CHK-998811)',
        },
      });

      expect(reverseRes.statusCode).toBe(200);
      const body = JSON.parse(reverseRes.payload);
      expect(body.success).toBe(true);

      // Verify payment marked reversed but remains in DB (Rule 11/12)
      expect(body.payment.isReversed).toBe(true);
      const [dbPayment] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId));
      expect(dbPayment).toBeDefined();
      expect(dbPayment.isReversed).toBe(true);

      // Verify receipt status is REVERSED
      const [dbReceipt] = await db
        .select()
        .from(receipts)
        .where(eq(receipts.paymentId, paymentId));
      expect(dbReceipt.status).toBe('REVERSED');

      // Verify invoice balance restored from ₱499 back to ₱999, status restored to UNPAID
      const [dbInv] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId));
      expect(dbInv.remainingBalanceCentavos).toBe(99900);
      expect(dbInv.allocatedCentavos).toBe(0);
      expect(dbInv.status).toBe('UNPAID');

      // Verify payment reversal record exists
      expect(body.reversal).toBeDefined();
      expect(body.reversal.reason).toContain('Bounced Check');

      // Verify Subscriber Ledger has PAYMENT_REVERSAL entry
      const ledgerEntries = await db
        .select()
        .from(subscriberLedger)
        .where(
          and(
            eq(subscriberLedger.subscriberId, reversalSubId),
            eq(subscriberLedger.entryType, 'PAYMENT_REVERSAL')
          )
        );
      expect(ledgerEntries.length).toBe(1);
      expect(ledgerEntries[0].debitCentavos).toBe(50000);
      expect(ledgerEntries[0].creditCentavos).toBe(0);

      // Verify Audit Log entry created
      const logs = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, paymentId),
            eq(auditLogs.action, 'PAYMENT_REVERSED')
          )
        );
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].reason).toContain('Bounced Check');
    });

    it('rejects reversing an already reversed payment (HTTP 400)', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${paymentId}/reverse`,
        headers: { authorization: `Bearer ${accountingToken}` },
        payload: {
          reason: 'Attempting duplicate reversal',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).code).toBe('ALREADY_REVERSED');
    });
  });

  // ============================================================================
  // AT-07 & AT-08: Remittance Reconciliation
  // ============================================================================
  describe('AT-07 & AT-08: Batch Remittance Reconciliation', () => {
    let collectorUserId: string;
    let balancedBatchId: string;
    let shortageBatchId: string;

    beforeAll(async () => {
      // Find cashier or admin user to serve as collector
      const cashierUser = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, 'cashier'))
        .limit(1);
      collectorUserId = cashierUser[0].id;

      // 1. Create Batch #101 for AT-07 (₱20,000 expected)
      const b1 = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/batches',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          batchNumber: 'BAT-202609-0101',
          collectorId: collectorUserId,
          expectedCashCentavos: 2000000, // ₱20,000.00
        },
      });
      balancedBatchId = JSON.parse(b1.payload).data.id;

      // 2. Create Batch #102 for AT-08 (₱20,000 expected)
      const b2 = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/batches',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          batchNumber: 'BAT-202609-0102',
          collectorId: collectorUserId,
          expectedCashCentavos: 2000000, // ₱20,000.00
        },
      });
      shortageBatchId = JSON.parse(b2.payload).data.id;
    });

    // AT-07 Balanced Collector Remittance
    it('AT-07: Balanced Remittance (Collected ₱20,000, Remitted ₱20,000 -> Diff ₱0, RECONCILED and CLOSED)', async () => {
      const reconRes = await server.inject({
        method: 'POST',
        url: `/api/v1/collections/batches/${balancedBatchId}/reconcile`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          remittedCashCentavos: 2000000, // ₱20,000.00
          supervisorNotes: 'Cash count verified in counter drawer',
        },
      });

      expect(reconRes.statusCode).toBe(200);
      const body = JSON.parse(reconRes.payload);
      expect(body.reconciliation.differenceCentavos).toBe(0);
      expect(body.reconciliation.isBalanced).toBe(true);
      expect(body.batch.status).toBe('RECONCILED');

      // Formally close balanced batch
      const closeRes = await server.inject({
        method: 'POST',
        url: `/api/v1/collections/batches/${balancedBatchId}/close`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: { reason: 'Balanced day-end closure' },
      });

      expect(closeRes.statusCode).toBe(200);
      expect(JSON.parse(closeRes.payload).data.status).toBe('CLOSED');
    });

    // AT-08 Collector Shortage
    it('AT-08: Collector Shortage (Collected ₱20,000, Remitted ₱19,500 -> Shortage ₱500, RECONCILED_WITH_SHORTAGE)', async () => {
      const reconRes = await server.inject({
        method: 'POST',
        url: `/api/v1/collections/batches/${shortageBatchId}/reconcile`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          remittedCashCentavos: 1950000, // ₱19,500.00 (₱500 shortage)
          supervisorNotes: '₱500 shortage acknowledged by collector',
        },
      });

      expect(reconRes.statusCode).toBe(200);
      const body = JSON.parse(reconRes.payload);
      expect(body.reconciliation.differenceCentavos).toBe(50000); // ₱500.00
      expect(body.reconciliation.isShortage).toBe(true);
      expect(body.reconciliation.isBalanced).toBe(false);
      expect(body.batch.status).toBe('RECONCILED_WITH_SHORTAGE');

      // Verify shortage audit log recorded
      const logs = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, shortageBatchId),
            eq(auditLogs.action, 'REMITTANCE_SHORTAGE_DETECTED')
          )
        );
      expect(logs.length).toBeGreaterThanOrEqual(1);

      // Verify AT-08 requirement: Do not silently close as balanced
      const silentCloseAttempt = await server.inject({
        method: 'POST',
        url: `/api/v1/collections/batches/${shortageBatchId}/close`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: { reason: 'Trying to silently close' },
      });

      expect(silentCloseAttempt.statusCode).toBe(400);
      expect(JSON.parse(silentCloseAttempt.payload).code).toBe('UNRESOLVED_SHORTAGE');

      // Closing with explicit supervisor force override succeeds
      const forcedCloseRes = await server.inject({
        method: 'POST',
        url: `/api/v1/collections/batches/${shortageBatchId}/close`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          force: true,
          reason: 'Supervisor signed promissory note for ₱500 shortage payroll deduction',
        },
      });

      expect(forcedCloseRes.statusCode).toBe(200);
      expect(JSON.parse(forcedCloseRes.payload).data.status).toBe('CLOSED');
    });

    // Cashier Shift End-of-Day Reconciliation
    it('reconciles counter Cashier Shift cash', async () => {
      const shiftRes = await server.inject({
        method: 'POST',
        url: '/api/v1/remittances/shift/reconcile',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          cashierId: collectorUserId,
          remittedCashCentavos: 100000,
          notes: 'End of shift drawer count',
        },
      });

      expect(shiftRes.statusCode).toBe(200);
      const res = JSON.parse(shiftRes.payload).data;
      expect(res).toHaveProperty('expectedCashCentavos');
      expect(res).toHaveProperty('differenceCentavos');
      expect(res).toHaveProperty('isBalanced');
    });
  });

  // ============================================================================
  // Payment Retrieval & Receipts
  // ============================================================================
  describe('Payment Queries & Receipts', () => {
    it('queries payments list with pagination and filtering', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/payments?limit=5&page=1',
        headers: { authorization: `Bearer ${cashierToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data).toBeInstanceOf(Array);
      expect(body.meta).toHaveProperty('total');
      expect(body.meta.page).toBe(1);
    });

    it('fetches single payment by ID with allocations and receipt details', async () => {
      const listRes = await server.inject({
        method: 'GET',
        url: '/api/v1/payments?limit=1',
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      const paymentId = JSON.parse(listRes.payload).data[0].id;

      const singleRes = await server.inject({
        method: 'GET',
        url: `/api/v1/payments/${paymentId}`,
        headers: { authorization: `Bearer ${cashierToken}` },
      });

      expect(singleRes.statusCode).toBe(200);
      const body = JSON.parse(singleRes.payload);
      expect(body.data.id).toBe(paymentId);
      expect(body.data).toHaveProperty('receipt');
      expect(body.data).toHaveProperty('allocations');
    });

    it('fetches receipt by receipt number and supports audited duplicate reprint', async () => {
      const listRes = await server.inject({
        method: 'GET',
        url: '/api/v1/payments?limit=1',
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      const receiptNumber = JSON.parse(listRes.payload).data[0].receipt.receiptNumber;

      // 1. Fetch by receipt number
      const rcptRes = await server.inject({
        method: 'GET',
        url: `/api/v1/receipts/${receiptNumber}`,
        headers: { authorization: `Bearer ${cashierToken}` },
      });

      expect(rcptRes.statusCode).toBe(200);
      const rcptBody = JSON.parse(rcptRes.payload);
      expect(rcptBody.data.receiptNumber).toBe(receiptNumber);

      // 2. Reprint receipt
      const reprintRes = await server.inject({
        method: 'POST',
        url: `/api/v1/receipts/${receiptNumber}/reprint`,
        headers: { authorization: `Bearer ${cashierToken}` },
      });

      expect(reprintRes.statusCode).toBe(200);
      const reprintBody = JSON.parse(reprintRes.payload);
      expect(reprintBody.data.isReprint).toBe(true);
    });
  });

  // ============================================================================
  // RBAC Protection Verification
  // ============================================================================
  describe('RBAC Protection & Access Control', () => {
    it('denies unauthenticated access to payments endpoints (HTTP 401)', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/payments',
      });
      expect(res.statusCode).toBe(401);
    });

    it('denies viewer from creating payments (HTTP 403 Forbidden)', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          subscriberId: testSubscriberId,
          amountCentavos: 10000,
          paymentMethod: 'CASH',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('denies cashier from managing remittances (HTTP 403 Forbidden)', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/batches',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          collectorId: testSubscriberId,
        },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ============================================================================
  // Edge Cases & High-Concurrency Robustness Suite
  // ============================================================================
  describe('Edge Cases & Concurrency Robustness', () => {
    let collectorUserId: string;

    beforeAll(async () => {
      const [cashierUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, 'cashier'))
        .limit(1);
      collectorUserId = cashierUser.id;
    });

    // 1. Case-insensitive GCash duplicate rejection
    it('rejects case-insensitive duplicate GCash reference (e.g. uppercase vs lowercase)', async () => {
      const ref = 'GCASH-CASE-TEST-1234';
      const firstRes = await server.inject({
        method: 'POST',
        url: '/api/v1/gcash/intake',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          referenceNumber: ref,
          subscriberId: testSubscriberId,
          senderName: 'Case Check Upper',
          senderPhone: '09171239999',
          amountCentavos: 50000,
          proofImagePath: 'uploads/case1.jpg',
        },
      });
      expect(firstRes.statusCode).toBe(201);

      // Attempt second submission with lowercase
      const secondRes = await server.inject({
        method: 'POST',
        url: '/api/v1/gcash/intake',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          referenceNumber: ref.toLowerCase(),
          subscriberId: testSubscriberId,
          senderName: 'Case Check Lower',
          senderPhone: '09171239999',
          amountCentavos: 50000,
          proofImagePath: 'uploads/case2.jpg',
        },
      });
      expect(secondRes.statusCode).toBe(409);
      expect(JSON.parse(secondRes.payload).code).toBe('DUPLICATE_GCASH_REFERENCE');
    });

    // 2. Direct payment checks pending GCash intake queue
    it('rejects direct payment posting if GCash reference is already pending in intake queue', async () => {
      const ref = 'GCASH-PENDING-CHECK-555';
      const intakeRes = await server.inject({
        method: 'POST',
        url: '/api/v1/gcash/intake',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          referenceNumber: ref,
          subscriberId: testSubscriberId,
          senderName: 'Pending Sender',
          senderPhone: '09171235555',
          amountCentavos: 50000,
          proofImagePath: 'uploads/pending.jpg',
        },
      });
      expect(intakeRes.statusCode).toBe(201);

      // Direct payment posting with same reference
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: testSubscriberId,
          amountCentavos: 50000,
          paymentMethod: 'GCASH',
          referenceNumber: ref,
        },
      });
      expect(payRes.statusCode).toBe(409);
      expect(JSON.parse(payRes.payload).code).toBe('DUPLICATE_GCASH_REFERENCE');
    });

    // 3. Multi-invoice payment reversal
    it('correctly reverses a multi-invoice FIFO payment (restores all affected invoices)', async () => {
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Multi',
          lastName: 'Reversal',
          contactNumber: '09178887777',
          streetAddress: 'Multi St',
          barangay: 'Barangay 5',
        },
      });
      const subId = JSON.parse(subRes.payload).data.id;

      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          subscriberId: subId,
          servicePlanId: testPlanId,
          status: 'ACTIVE',
          activationDate: '2026-01-01',
          billingDayOfMonth: 1,
          currentRateCentavos: 99900,
          streetAddress: 'Multi St',
          barangay: 'Barangay 5',
        },
      });
      const saId = JSON.parse(saRes.payload).data.id;

      // Invoice 1
      const inv1Res = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: saId,
          billingPeriodStart: '2026-01-01',
          billingPeriodEnd: '2026-01-31',
          issueDate: '2026-01-01',
          dueDate: '2026-01-15',
        },
      });
      const inv1Id = JSON.parse(inv1Res.payload).data.id;

      // Invoice 2
      const inv2Res = await server.inject({
        method: 'POST',
        url: '/api/v1/billing/generate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          serviceAccountId: saId,
          billingPeriodStart: '2026-02-01',
          billingPeriodEnd: '2026-02-28',
          issueDate: '2026-02-01',
          dueDate: '2026-02-15',
        },
      });
      const inv2Id = JSON.parse(inv2Res.payload).data.id;

      // Post ₱1,500 payment: satisfies inv1 (999.00) and partially pays inv2 (501.00)
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: subId,
          amountCentavos: 150000,
          paymentMethod: 'CASH',
          notes: 'Multi invoice payment test',
        },
      });
      expect(payRes.statusCode).toBe(201);
      const paymentId = JSON.parse(payRes.payload).data.id;

      // Reverse payment
      const revRes = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${paymentId}/reverse`,
        headers: { authorization: `Bearer ${accountingToken}` },
        payload: {
          reason: 'Customer requested multi-invoice payment cancellation',
        },
      });
      expect(revRes.statusCode).toBe(200);

      // Verify both invoices are restored to full balance
      const [dbInv1] = await db.select().from(invoices).where(eq(invoices.id, inv1Id));
      expect(dbInv1.remainingBalanceCentavos).toBe(99900);
      expect(dbInv1.allocatedCentavos).toBe(0);
      expect(dbInv1.status).toBe('OVERDUE');

      const [dbInv2] = await db.select().from(invoices).where(eq(invoices.id, inv2Id));
      expect(dbInv2.remainingBalanceCentavos).toBe(99900);
      expect(dbInv2.allocatedCentavos).toBe(0);
      expect(dbInv2.status).toBe('OVERDUE');
    });

    // 4. Long audit reason reversal (300+ chars)
    it('handles long reversal audit reason without varchar(255) truncation crash', async () => {
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: testSubscriberId,
          amountCentavos: 10000,
          paymentMethod: 'CASH',
        },
      });
      const paymentId = JSON.parse(payRes.payload).data.id;

      const longReason =
        'This is an exceptionally detailed and verbose audit reason designed specifically to exceed standard varchar(255) ledger description field lengths. The customer visited the main branch with physical proof of bank double-charge, signed affidavit of denial, and corporate accounting supervisor confirmed voidance of transaction.';

      const revRes = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${paymentId}/reverse`,
        headers: { authorization: `Bearer ${accountingToken}` },
        payload: { reason: longReason },
      });

      expect(revRes.statusCode).toBe(200);
      expect(JSON.parse(revRes.payload).success).toBe(true);
    });

    // 5. Advance payment with zero open invoices
    it('accepts pure advance payment when subscriber has zero open invoices', async () => {
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Advance',
          lastName: 'ZeroBills',
          contactNumber: '09176665555',
          streetAddress: 'Zero St',
          barangay: 'Barangay 6',
        },
      });
      const subId = JSON.parse(subRes.payload).data.id;

      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: subId,
          amountCentavos: 250000, // ₱2,500.00
          paymentMethod: 'CASH',
          notes: 'Pure advance deposit',
        },
      });

      expect(payRes.statusCode).toBe(201);
      const data = JSON.parse(payRes.payload).data;
      expect(data.allocations).toHaveLength(0);
      expect(data.advanceCreditAddedCentavos).toBe(250000);
      expect(data.subscriberAdvanceCreditCentavos).toBe(250000);

      // Verify DB subscriber advanceCreditCentavos
      const [sub] = await db.select().from(subscribers).where(eq(subscribers.id, subId));
      expect(sub.advanceCreditCentavos).toBe(250000);
    });

    // 6. Concurrent payment posting under advisory locks
    it('handles concurrent payment posting with monotonic receipt numbers and zero collisions', async () => {
      const promises = [1, 2, 3, 4, 5].map((i) =>
        server.inject({
          method: 'POST',
          url: '/api/v1/payments',
          headers: { authorization: `Bearer ${cashierToken}` },
          payload: {
            subscriberId: testSubscriberId,
            amountCentavos: 1000 * i,
            paymentMethod: 'CASH',
            notes: `Concurrent payment #${i}`,
          },
        })
      );

      const responses = await Promise.all(promises);
      const receiptNumbers: string[] = [];

      for (const res of responses) {
        expect(res.statusCode).toBe(201);
        const data = JSON.parse(res.payload).data;
        expect(data.receipt).toBeDefined();
        receiptNumbers.push(data.receipt.receiptNumber);
      }

      // Verify all 5 receipts have distinct numbers
      const uniqueReceipts = new Set(receiptNumbers);
      expect(uniqueReceipts.size).toBe(5);
    });

    // 7. Concurrent duplicate payment reversals
    it('safely serializes concurrent reversal attempts on the same payment', async () => {
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: testSubscriberId,
          amountCentavos: 20000,
          paymentMethod: 'CASH',
        },
      });
      const paymentId = JSON.parse(payRes.payload).data.id;

      const [r1, r2] = await Promise.all([
        server.inject({
          method: 'POST',
          url: `/api/v1/payments/${paymentId}/reverse`,
          headers: { authorization: `Bearer ${accountingToken}` },
          payload: { reason: 'Concurrent reversal attempt 1' },
        }),
        server.inject({
          method: 'POST',
          url: `/api/v1/payments/${paymentId}/reverse`,
          headers: { authorization: `Bearer ${accountingToken}` },
          payload: { reason: 'Concurrent reversal attempt 2' },
        }),
      ]);

      const statusCodes = [r1.statusCode, r2.statusCode].sort();
      expect(statusCodes).toEqual([200, 400]);
      const failed = r1.statusCode === 400 ? r1 : r2;
      expect(JSON.parse(failed.payload).code).toBe('ALREADY_REVERSED');
    });

    // 8. Concurrent GCash verify and reject
    it('safely isolates concurrent verify and reject on the same GCash queue entry', async () => {
      const intakeRes = await server.inject({
        method: 'POST',
        url: '/api/v1/gcash/intake',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          referenceNumber: 'GCASH-CONCURRENT-999',
          subscriberId: testSubscriberId,
          senderName: 'Concurrent User',
          senderPhone: '09170009999',
          amountCentavos: 99900,
          proofImagePath: 'uploads/concurrent.jpg',
        },
      });
      const txId = JSON.parse(intakeRes.payload).data.id;

      const [vRes, rRes] = await Promise.all([
        server.inject({
          method: 'POST',
          url: `/api/v1/gcash/${txId}/verify`,
          headers: { authorization: `Bearer ${cashierToken}` },
          payload: { notes: 'Concurrent verify winning attempt' },
        }),
        server.inject({
          method: 'POST',
          url: `/api/v1/gcash/${txId}/reject`,
          headers: { authorization: `Bearer ${cashierToken}` },
          payload: { reason: 'Concurrent reject losing attempt' },
        }),
      ]);

      const statusCodes = [vRes.statusCode, rRes.statusCode].sort();
      expect(statusCodes).toEqual([200, 400]);
    });

    // 9. Shift reconciliation edge cases
    it('defaults shiftDate to current date when omitted in shift reconciliation', async () => {
      const shiftRes = await server.inject({
        method: 'POST',
        url: '/api/v1/remittances/shift/reconcile',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          cashierId: collectorUserId,
          remittedCashCentavos: 50000,
        },
      });

      expect(shiftRes.statusCode).toBe(200);
      const data = JSON.parse(shiftRes.payload).data;
      expect(data.shiftDate).toBe(new Date().toISOString().split('T')[0]);
    });

    it('returns 404 for non-existent cashier in shift reconciliation', async () => {
      const shiftRes = await server.inject({
        method: 'POST',
        url: '/api/v1/remittances/shift/reconcile',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          cashierId: '00000000-0000-0000-0000-000000000000',
          remittedCashCentavos: 50000,
        },
      });

      expect(shiftRes.statusCode).toBe(404);
      expect(JSON.parse(shiftRes.payload).code).toBe('CASHIER_NOT_FOUND');
    });

    // 10. Collection batch status transitions and closure guard
    it('blocks closing an OPEN batch before reconciliation, and blocks closing an already closed batch', async () => {
      const bRes = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/batches',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          collectorId: collectorUserId,
          expectedCashCentavos: 100000,
        },
      });
      const batch = JSON.parse(bRes.payload).data;

      // 1. Attempt to close OPEN batch directly -> 400 INVALID_STATUS
      const prematureClose = await server.inject({
        method: 'POST',
        url: `/api/v1/collections/batches/${batch.id}/close`,
        headers: { authorization: `Bearer ${supervisorToken}` },
      });
      expect(prematureClose.statusCode).toBe(400);
      expect(JSON.parse(prematureClose.payload).code).toBe('INVALID_STATUS');

      // 2. Reconcile batch
      const reconRes = await server.inject({
        method: 'POST',
        url: `/api/v1/collections/batches/${batch.id}/reconcile`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: { remittedCashCentavos: 100000 },
      });
      expect(reconRes.statusCode).toBe(200);

      // 3. Close reconciled batch -> succeeds
      const closeRes = await server.inject({
        method: 'POST',
        url: `/api/v1/collections/batches/${batch.id}/close`,
        headers: { authorization: `Bearer ${supervisorToken}` },
      });
      expect(closeRes.statusCode).toBe(200);

      // 4. Attempt to close already closed batch -> 400 ALREADY_CLOSED
      const repeatClose = await server.inject({
        method: 'POST',
        url: `/api/v1/collections/batches/${batch.id}/close`,
        headers: { authorization: `Bearer ${supervisorToken}` },
      });
      expect(repeatClose.statusCode).toBe(400);
      expect(JSON.parse(repeatClose.payload).code).toBe('ALREADY_CLOSED');

      // 5. Attempt to reconcile already closed batch -> 400 ALREADY_CLOSED
      const repeatRecon = await server.inject({
        method: 'POST',
        url: `/api/v1/collections/batches/${batch.id}/reconcile`,
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: { remittedCashCentavos: 100000 },
      });
      expect(repeatRecon.statusCode).toBe(400);
      expect(JSON.parse(repeatRecon.payload).code).toBe('ALREADY_CLOSED');
    });

    // 11. Query payment by human paymentNumber (PAY-YYYYMM-XXXX) and reverse by paymentNumber
    it('retrieves and reverses payment by human paymentNumber (PAY-YYYYMM-XXXX)', async () => {
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: testSubscriberId,
          amountCentavos: 15000,
          paymentMethod: 'CASH',
        },
      });
      const paymentNumber = JSON.parse(payRes.payload).data.paymentNumber;

      // Fetch by paymentNumber (testing case-insensitive matching with lowercase)
      const getRes = await server.inject({
        method: 'GET',
        url: `/api/v1/payments/${paymentNumber.toLowerCase()}`,
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(getRes.statusCode).toBe(200);
      expect(JSON.parse(getRes.payload).data.paymentNumber).toBe(paymentNumber);

      // Reverse by paymentNumber (testing case-insensitive matching with lowercase)
      const revRes = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${paymentNumber.toLowerCase()}/reverse`,
        headers: { authorization: `Bearer ${accountingToken}` },
        payload: { reason: 'Reversal by paymentNumber test' },
      });
      expect(revRes.statusCode).toBe(200);
      expect(JSON.parse(revRes.payload).payment.isReversed).toBe(true);
    });

    // 12. Advance Credit Utilization Guard during Reversal
    it('rejects reversal when advance credit created by payment has already been utilized', async () => {
      // 1. Create dedicated subscriber
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'AdvUtilized',
          lastName: 'Subscriber',
          contactNumber: '09177778899',
          streetAddress: 'Adv St',
          barangay: 'Barangay 7',
        },
      });
      const subId = JSON.parse(subRes.payload).data.id;

      // 2. Post pure advance payment of ₱2,000.00
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: subId,
          amountCentavos: 200000,
          paymentMethod: 'CASH',
        },
      });
      expect(payRes.statusCode).toBe(201);
      const paymentId = JSON.parse(payRes.payload).data.id;

      // 3. Simulate consumption of ₱1,500.00 of advance credit (e.g. by billing run)
      await db
        .update(subscribers)
        .set({ advanceCreditCentavos: 50000 })
        .where(eq(subscribers.id, subId));

      // 4. Attempt to reverse the ₱2,000.00 payment
      const revRes = await server.inject({
        method: 'POST',
        url: `/api/v1/payments/${paymentId}/reverse`,
        headers: { authorization: `Bearer ${accountingToken}` },
        payload: { reason: 'Attempt reversal of already-consumed advance credit' },
      });

      expect(revRes.statusCode).toBe(400);
      const body = JSON.parse(revRes.payload);
      expect(body.code).toBe('ADVANCE_CREDIT_ALREADY_UTILIZED');
    });

    // 13. RBAC: Viewer is blocked from reprinting receipts
    it('denies viewer role from reprinting official receipts (HTTP 403 Forbidden)', async () => {
      // 1. Post payment as cashier
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: testSubscriberId,
          amountCentavos: 10000,
          paymentMethod: 'CASH',
        },
      });
      const receiptNumber = JSON.parse(payRes.payload).data.receipt.receiptNumber;

      // 2. Attempt reprint as viewer -> 403 Forbidden
      const reprintRes = await server.inject({
        method: 'POST',
        url: `/api/v1/receipts/${receiptNumber}/reprint`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(reprintRes.statusCode).toBe(403);
    });

    // 14. RBAC: Viewer and Cashier can view batches (collection.view), but cannot create
    it('allows viewer and cashier to view batches via collection.view, but denies batch creation', async () => {
      // 1. Cashier can list batches
      const listResCashier = await server.inject({
        method: 'GET',
        url: '/api/v1/collections/batches',
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(listResCashier.statusCode).toBe(200);

      // 2. Viewer can list batches
      const listResViewer = await server.inject({
        method: 'GET',
        url: '/api/v1/collections/batches',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(listResViewer.statusCode).toBe(200);

      // 3. Viewer cannot create batch
      const createResViewer = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/batches',
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { collectorId: collectorUserId },
      });
      expect(createResViewer.statusCode).toBe(403);
    });

    // 15. Invalid collectionAreaId returns HTTP 404 NOT_FOUND
    it('returns 404 NOT_FOUND when non-existent collectionAreaId is supplied', async () => {
      const bRes = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/batches',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          collectorId: collectorUserId,
          collectionAreaId: '00000000-0000-0000-0000-000000000000',
        },
      });
      expect(bRes.statusCode).toBe(404);
      expect(JSON.parse(bRes.payload).code).toBe('NOT_FOUND');
    });

    // 16. Duplicate custom batchNumber returns HTTP 409 DUPLICATE_BATCH_NUMBER
    it('returns 409 DUPLICATE_BATCH_NUMBER when custom batchNumber already exists', async () => {
      const customNum = `BAT-CUSTOM-${Date.now()}`;
      const res1 = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/batches',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          collectorId: collectorUserId,
          batchNumber: customNum,
        },
      });
      expect(res1.statusCode).toBe(201);

      const res2 = await server.inject({
        method: 'POST',
        url: '/api/v1/collections/batches',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          collectorId: collectorUserId,
          batchNumber: customNum,
        },
      });
      expect(res2.statusCode).toBe(409);
      expect(JSON.parse(res2.payload).code).toBe('DUPLICATE_BATCH_NUMBER');
    });

    // 17. Case-insensitive receiptNumber lookup
    it('fetches receipt using lowercase receiptNumber', async () => {
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: testSubscriberId,
          amountCentavos: 12000,
          paymentMethod: 'CASH',
        },
      });
      const receiptNumber = JSON.parse(payRes.payload).data.receipt.receiptNumber;

      const getRcpt = await server.inject({
        method: 'GET',
        url: `/api/v1/receipts/${receiptNumber.toLowerCase()}`,
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(getRcpt.statusCode).toBe(200);
      expect(JSON.parse(getRcpt.payload).data.receiptNumber).toBe(receiptNumber);
    });

    // 18. Search payments by receiptNumber
    it('finds payment when querying search filter by receiptNumber', async () => {
      const payRes = await server.inject({
        method: 'POST',
        url: '/api/v1/payments',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          subscriberId: testSubscriberId,
          amountCentavos: 13500,
          paymentMethod: 'CASH',
        },
      });
      const receiptNumber = JSON.parse(payRes.payload).data.receipt.receiptNumber;

      const searchRes = await server.inject({
        method: 'GET',
        url: `/api/v1/payments?search=${receiptNumber}`,
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(searchRes.statusCode).toBe(200);
      const searchBody = JSON.parse(searchRes.payload);
      expect(searchBody.data.length).toBeGreaterThanOrEqual(1);
      expect(searchBody.data.some((p: any) => p.receipt?.receiptNumber === receiptNumber)).toBe(true);
    });

    // 19. Shift date format validation
    it('rejects malformed shiftDate with 400 VALIDATION_ERROR', async () => {
      const shiftRes = await server.inject({
        method: 'POST',
        url: '/api/v1/remittances/shift/reconcile',
        headers: { authorization: `Bearer ${supervisorToken}` },
        payload: {
          cashierId: collectorUserId,
          shiftDate: 'not-a-valid-date',
          remittedCashCentavos: 50000,
        },
      });
      expect(shiftRes.statusCode).toBe(400);
      expect(JSON.parse(shiftRes.payload).code).toBe('VALIDATION_ERROR');
    });
  });
});
