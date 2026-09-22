import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { db } from '../src/db/client.js';
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
  gcashTransactions,
  subscriberLedger,
  serviceOrders,
  collectionAreas,
  collectionRoutes,
  users,
} from '../src/db/schema.js';
import { eq, and, inArray, sql } from 'drizzle-orm';

describe('Phase 9 — Multi-Workstation LAN Concurrency Suite (AT-09)', () => {
  let server: FastifyInstance;

  // 3-Client LAN Workstation Tokens
  let ws1AdminToken: string;       // PC 1: Admin Workstation
  let ws2CashierToken: string;     // PC 2: Cashier Counter Workstation
  let ws3OperationsToken: string;  // PC 3: Operations & Technical Workstation

  let testPlanId: string;
  let testAreaId: string;
  let cashierUserId: string;
  let techUserId: string;

  // Test subscribers and service accounts
  const createdSubscribers: Array<{ id: string; accountNumber: string }> = [];
  const createdServiceAccounts: Array<{ id: string; serviceAccountNumber: string; subscriberId: string }> = [];

  beforeAll(async () => {
    await seedDatabase();

    server = buildServer();
    await server.ready();

    // 1. Authenticate Workstation 1 (Admin)
    const adminLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'Admin123!' },
    });
    ws1AdminToken = JSON.parse(adminLogin.payload).token;

    // 2. Authenticate Workstation 2 (Cashier)
    const cashierLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'cashier', password: 'Cashier123!' },
    });
    const cashierBody = JSON.parse(cashierLogin.payload);
    ws2CashierToken = cashierBody.token;
    cashierUserId = cashierBody.user.id;

    // 3. Authenticate Workstation 3 (Supervisor / Operations)
    ws3OperationsToken = server.jwt.sign({
      id: cashierUserId,
      username: 'supervisor',
      fullName: 'Operations Supervisor',
      roles: ['ROLE_COLLECTION_SUPV', 'ROLE_ADMIN'],
      permissions: [
        'service_orders.create',
        'service_orders.read',
        'service_orders.update',
        'service_orders.complete',
        'collection.view',
        'collection.batch_create',
      ],
    });

    // Fetch tech user id
    const [tech] = await db.select().from(users).where(eq(users.username, 'technician')).limit(1);
    techUserId = tech?.id || cashierUserId;

    // Fetch or create collection area
    const [area] = await db.select().from(collectionAreas).limit(1);
    testAreaId = area.id;

    // 4. Create or reuse common service plan: ₱1,299.00 / month (129900 centavos)
    const existingPlan = await db.select().from(servicePlans).limit(1);
    if (existingPlan.length > 0) {
      testPlanId = existingPlan[0].id;
    } else {
      const planRes = await server.inject({
        method: 'POST',
        url: '/api/v1/plans',
        headers: { authorization: `Bearer ${ws1AdminToken}` },
        payload: {
          name: 'LAN Concurrency Fiber Plan 1299',
          planCode: `CONC-${Date.now()}`,
          serviceType: 'INTERNET',
          monthlyFeeCentavos: 129900,
          installationFeeCentavos: 100000,
        },
      });
      testPlanId = JSON.parse(planRes.payload).data.id;
    }

    // 5. Provision 12 test subscribers and service accounts
    for (let i = 1; i <= 12; i++) {
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${ws1AdminToken}` },
        payload: {
          firstName: `Concurrent${i}`,
          lastName: `Subscriber${i}`,
          contactNumber: `0917000${String(i).padStart(4, '0')}`,
          streetAddress: `Magsaysay Ave Block ${i}`,
          barangay: 'Poblacion',
          municipality: 'Malaybalay',
        },
      });
      const subData = JSON.parse(subRes.payload).data;
      createdSubscribers.push({ id: subData.id, accountNumber: subData.accountNumber });

      const saRes = await server.inject({
        method: 'POST',
        url: '/api/v1/service-accounts',
        headers: { authorization: `Bearer ${ws1AdminToken}` },
        payload: {
          subscriberId: subData.id,
          servicePlanId: testPlanId,
          collectionAreaId: testAreaId,
          status: 'ACTIVE',
          activationDate: '2026-08-01',
        },
      });
      const saData = JSON.parse(saRes.payload).data;
      createdServiceAccounts.push({
        id: saData.id,
        serviceAccountNumber: saData.serviceAccountNumber,
        subscriberId: subData.id,
      });
    }
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  // ============================================================================
  // AT-09: 3-Client LAN Concurrency Execution
  // ============================================================================
  describe('AT-09: Simultaneous Multi-PC LAN Operation (3 Workstations)', () => {
    it('simultaneously processes Billing Generation (PC1), Payment Posting (PC2), and Service Orders (PC3) without deadlocks or sequence collisions', async () => {
      // Setup: Pre-generate invoices for accounts 1-6 so Cashier can pay them
      const preInvoices: Array<{ id: string; subscriberId: string; invoiceNumber: string }> = [];
      for (let i = 0; i < 6; i++) {
        const invRes = await server.inject({
          method: 'POST',
          url: '/api/v1/billing/generate',
          headers: { authorization: `Bearer ${ws1AdminToken}` },
          payload: {
            serviceAccountId: createdServiceAccounts[i].id,
            billingPeriodStart: '2026-08-01',
            billingPeriodEnd: '2026-08-31',
            issueDate: '2026-08-01',
            dueDate: '2026-08-16',
          },
        });
        expect(invRes.statusCode).toBe(201);
        const invData = JSON.parse(invRes.payload).data;
        preInvoices.push({
          id: invData.id,
          subscriberId: createdServiceAccounts[i].subscriberId,
          invoiceNumber: invData.invoiceNumber,
          totalDueCentavos: Number(invData.totalDueCentavos),
        });
      }

      // Workstation 1 (PC 1: Admin) Tasks: Generate billing for accounts 7, 8, 9, 10, 11, 12
      const ws1Tasks = [6, 7, 8, 9, 10, 11].map((idx) =>
        server.inject({
          method: 'POST',
          url: '/api/v1/billing/generate',
          headers: { authorization: `Bearer ${ws1AdminToken}` },
          payload: {
            serviceAccountId: createdServiceAccounts[idx].id,
            billingPeriodStart: '2026-08-01',
            billingPeriodEnd: '2026-08-31',
            issueDate: '2026-08-01',
            dueDate: '2026-08-16',
          },
        })
      );

      // Workstation 2 (PC 2: Cashier) Tasks: Post 6 counter payments with receipt issuance
      const ws2Tasks = preInvoices.map((inv, idx) =>
        server.inject({
          method: 'POST',
          url: '/api/v1/payments',
          headers: { authorization: `Bearer ${ws2CashierToken}` },
          payload: {
            subscriberId: inv.subscriberId,
            amountCentavos: inv.totalDueCentavos,
            paymentMethod: 'CASH',
            notes: `Counter LAN Concurrency Payment #${idx + 1}`,
          },
        })
      );

      // Workstation 3 (PC 3: Operations) Tasks: Create 6 service orders across accounts
      const ws3Tasks = createdServiceAccounts.slice(0, 6).map((sa, idx) =>
        server.inject({
          method: 'POST',
          url: '/api/v1/service-orders',
          headers: { authorization: `Bearer ${ws3OperationsToken}` },
          payload: {
            serviceAccountId: sa.id,
            orderType: idx % 2 === 0 ? 'REPAIR' : 'RELOCATION',
            priority: 'NORMAL',
            description: `Workstation 3 technical maintenance order #${idx + 1}`,
            scheduledDate: '2026-09-25',
          },
        })
      );

      // Fire all operations concurrently across all 3 workstations
      const [ws1Results, ws2Results, ws3Results] = await Promise.all([
        Promise.all(ws1Tasks),
        Promise.all(ws2Tasks),
        Promise.all(ws3Tasks),
      ]);

      // Assertion 1: All concurrent requests succeeded (no 500, no deadlocks)
      for (const res of ws1Results) {
        expect(res.statusCode).toBe(201);
      }
      for (const res of ws2Results) {
        expect(res.statusCode).toBe(201);
      }
      for (const res of ws3Results) {
        expect(res.statusCode).toBe(201);
      }

      // Assertion 2: Invoice Numbers generated by Admin are unique
      const generatedInvoiceNumbers = ws1Results.map(
        (r) => JSON.parse(r.payload).data.invoiceNumber
      );
      const uniqueInvoiceNumbers = new Set(generatedInvoiceNumbers);
      expect(uniqueInvoiceNumbers.size).toBe(generatedInvoiceNumbers.length);
      for (const num of generatedInvoiceNumbers) {
        expect(num).toMatch(/^INV-\d{6}-\d{4,6}$/);
      }

      // Assertion 3: Official Receipt Numbers generated by Cashier are unique
      const generatedReceiptNumbers = ws2Results.map(
        (r) => JSON.parse(r.payload).data.receipt.receiptNumber
      );
      const uniqueReceiptNumbers = new Set(generatedReceiptNumbers);
      expect(uniqueReceiptNumbers.size).toBe(generatedReceiptNumbers.length);
      for (const num of generatedReceiptNumbers) {
        expect(num).toMatch(/^OR-\d{6}-\d{4}$/);
      }

      // Assertion 4: Service Order Numbers generated by Operations are unique
      const generatedOrderNumbers = ws3Results.map(
        (r) => JSON.parse(r.payload).data.orderNumber
      );
      const uniqueOrderNumbers = new Set(generatedOrderNumbers);
      expect(uniqueOrderNumbers.size).toBe(generatedOrderNumbers.length);
      for (const num of generatedOrderNumbers) {
        expect(num).toMatch(/^SO-\d{6}-\d{4}$/);
      }

      // Assertion 5: Check mathematical ledger integrity for settled accounts
      for (const inv of preInvoices) {
        const soaRes = await server.inject({
          method: 'GET',
          url: `/api/v1/subscribers/${inv.subscriberId}/soa`,
          headers: { authorization: `Bearer ${ws1AdminToken}` },
        });
        expect(soaRes.statusCode).toBe(200);
        const soa = JSON.parse(soaRes.payload).data;
        // Invoices were ₱1,299.00 and paid ₱1,299.00 exact -> net balance should be 0
        expect(soa.currentBalanceCentavos).toBe(0);
        expect(soa.openInvoices).toHaveLength(0);
        expect(soa.ledgerLines.length).toBeGreaterThanOrEqual(2); // 1 Debit + 1 Credit
      }
    });
  });

  // ============================================================================
  // High-Volume Parallel Payment Counter Race Condition Test
  // ============================================================================
  describe('High-Volume Parallel Counter Payments Race Condition Test', () => {
    it('handles 10 parallel counter payments on different accounts with zero OR collisions', async () => {
      // First generate month 2 invoices for all 10 accounts
      for (let i = 0; i < 10; i++) {
        await server.inject({
          method: 'POST',
          url: '/api/v1/billing/generate',
          headers: { authorization: `Bearer ${ws1AdminToken}` },
          payload: {
            serviceAccountId: createdServiceAccounts[i].id,
            billingPeriodStart: '2026-09-01',
            billingPeriodEnd: '2026-09-30',
            issueDate: '2026-09-01',
            dueDate: '2026-09-16',
          },
        });
      }

      // Post 10 payments simultaneously
      const paymentPromises = createdServiceAccounts.slice(0, 10).map((sa, i) =>
        server.inject({
          method: 'POST',
          url: '/api/v1/payments',
          headers: { authorization: `Bearer ${ws2CashierToken}` },
          payload: {
            subscriberId: sa.subscriberId,
            amountCentavos: 129900,
            paymentMethod: 'CASH',
            notes: `Parallel Cash Payment Batch ${i + 1}`,
          },
        })
      );

      const paymentResults = await Promise.all(paymentPromises);

      // Verify all succeeded
      for (const res of paymentResults) {
        expect(res.statusCode).toBe(201);
      }

      const receiptNumbers = paymentResults.map(
        (r) => JSON.parse(r.payload).data.receipt.receiptNumber
      );
      const uniqueReceipts = new Set(receiptNumbers);
      expect(uniqueReceipts.size).toBe(receiptNumbers.length);
    });
  });

  // ============================================================================
  // Concurrent Duplicate GCash Reference Collision Guard (AT-05)
  // ============================================================================
  describe('Concurrent Duplicate GCash Reference Collision Guard (AT-05)', () => {
    it('blocks parallel race-condition attempts to use the exact same GCash reference number', async () => {
      const gcashRef = '9012' + Date.now().toString().slice(-9);
      const sub1 = createdSubscribers[0].id;
      const sub2 = createdSubscribers[1].id;

      // Submit GCash proof for sub1
      const subRes = await server.inject({
        method: 'POST',
        url: '/api/v1/gcash/submit',
        headers: { authorization: `Bearer ${ws2CashierToken}` },
        payload: {
          subscriberId: sub1,
          referenceNumber: gcashRef,
          amountCentavos: 129900,
          senderPhone: '09171234567',
          senderName: 'Concurrent GCash Payer',
          proofImagePath: 'proofs/concurrent-gcash-01.png',
        },
      });
      expect(subRes.statusCode).toBe(201);
      const gcashTxId = JSON.parse(subRes.payload).data.id;

      // Now fire two parallel requests: one tries to submit duplicate GCash ref, one tries to verify
      const [dupAttemptRes, secondDupAttemptRes] = await Promise.all([
        server.inject({
          method: 'POST',
          url: '/api/v1/gcash/submit',
          headers: { authorization: `Bearer ${ws2CashierToken}` },
          payload: {
            subscriberId: sub2,
            referenceNumber: gcashRef,
            amountCentavos: 129900,
            senderPhone: '09179998888',
            senderName: 'Racer GCash Payer',
            proofImagePath: 'proofs/concurrent-gcash-02.png',
          },
        }),
        server.inject({
          method: 'POST',
          url: '/api/v1/gcash/submit',
          headers: { authorization: `Bearer ${ws2CashierToken}` },
          payload: {
            subscriberId: sub2,
            referenceNumber: gcashRef,
            amountCentavos: 129900,
            senderPhone: '09179998888',
            senderName: 'Racer 2 GCash Payer',
            proofImagePath: 'proofs/concurrent-gcash-03.png',
          },
        }),
      ]);

      // Both duplicate attempts must be rejected with 409 Conflict
      expect(dupAttemptRes.statusCode).toBe(409);
      expect(JSON.parse(dupAttemptRes.payload).code).toBe('DUPLICATE_GCASH_REFERENCE');

      expect(secondDupAttemptRes.statusCode).toBe(409);
      expect(JSON.parse(secondDupAttemptRes.payload).code).toBe('DUPLICATE_GCASH_REFERENCE');

      // Verify and post the valid transaction
      const verifyRes = await server.inject({
        method: 'POST',
        url: `/api/v1/gcash/${gcashTxId}/verify`,
        headers: { authorization: `Bearer ${ws2CashierToken}` },
        payload: {
          status: 'VERIFIED',
          notes: 'Approved during concurrency test',
        },
      });
      expect(verifyRes.statusCode).toBe(200);
    });
  });

  // ============================================================================
  // Concurrent Duplicate Billing Period Collision Guard (AT-11)
  // ============================================================================
  describe('Concurrent Duplicate Billing Period Collision Guard (AT-11)', () => {
    it('blocks race conditions attempting to bill the exact same service account and period twice', async () => {
      const targetAccount = createdServiceAccounts[11].id;
      const billingPeriod = {
        serviceAccountId: targetAccount,
        billingPeriodStart: '2026-10-01',
        billingPeriodEnd: '2026-10-31',
        issueDate: '2026-10-01',
        dueDate: '2026-10-16',
      };

      // Two concurrent billing requests for the exact same account and month
      const [resA, resB] = await Promise.all([
        server.inject({
          method: 'POST',
          url: '/api/v1/billing/generate',
          headers: { authorization: `Bearer ${ws1AdminToken}` },
          payload: billingPeriod,
        }),
        server.inject({
          method: 'POST',
          url: '/api/v1/billing/generate',
          headers: { authorization: `Bearer ${ws1AdminToken}` },
          payload: billingPeriod,
        }),
      ]);

      // One must succeed (201) and the other must be rejected (409)
      const statuses = [resA.statusCode, resB.statusCode].sort();
      expect(statuses).toEqual([201, 409]);

      // Verify database contains exactly ONE invoice for this period
      const dbInvoices = await db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.serviceAccountId, targetAccount),
            eq(invoices.billingPeriodStart, '2026-10-01'),
            eq(invoices.billingPeriodEnd, '2026-10-31')
          )
        );
      expect(dbInvoices).toHaveLength(1);
    });
  });

  // ============================================================================
  // Strict Centavo Double-Entry Balance Verification
  // ============================================================================
  describe('Strict Centavo Double-Entry Balance Verification', () => {
    it('ensures zero balance deviations and exact integer centavo arithmetic across all ledger entries', async () => {
      const allLedgers = await db.select().from(subscriberLedger);
      expect(allLedgers.length).toBeGreaterThan(0);

      // Group by subscriber and verify mathematical consistency
      const bySubscriber = new Map<string, typeof allLedgers>();
      for (const entry of allLedgers) {
        if (!bySubscriber.has(entry.subscriberId)) {
          bySubscriber.set(entry.subscriberId, []);
        }
        bySubscriber.get(entry.subscriberId)!.push(entry);
      }

      for (const [subId, entries] of bySubscriber.entries()) {
        let runningBalance = 0;
        // Sort chronologically
        const sorted = entries.sort(
          (a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime()
        );

        for (const entry of sorted) {
          const debit = Number(entry.debitCentavos);
          const credit = Number(entry.creditCentavos);
          runningBalance += debit - credit;

          // Every line's balanceAfterCentavos must match the running balance
          expect(Number(entry.balanceAfterCentavos)).toBe(runningBalance);
          // Integer check: must have no decimals
          expect(Number.isInteger(debit)).toBe(true);
          expect(Number.isInteger(credit)).toBe(true);
          expect(Number.isInteger(Number(entry.balanceAfterCentavos))).toBe(true);
        }
      }
    });
  });
});
