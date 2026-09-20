import { eq, and, or, ilike, gte, lte, desc, asc, count, sql, inArray, ne } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  payments,
  paymentAllocations,
  receipts,
  paymentReversals,
  invoices,
  subscribers,
  subscriberLedger,
  users,
  gcashTransactions,
} from '../../db/schema.js';
import { writeAuditLog } from '../../utils/audit.js';
import { allocatePaymentFIFO, AllocatableInvoice, calculateDaysOverdue } from '@bcis/domain';
import {
  CreatePaymentInput,
  PaymentQueryInput,
  ReversePaymentInput,
} from '@bcis/validation';

/**
 * Extracts YYYYMM string from a date or date string in a timezone-independent manner.
 */
export function extractYearMonth(dateInput?: string | Date): string {
  if (dateInput) {
    if (typeof dateInput === 'string') {
      const clean = dateInput.split('T')[0].trim();
      const parts = clean.split('-');
      if (parts.length >= 2 && parts[0].length === 4 && parts[1].length === 2) {
        return `${parts[0]}${parts[1]}`;
      }
    } else if (dateInput instanceof Date) {
      const year = dateInput.getFullYear();
      const month = String(dateInput.getMonth() + 1).padStart(2, '0');
      return `${year}${month}`;
    }
  }
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}

/**
 * Generates the next sequential Official Receipt number in format OR-YYYYMM-XXXX.
 * Employs PostgreSQL transaction-scoped advisory locking to guarantee strict monotonicity and zero collision under concurrency.
 */
export async function generateReceiptNumber(
  dateInput?: string | Date,
  offset = 1,
  tx: any = db
): Promise<string> {
  const yearMonth = extractYearMonth(dateInput);
  const prefix = `OR-${yearMonth}-`;

  // Transaction-scoped advisory lock for sequential receipt numbering
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${'receipt_numbering_' + yearMonth}))`
  );

  const existing = await tx
    .select({ receiptNumber: receipts.receiptNumber })
    .from(receipts)
    .where(ilike(receipts.receiptNumber, `${prefix}%`));

  let maxSeq = 0;
  for (const row of existing) {
    const part = row.receiptNumber.slice(prefix.length);
    const num = parseInt(part, 10);
    if (!isNaN(num) && num > maxSeq) {
      maxSeq = num;
    }
  }

  const nextSeq = String(maxSeq + offset).padStart(4, '0');
  return `${prefix}${nextSeq}`;
}

/**
 * Generates the next sequential Payment number in format PAY-YYYYMM-XXXX.
 * Employs PostgreSQL transaction-scoped advisory locking.
 */
export async function generatePaymentNumber(
  dateInput?: string | Date,
  offset = 1,
  tx: any = db
): Promise<string> {
  const yearMonth = extractYearMonth(dateInput);
  const prefix = `PAY-${yearMonth}-`;

  // Transaction-scoped advisory lock for sequential payment numbering
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${'payment_numbering_' + yearMonth}))`
  );

  const existing = await tx
    .select({ paymentNumber: payments.paymentNumber })
    .from(payments)
    .where(ilike(payments.paymentNumber, `${prefix}%`));

  let maxSeq = 0;
  for (const row of existing) {
    const part = row.paymentNumber.slice(prefix.length);
    const num = parseInt(part, 10);
    if (!isNaN(num) && num > maxSeq) {
      maxSeq = num;
    }
  }

  const nextSeq = String(maxSeq + offset).padStart(4, '0');
  return `${prefix}${nextSeq}`;
}

/**
 * Calculates net subscriber running ledger balance using exact double-entry summation.
 * debitCentavos - creditCentavos
 */
export async function getSubscriberCurrentLedgerBalance(
  subscriberId: string,
  tx: any = db
): Promise<number> {
  const [result] = await tx
    .select({
      totalDebit: sql<number>`COALESCE(SUM(${subscriberLedger.debitCentavos}), 0)::bigint`,
      totalCredit: sql<number>`COALESCE(SUM(${subscriberLedger.creditCentavos}), 0)::bigint`,
    })
    .from(subscriberLedger)
    .where(eq(subscriberLedger.subscriberId, subscriberId));

  const debit = Number(result?.totalDebit ?? 0);
  const credit = Number(result?.totalCredit ?? 0);
  return debit - credit;
}

async function resolveUserId(actor?: { id?: string }, tx: any = db): Promise<string> {
  if (actor?.id) return actor.id;
  const [firstUser] = await tx.select({ id: users.id }).from(users).limit(1);
  if (!firstUser) {
    throw new Error('No user available to associate with this transaction');
  }
  return firstUser.id;
}

