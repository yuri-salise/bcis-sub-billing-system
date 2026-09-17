import { eq, and, desc, asc, count, or, ilike, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  gcashTransactions,
  payments,
  subscribers,
  users,
} from '../../db/schema.js';
import { writeAuditLog } from '../../utils/audit.js';
import { executePostPayment } from '../payments/payments.service.js';
import {
  SubmitGCashInput,
  VerifyGCashInput,
  RejectGCashInput,
} from '@bcis/validation';
import { PaymentMethod } from '@bcis/shared-types';

export interface GCashQueueQuery {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}

/**
 * Intakes a new customer/cashier submitted GCash payment attempt (AT-05).
 * Enforces strict uniqueness of reference number against prior submissions and posted payments.
 */
export async function intakeGCash(
  input: SubmitGCashInput,
  actor?: { id?: string; name: string },
  ip?: string
) {
  const cleanRef = input.referenceNumber.trim();

  // 1. Case-insensitive duplicate check in existing GCash intake queue
  const [existingInGcash] = await db
    .select({ id: gcashTransactions.id, status: gcashTransactions.status })
    .from(gcashTransactions)
    .where(sql`lower(${gcashTransactions.referenceNumber}) = lower(${cleanRef})`);

  if (existingInGcash) {
    const err: any = new Error(
      `GCash reference number ${cleanRef} has already been submitted (Status: ${existingInGcash.status})`
    );
    err.statusCode = 409;
    err.code = 'DUPLICATE_GCASH_REFERENCE';
    throw err;
  }

  // 2. Case-insensitive duplicate check in posted payments table
  const [existingInPayments] = await db
    .select({ id: payments.id, paymentNumber: payments.paymentNumber })
    .from(payments)
    .where(sql`lower(${payments.referenceNumber}) = lower(${cleanRef})`);

  if (existingInPayments) {
    const err: any = new Error(
      `GCash reference number ${cleanRef} was already processed under payment ${existingInPayments.paymentNumber}`
    );
    err.statusCode = 409;
    err.code = 'DUPLICATE_GCASH_REFERENCE';
    throw err;
  }

  // 3. Verify subscriber exists if subscriberId is passed
  if (input.subscriberId) {
    const [sub] = await db
      .select({ id: subscribers.id })
      .from(subscribers)
      .where(eq(subscribers.id, input.subscriberId));

    if (!sub) {
      const err: any = new Error('Subscriber not found');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
  }

  // 4. Insert into GCash intake queue (with unique violation race handling)
  try {
    const [inserted] = await db
      .insert(gcashTransactions)
      .values({
        referenceNumber: cleanRef,
        subscriberId: input.subscriberId || null,
        senderName: input.senderName.trim(),
        senderPhone: input.senderPhone.trim(),
        amountCentavos: input.amountCentavos,
        proofImagePath: input.proofImagePath.trim(),
        status: 'PENDING_VERIFICATION',
      })
      .returning();

    if (actor) {
      await writeAuditLog({
        actorId: actor.id,
        actorName: actor.name,
        action: 'GCASH_SUBMITTED',
        entityType: 'gcash_transactions',
        entityId: inserted.id,
        newValues: {
          referenceNumber: cleanRef,
          amountCentavos: input.amountCentavos,
          senderName: input.senderName,
        },
        reason: 'GCash transaction submitted to verification queue',
        ipAddress: ip,
      });
    }

    return inserted;
  } catch (dbErr: any) {
    if (dbErr?.code === '23505') {
      const err: any = new Error(
        `GCash reference number ${cleanRef} has already been submitted`
      );
      err.statusCode = 409;
      err.code = 'DUPLICATE_GCASH_REFERENCE';
      throw err;
    }
    throw dbErr;
  }
}

/**
 * Retrieves queue of GCash submissions with optional filtering and pagination.
 */
export async function getGCashQueue(query: GCashQueueQuery) {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const offset = (page - 1) * limit;

  const conditions = [];

  const upperStatus = query.status ? query.status.toUpperCase() : undefined;
  if (upperStatus && upperStatus !== 'ALL') {
    conditions.push(eq(gcashTransactions.status, upperStatus));
  } else if (!upperStatus) {
    // Default to pending queue
    conditions.push(eq(gcashTransactions.status, 'PENDING_VERIFICATION'));
  }

  if (query.search && query.search.trim() !== '') {
    const term = `%${query.search.trim()}%`;
    conditions.push(
      or(
        ilike(gcashTransactions.referenceNumber, term),
        ilike(gcashTransactions.senderName, term),
        ilike(gcashTransactions.senderPhone, term)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(gcashTransactions)
    .where(whereClause);

  const total = Number(totalCount);

  const rows = await db
    .select({
      transaction: gcashTransactions,
      subscriber: {
        id: subscribers.id,
        accountNumber: subscribers.accountNumber,
        firstName: subscribers.firstName,
        lastName: subscribers.lastName,
        businessName: subscribers.businessName,
      },
      verifier: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
      },
    })
    .from(gcashTransactions)
    .leftJoin(subscribers, eq(subscribers.id, gcashTransactions.subscriberId))
    .leftJoin(users, eq(users.id, gcashTransactions.verifiedBy))
    .where(whereClause)
    .orderBy(desc(gcashTransactions.createdAt))
    .limit(limit)
    .offset(offset);

  const data = rows.map((r) => ({
    ...r.transaction,
    subscriber: r.subscriber,
    verifier: r.verifier,
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
 * Verifies and posts an approved GCash transaction to the financial ledger (AT-05).
 * Atomically creates payment, updates invoices via FIFO, issues official receipt, and updates ledger.
 */
export async function verifyGCash(
  id: string,
  input: VerifyGCashInput,
  actor: { id?: string; name: string },
  ip?: string
) {
  return await db.transaction(async (tx) => {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const condition = isUuid ? eq(gcashTransactions.id, id) : sql`lower(${gcashTransactions.referenceNumber}) = lower(${id.trim()})`;

    // 1. Lock transaction row
    const [txRow] = await tx
      .select()
      .from(gcashTransactions)
      .where(condition)
      .for('update');

    if (!txRow) {
      const err: any = new Error('GCash transaction not found');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (txRow.status !== 'PENDING_VERIFICATION') {
      const err: any = new Error(
        `GCash transaction cannot be verified in current status: ${txRow.status}`
      );
      err.statusCode = 400;
      err.code = 'INVALID_STATUS';
      throw err;
    }

    // 2. Resolve subscriber ID
    const targetSubscriberId = input.subscriberId || txRow.subscriberId;
    if (!targetSubscriberId) {
      const err: any = new Error(
        'Subscriber ID is required to verify and post payment'
      );
      err.statusCode = 400;
      err.code = 'MISSING_SUBSCRIBER_ID';
      throw err;
    }

    // 3. Post payment using executePostPayment (passing sourceGcashId to bypass self-check)
    const payment = await executePostPayment(
      {
        subscriberId: targetSubscriberId,
        amountCentavos: txRow.amountCentavos,
        paymentMethod: PaymentMethod.GCASH,
        referenceNumber: txRow.referenceNumber,
        notes: input.notes || `GCash Payment (Ref: ${txRow.referenceNumber})`,
      },
      actor,
      tx,
      ip,
      { sourceGcashId: txRow.id }
    );

    // 4. Update GCash transaction status to VERIFIED
    const [updatedTx] = await tx
      .update(gcashTransactions)
      .set({
        subscriberId: targetSubscriberId,
        status: 'VERIFIED',
        verifiedBy: actor.id || null,
        verifiedAt: new Date(),
      })
      .where(eq(gcashTransactions.id, txRow.id))
      .returning();

    // 5. Write audit log
    await writeAuditLog(
      {
        actorId: actor.id,
        actorName: actor.name,
        action: 'GCASH_VERIFIED',
        entityType: 'gcash_transactions',
        entityId: updatedTx.id,
        oldValues: { status: 'PENDING_VERIFICATION' },
        newValues: {
          status: 'VERIFIED',
          paymentId: payment.id,
          paymentNumber: payment.paymentNumber,
          receiptNumber: payment.receipt?.receiptNumber,
        },
        reason: input.notes || 'GCash transaction verified and payment posted',
        ipAddress: ip,
      },
      tx
    );

    return {
      message: 'GCash transaction verified and payment posted successfully',
      gcash: updatedTx,
      payment,
    };
  });
}

/**
 * Rejects a GCash submission with documented reason under transaction-isolated lock.
 */
export async function rejectGCash(
  id: string,
  input: RejectGCashInput,
  actor: { id?: string; name: string },
  ip?: string
) {
  return await db.transaction(async (tx) => {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const condition = isUuid ? eq(gcashTransactions.id, id) : sql`lower(${gcashTransactions.referenceNumber}) = lower(${id.trim()})`;

    const [txRow] = await tx
      .select()
      .from(gcashTransactions)
      .where(condition)
      .for('update');

    if (!txRow) {
      const err: any = new Error('GCash transaction not found');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (txRow.status !== 'PENDING_VERIFICATION') {
      const err: any = new Error(
        `GCash transaction cannot be rejected in current status: ${txRow.status}`
      );
      err.statusCode = 400;
      err.code = 'INVALID_STATUS';
      throw err;
    }

    const [updatedTx] = await tx
      .update(gcashTransactions)
      .set({
        status: 'REJECTED',
        rejectionReason: input.reason.trim(),
        verifiedBy: actor.id || null,
        verifiedAt: new Date(),
      })
      .where(eq(gcashTransactions.id, txRow.id))
      .returning();

    await writeAuditLog(
      {
        actorId: actor.id,
        actorName: actor.name,
        action: 'GCASH_REJECTED',
        entityType: 'gcash_transactions',
        entityId: updatedTx.id,
        oldValues: { status: 'PENDING_VERIFICATION' },
        newValues: { status: 'REJECTED', rejectionReason: input.reason },
        reason: input.reason,
        ipAddress: ip,
      },
      tx
    );

    return {
      message: 'GCash transaction rejected',
      gcash: updatedTx,
    };
  });
}