/**
 * Core payment posting execution logic, usable directly or within an existing transaction.
 * Executes atomic FIFO allocation, invoice updates, advance credit updates, ledger posting, and OR generation.
 */
export async function executePostPayment(
  input: CreatePaymentInput,
  actor: { id?: string; name: string },
  tx: any,
  ip?: string,
  options?: { sourceGcashId?: string }
) {
  const cashierId = await resolveUserId(actor, tx);

  // 1. Transaction-scoped advisory lock on subscriber to prevent concurrent balance or payment races
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${'sub_payment_' + input.subscriberId}))`
  );

  // 2. Fetch subscriber
  const [subscriber] = await tx
    .select()
    .from(subscribers)
    .where(eq(subscribers.id, input.subscriberId));

  if (!subscriber) {
    const err: any = new Error('Subscriber not found');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  // 3. Duplicate payment reference check (for GCASH, BANK_TRANSFER, CHECK)
  if (input.referenceNumber && input.referenceNumber.trim() !== '') {
    const cleanRef = input.referenceNumber.trim();
    const [existingWithRef] = await tx
      .select({ id: payments.id, paymentNumber: payments.paymentNumber })
      .from(payments)
      .where(
        and(
          sql`lower(${payments.referenceNumber}) = lower(${cleanRef})`,
          eq(payments.isReversed, false)
        )
      );

    if (existingWithRef) {
      const err: any = new Error(
        `Payment with reference number ${cleanRef} already exists (${existingWithRef.paymentNumber})`
      );
      err.statusCode = 409;
      err.code = 'DUPLICATE_REFERENCE_NUMBER';
      throw err;
    }

    if (input.paymentMethod === 'GCASH') {
      const gcashConditions = [sql`lower(${gcashTransactions.referenceNumber}) = lower(${cleanRef})`];
      if (options?.sourceGcashId) {
        gcashConditions.push(ne(gcashTransactions.id, options.sourceGcashId));
      }
      const [existingInGcash] = await tx
        .select({ id: gcashTransactions.id, status: gcashTransactions.status })
        .from(gcashTransactions)
        .where(and(...gcashConditions));

      if (existingInGcash) {
        const err: any = new Error(
          `GCash reference number ${cleanRef} has already been submitted (Status: ${existingInGcash.status})`
        );
        err.statusCode = 409;
        err.code = 'DUPLICATE_GCASH_REFERENCE';
        throw err;
      }
    }
  }

  // 4. Fetch open/unpaid invoices for subscriber ordered by Due Date ASC, Issue Date ASC, then CreatedAt ASC (FIFO)
  const openInvoices = await tx
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.subscriberId, input.subscriberId),
        inArray(invoices.status, ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE']),
        sql`${invoices.remainingBalanceCentavos} > 0`
      )
    )
    .orderBy(asc(invoices.dueDate), asc(invoices.issueDate), asc(invoices.createdAt))
    .for('update');

  // 5. Map to AllocatableInvoice for pure domain FIFO engine
  const allocatableInvoices: AllocatableInvoice[] = openInvoices.map((inv: typeof invoices.$inferSelect) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    dueDate: inv.dueDate,
    createdAt: inv.createdAt.toISOString(),
    status: inv.status,
    totalDueCentavos: inv.totalDueCentavos,
    allocatedCentavos: inv.allocatedCentavos,
    remainingBalanceCentavos: inv.remainingBalanceCentavos,
  }));

  // 6. Execute pure domain FIFO allocation (handles AT-01, AT-02, AT-03, AT-04)
  const allocationPlan = allocatePaymentFIFO(input.amountCentavos, allocatableInvoices);

  // 7. Generate monotonic Payment Number (PAY-YYYYMM-XXXX)
  const paymentNumber = await generatePaymentNumber(undefined, 1, tx);

  // 8. Insert Payment record
  const [insertedPayment] = await tx
    .insert(payments)
    .values({
      paymentNumber,
      subscriberId: subscriber.id,
      cashierId,
      paymentDate: new Date(),
      paymentMethod: input.paymentMethod,
      referenceNumber: input.referenceNumber?.trim() || null,
      amountCentavos: input.amountCentavos,
      isReversed: false,
      notes: input.notes || null,
    })
    .returning();

  // 9. Process allocations: insert paymentAllocations and update invoices
  const insertedAllocations = [];
  for (const alloc of allocationPlan.allocations) {
    const [insertedAlloc] = await tx
      .insert(paymentAllocations)
      .values({
        paymentId: insertedPayment.id,
        invoiceId: alloc.invoiceId,
        allocatedCentavos: alloc.allocatedAmountCentavos,
      })
      .returning();

    insertedAllocations.push({
      ...insertedAlloc,
      invoiceNumber: alloc.invoiceNumber,
      allocatedAmountCentavos: alloc.allocatedAmountCentavos,
      newRemainingBalanceCentavos: alloc.newRemainingBalanceCentavos,
      newStatus: alloc.newStatus,
    });

    // Update invoice balance and status
    await tx
      .update(invoices)
      .set({
        allocatedCentavos: sql`${invoices.allocatedCentavos} + ${alloc.allocatedAmountCentavos}`,
        remainingBalanceCentavos: alloc.newRemainingBalanceCentavos,
        status: alloc.newStatus,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, alloc.invoiceId));
  }

  // 10. Advance Credit: If payment exceeded all open invoices, credit the surplus to subscriber (AT-03)
  let updatedSubscriberAdvanceCredit = subscriber.advanceCreditCentavos;
  if (allocationPlan.advanceCreditCentavos > 0) {
    const [updatedSub] = await tx
      .update(subscribers)
      .set({
        advanceCreditCentavos: sql`${subscribers.advanceCreditCentavos} + ${allocationPlan.advanceCreditCentavos}`,
        updatedAt: new Date(),
      })
      .where(eq(subscribers.id, subscriber.id))
      .returning();

    updatedSubscriberAdvanceCredit = updatedSub?.advanceCreditCentavos ?? (subscriber.advanceCreditCentavos + allocationPlan.advanceCreditCentavos);
  }

  // 11. Generate Official Receipt (OR-YYYYMM-XXXX) with transaction advisory lock
  const receiptNumber = await generateReceiptNumber(undefined, 1, tx);

  const [insertedReceipt] = await tx
    .insert(receipts)
    .values({
      receiptNumber,
      paymentId: insertedPayment.id,
      cashierId,
      totalAmountCentavos: input.amountCentavos,
      status: 'ISSUED',
      issuedAt: new Date(),
    })
    .returning();

  // 12. Update Subscriber Running Ledger (Credit Entry)
  let currentBalance = await getSubscriberCurrentLedgerBalance(subscriber.id, tx);
  currentBalance -= input.amountCentavos;

  await tx.insert(subscriberLedger).values({
    subscriberId: subscriber.id,
    entryType: 'PAYMENT',
    referenceId: insertedPayment.paymentNumber,
    description: `Payment received via ${input.paymentMethod} (Receipt: ${insertedReceipt.receiptNumber})`,
    debitCentavos: 0,
    creditCentavos: input.amountCentavos,
    balanceAfterCentavos: currentBalance,
  });

  // 13. Audit Log Entry
  await writeAuditLog(
    {
      actorId: actor.id,
      actorName: actor.name,
      action: 'PAYMENT_POSTED',
      entityType: 'payments',
      entityId: insertedPayment.id,
      newValues: {
        paymentNumber: insertedPayment.paymentNumber,
        receiptNumber: insertedReceipt.receiptNumber,
        amountCentavos: input.amountCentavos,
        paymentMethod: input.paymentMethod,
        referenceNumber: input.referenceNumber,
        allocatedCentavos: allocationPlan.totalAllocatedCentavos,
        advanceCreditCentavos: allocationPlan.advanceCreditCentavos,
        allocationsCount: allocationPlan.allocations.length,
      },
      reason: input.notes || 'Counter payment posted',
      ipAddress: ip,
    },
    tx
  );

  return {
    ...insertedPayment,
    receipt: insertedReceipt,
    allocations: insertedAllocations,
    advanceCreditAddedCentavos: allocationPlan.advanceCreditCentavos,
    subscriberAdvanceCreditCentavos: updatedSubscriberAdvanceCredit,
    plan: allocationPlan,
  };
}

/**
 * Public payment posting endpoint service. Wraps execution in an isolated database transaction.
 */
export async function postPayment(
  input: CreatePaymentInput,
  actor: { id?: string; name: string },
  ip?: string
) {
  return await db.transaction(async (tx) => {
    return await executePostPayment(input, actor, tx, ip);
  });
}

/**
 * Reverses an existing payment transaction (AT-06 Payment Reversal).
 * Restores invoice balances and statuses, reverses advance credits, marks receipt REVERSED,
 * inserts reversal record and audit trail, and creates an immutable ledger balancing entry.
 */
export async function reversePayment(
  paymentId: string,
  input: ReversePaymentInput,
  actor: { id?: string; name: string },
  ip?: string
) {
  return await db.transaction(async (tx) => {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paymentId);
    const paymentCondition = isUuid ? eq(payments.id, paymentId) : sql`lower(${payments.paymentNumber}) = lower(${paymentId.trim()})`;

    // 1. Fetch payment with row-level lock
    const [payment] = await tx
      .select()
      .from(payments)
      .where(paymentCondition)
      .for('update');

    if (!payment) {
      const err: any = new Error('Payment not found');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (payment.isReversed) {
      const err: any = new Error('Payment has already been reversed');
      err.statusCode = 400;
      err.code = 'ALREADY_REVERSED';
      throw err;
    }

    // 2. Lock subscriber to avoid race conditions
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'sub_payment_' + payment.subscriberId}))`
    );

    // Re-verify reversed state after acquiring subscriber advisory lock
    const [rechecked] = await tx
      .select({ isReversed: payments.isReversed })
      .from(payments)
      .where(eq(payments.id, payment.id));
    if (rechecked?.isReversed) {
      const err: any = new Error('Payment has already been reversed');
      err.statusCode = 400;
      err.code = 'ALREADY_REVERSED';
      throw err;
    }

    // 3. Fetch allocations for this payment
    const allocations = await tx
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, payment.id));

    // 4. Restore invoice balances and statuses
    let totalAllocatedRestored = 0;
    const restoredInvoices = [];

    for (const alloc of allocations) {
      totalAllocatedRestored += alloc.allocatedCentavos;

      const [invoice] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, alloc.invoiceId))
        .for('update');

      if (invoice) {
        const newAllocated = Math.max(0, invoice.allocatedCentavos - alloc.allocatedCentavos);
        const newRemaining = invoice.totalDueCentavos - newAllocated;

        let newStatus: string;
        if (newRemaining >= invoice.totalDueCentavos) {
          const isOverdue = calculateDaysOverdue(invoice.dueDate) > 0;
          newStatus = isOverdue ? 'OVERDUE' : 'UNPAID';
        } else if (newRemaining > 0) {
          newStatus = 'PARTIALLY_PAID';
        } else {
          newStatus = 'PAID';
        }

        const [updatedInvoice] = await tx
          .update(invoices)
          .set({
            allocatedCentavos: newAllocated,
            remainingBalanceCentavos: newRemaining,
            status: newStatus,
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, invoice.id))
          .returning();

        restoredInvoices.push(updatedInvoice);
      }
    }

    // 5. Reverse advance credit created by this payment (if any)
    const advanceCreditFromPayment = payment.amountCentavos - totalAllocatedRestored;
    if (advanceCreditFromPayment > 0) {
      const [currentSub] = await tx
        .select({ advanceCreditCentavos: subscribers.advanceCreditCentavos })
        .from(subscribers)
        .where(eq(subscribers.id, payment.subscriberId));

      if ((currentSub?.advanceCreditCentavos ?? 0) < advanceCreditFromPayment) {
        const err: any = new Error(
          `Cannot reverse payment: advance credit from this payment has already been utilized (Available: ₱${((currentSub?.advanceCreditCentavos ?? 0) / 100).toFixed(2)}, Required: ₱${(advanceCreditFromPayment / 100).toFixed(2)})`
        );
        err.statusCode = 400;
        err.code = 'ADVANCE_CREDIT_ALREADY_UTILIZED';
        throw err;
      }

      await tx
        .update(subscribers)
        .set({
          advanceCreditCentavos: sql`${subscribers.advanceCreditCentavos} - ${advanceCreditFromPayment}`,
          updatedAt: new Date(),
        })
        .where(eq(subscribers.id, payment.subscriberId));
    }

    // 6. Mark payment as reversed
    const [updatedPayment] = await tx
      .update(payments)
      .set({ isReversed: true })
      .where(eq(payments.id, payment.id))
      .returning();

    // 7. Mark receipt as REVERSED
    await tx
      .update(receipts)
      .set({ status: 'REVERSED' })
      .where(eq(receipts.paymentId, payment.id));

    // 8. Insert formal payment reversal record
    const reversedBy = await resolveUserId(actor, tx);
    const [insertedReversal] = await tx
      .insert(paymentReversals)
      .values({
        paymentId: payment.id,
        reversedBy,
        reason: input.reason,
        reversalDate: new Date(),
      })
      .returning();

    // 9. Update Subscriber Running Ledger (Double-Entry Debit Reversal)
    let currentBalance = await getSubscriberCurrentLedgerBalance(payment.subscriberId, tx);
    currentBalance += payment.amountCentavos;

    await tx.insert(subscriberLedger).values({
      subscriberId: payment.subscriberId,
      entryType: 'PAYMENT_REVERSAL',
      referenceId: payment.paymentNumber,
      description: `Payment reversal for ${payment.paymentNumber}: ${input.reason}`.slice(0, 255),
      debitCentavos: payment.amountCentavos,
      creditCentavos: 0,
      balanceAfterCentavos: currentBalance,
    });

    // 10. Audit Log Entry
    await writeAuditLog(
      {
        actorId: actor.id,
        actorName: actor.name,
        action: 'PAYMENT_REVERSED',
        entityType: 'payments',
        entityId: payment.id,
        oldValues: { isReversed: false },
        newValues: { isReversed: true, reversalId: insertedReversal.id },
        reason: input.reason,
        ipAddress: ip,
      },
      tx
    );

    return {
      message: 'Payment reversed successfully',
      reversal: insertedReversal,
      payment: updatedPayment,
      restoredInvoices,
      advanceCreditReversedCentavos: Math.max(0, advanceCreditFromPayment),
    };
  });
}

/**
 * Queries payment history with comprehensive filtering and pagination.
 */
export async function getPayments(query: PaymentQueryInput) {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const offset = (page - 1) * limit;

  const conditions = [];

  if (query.subscriberId) {
    conditions.push(eq(payments.subscriberId, query.subscriberId));
  }

  if (query.cashierId) {
    conditions.push(eq(payments.cashierId, query.cashierId));
  }

  const method = query.paymentMethod || query.method;
  if (method) {
    conditions.push(eq(payments.paymentMethod, method));
  }

  const startDate = query.startDate || query.date_from;
  if (startDate) {
    const start = new Date(startDate);
    if (!isNaN(start.getTime())) {
      start.setHours(0, 0, 0, 0);
      conditions.push(gte(payments.paymentDate, start));
    }
  }

  const endDate = query.endDate || query.date_to;
  if (endDate) {
    const end = new Date(endDate);
    if (!isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(payments.paymentDate, end));
    }
  }

  if (typeof query.isReversed === 'boolean') {
    conditions.push(eq(payments.isReversed, query.isReversed));
  }

  if (query.search && query.search.trim() !== '') {
    const term = `%${query.search.trim()}%`;
    conditions.push(
      or(
        ilike(payments.paymentNumber, term),
        ilike(payments.referenceNumber, term),
        ilike(payments.notes, term),
        ilike(receipts.receiptNumber, term)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Order by
  const sortCol =
    query.sortBy === 'paymentNumber'
      ? payments.paymentNumber
      : query.sortBy === 'amountCentavos'
      ? payments.amountCentavos
      : query.sortBy === 'createdAt'
      ? payments.createdAt
      : payments.paymentDate;

  const orderByClause = query.sortOrder === 'asc' ? asc(sortCol) : desc(sortCol);

  // Total count (joined with receipts to support receiptNumber search)
  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(payments)
    .leftJoin(receipts, eq(receipts.paymentId, payments.id))
    .where(whereClause);

  const total = Number(totalCount);

  // Data rows with joins
  const rows = await db
    .select({
      payment: payments,
      receipt: receipts,
      subscriber: {
        id: subscribers.id,
        accountNumber: subscribers.accountNumber,
        firstName: subscribers.firstName,
        lastName: subscribers.lastName,
        businessName: subscribers.businessName,
      },
      cashier: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
      },
    })
    .from(payments)
    .leftJoin(receipts, eq(receipts.paymentId, payments.id))
    .leftJoin(subscribers, eq(subscribers.id, payments.subscriberId))
    .leftJoin(users, eq(users.id, payments.cashierId))
    .where(whereClause)
    .orderBy(orderByClause)
    .limit(limit)
    .offset(offset);

  const data = rows.map((r) => ({
    ...r.payment,
    receipt: r.receipt,
    subscriber: r.subscriber,
    cashier: r.cashier,
  }));

  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Retrieves full payment detail by ID, including allocations, receipt, and reversal info.
 */
export async function getPaymentById(id: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const paymentCondition = isUuid ? eq(payments.id, id) : sql`lower(${payments.paymentNumber}) = lower(${id.trim()})`;

  const [row] = await db
    .select({
      payment: payments,
      receipt: receipts,
      subscriber: {
        id: subscribers.id,
        accountNumber: subscribers.accountNumber,
        firstName: subscribers.firstName,
        lastName: subscribers.lastName,
        businessName: subscribers.businessName,
        contactNumber: subscribers.contactNumber,
      },
      cashier: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
      },
    })
    .from(payments)
    .leftJoin(receipts, eq(receipts.paymentId, payments.id))
    .leftJoin(subscribers, eq(subscribers.id, payments.subscriberId))
    .leftJoin(users, eq(users.id, payments.cashierId))
    .where(paymentCondition);

  if (!row) {
    const err: any = new Error('Payment not found');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  // Fetch allocations using confirmed UUID
  const allocRows = await db
    .select({
      allocation: paymentAllocations,
      invoice: {
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        totalDueCentavos: invoices.totalDueCentavos,
        remainingBalanceCentavos: invoices.remainingBalanceCentavos,
        status: invoices.status,
        billingPeriodStart: invoices.billingPeriodStart,
        billingPeriodEnd: invoices.billingPeriodEnd,
      },
    })
    .from(paymentAllocations)
    .leftJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
    .where(eq(paymentAllocations.paymentId, row.payment.id));

  // Fetch reversal details if payment is reversed using confirmed UUID
  let reversal = null;
  if (row.payment.isReversed) {
    const [rev] = await db
      .select({
        reversal: paymentReversals,
        reversedByName: users.fullName,
      })
      .from(paymentReversals)
      .leftJoin(users, eq(users.id, paymentReversals.reversedBy))
      .where(eq(paymentReversals.paymentId, row.payment.id));

    if (rev) {
      reversal = {
        ...rev.reversal,
        reversedByName: rev.reversedByName,
      };
    }
  }

  return {
    ...row.payment,
    receipt: row.receipt,
    subscriber: row.subscriber,
    cashier: row.cashier,
    allocations: allocRows.map((a) => ({
      ...a.allocation,
      invoice: a.invoice,
    })),
    reversal,
  };
}

/**
 * Fetches printable official receipt by receipt ID or receiptNumber.
 */
export async function getReceiptByIdOrNumber(idOrNumber: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrNumber);

  const condition = isUuid
    ? eq(receipts.id, idOrNumber)
    : sql`lower(${receipts.receiptNumber}) = lower(${idOrNumber.trim()})`;

  const [row] = await db
    .select({
      receipt: receipts,
      payment: payments,
      subscriber: {
        id: subscribers.id,
        accountNumber: subscribers.accountNumber,
        firstName: subscribers.firstName,
        lastName: subscribers.lastName,
        businessName: subscribers.businessName,
      },
      cashier: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
      },
    })
    .from(receipts)
    .leftJoin(payments, eq(payments.id, receipts.paymentId))
    .leftJoin(subscribers, eq(subscribers.id, payments.subscriberId))
    .leftJoin(users, eq(users.id, receipts.cashierId))
    .where(condition);

  if (!row) {
    const err: any = new Error('Receipt not found');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  // Fetch allocations for line-item receipt breakdown
  let allocations: any[] = [];
  if (row.payment?.id) {
    allocations = await db
      .select({
        allocation: paymentAllocations,
        invoiceNumber: invoices.invoiceNumber,
      })
      .from(paymentAllocations)
      .leftJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
      .where(eq(paymentAllocations.paymentId, row.payment.id));
  }

  return {
    ...row.receipt,
    payment: row.payment,
    subscriber: row.subscriber,
    cashier: row.cashier,
    allocations: allocations.map((a) => ({
      ...a.allocation,
      invoiceNumber: a.invoiceNumber,
    })),
  };
}

/**
 * Reprints an official receipt and writes an audit log event.
 */
export async function reprintReceipt(
  idOrNumber: string,
  actor: { id?: string; name: string },
  ip?: string
) {
  const receiptData = await getReceiptByIdOrNumber(idOrNumber);

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'RECEIPT_REPRINTED',
    entityType: 'receipts',
    entityId: receiptData.id,
    newValues: {
      receiptNumber: receiptData.receiptNumber,
      reprintedAt: new Date().toISOString(),
    },
    reason: 'Duplicate copy reprinted by authorized staff',
    ipAddress: ip,
  });

  return {
    ...receiptData,
    isReprint: true,
    reprintedAt: new Date().toISOString(),
    reprintedBy: actor.name,
  };
}
