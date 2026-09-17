import { eq, and, desc, asc, count, sql, gte, lte, ilike } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  collectionBatches,
  collectionAreas,
  users,
  payments,
} from '../../db/schema.js';
import { writeAuditLog } from '../../utils/audit.js';
import { calculateRemittanceReconciliation, ReconciliationResult } from '@bcis/domain';
import {
  CreateBatchInput,
  ReconcileBatchInput,
  CashierShiftReconcileInput,
  CloseBatchInput,
} from '@bcis/validation';
import { CollectionBatchStatus } from '@bcis/shared-types';

/**
 * Generates next sequential batch number BAT-YYYYMM-XXXX
 */
export async function generateBatchNumber(tx: any = db): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `BAT-${yearMonth}-`;

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${'batch_numbering_' + yearMonth}))`
  );

  const existing = await tx
    .select({ batchNumber: collectionBatches.batchNumber })
    .from(collectionBatches)
    .where(ilike(collectionBatches.batchNumber, `${prefix}%`));

  let maxSeq = 0;
  for (const row of existing) {
    if (row.batchNumber.startsWith(prefix)) {
      const part = row.batchNumber.slice(prefix.length);
      const num = parseInt(part, 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  const nextSeq = String(maxSeq + 1).padStart(4, '0');
  return `${prefix}${nextSeq}`;
}

async function resolveCollectionAreaId(areaId?: string | null, tx: any = db): Promise<string> {
  if (areaId) {
    const [existingArea] = await tx
      .select({ id: collectionAreas.id })
      .from(collectionAreas)
      .where(eq(collectionAreas.id, areaId));

    if (!existingArea) {
      const err: any = new Error('Collection area not found');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    return existingArea.id;
  }
  const [firstArea] = await tx.select({ id: collectionAreas.id }).from(collectionAreas).limit(1);
  if (firstArea) return firstArea.id;
  const [createdArea] = await tx
    .insert(collectionAreas)
    .values({ name: 'Central District', description: 'Default office collection area' })
    .returning();
  return createdArea.id;
}

/**
 * Opens a new field collection batch for an assigned collector.
 */
export async function createCollectionBatch(
  input: CreateBatchInput,
  actor: { id?: string; name: string },
  ip?: string
) {
  return await db.transaction(async (tx) => {
    // 1. Verify collector exists
    const [collector] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.collectorId));

    if (!collector) {
      const err: any = new Error('Collector user not found');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    // 2. Resolve valid collection area ID
    const collectionAreaId = await resolveCollectionAreaId(input.collectionAreaId, tx);

    // 3. Generate batch number if omitted, or check uniqueness if provided
    let batchNumber = input.batchNumber;
    if (batchNumber) {
      const [existing] = await tx
        .select({ id: collectionBatches.id })
        .from(collectionBatches)
        .where(sql`lower(${collectionBatches.batchNumber}) = lower(${batchNumber.trim()})`);

      if (existing) {
        const err: any = new Error(`Collection batch number ${batchNumber} already exists`);
        err.statusCode = 409;
        err.code = 'DUPLICATE_BATCH_NUMBER';
        throw err;
      }
    } else {
      batchNumber = await generateBatchNumber(tx);
    }

    // 4. Insert collection batch
    const [inserted] = await tx
      .insert(collectionBatches)
      .values({
        batchNumber,
        collectorId: input.collectorId,
        collectionAreaId,
        expectedCashCentavos: input.expectedCashCentavos || 0,
        remittedCashCentavos: 0,
        differenceCentavos: 0,
        status: CollectionBatchStatus.OPEN,
        openedAt: new Date(),
      })
      .returning();

    await writeAuditLog(
      {
        actorId: actor.id,
        actorName: actor.name,
        action: 'COLLECTION_BATCH_CREATED',
        entityType: 'collection_batches',
        entityId: inserted.id,
        newValues: {
          batchNumber: inserted.batchNumber,
          collectorId: inserted.collectorId,
          expectedCashCentavos: inserted.expectedCashCentavos,
        },
        reason: 'Opened new field collection batch',
        ipAddress: ip,
      },
      tx
    );

    return inserted;
  });
}

/**
 * Queries collection batches with pagination and filters.
 */
export async function getCollectionBatches(query: {
  page?: number;
  limit?: number;
  status?: string;
  collectorId?: string;
}) {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const offset = (page - 1) * limit;

  const conditions = [];

  const upperStatus = query.status ? query.status.toUpperCase() : undefined;
  if (upperStatus && upperStatus !== 'ALL') {
    conditions.push(eq(collectionBatches.status, upperStatus));
  }

  if (query.collectorId) {
    conditions.push(eq(collectionBatches.collectorId, query.collectorId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ totalCount }] = await db
    .select({ totalCount: count() })
    .from(collectionBatches)
    .where(whereClause);

  const total = Number(totalCount);

  const rows = await db
    .select({
      batch: collectionBatches,
      collector: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
      },
      collectionArea: {
        id: collectionAreas.id,
        name: collectionAreas.name,
      },
    })
    .from(collectionBatches)
    .leftJoin(users, eq(users.id, collectionBatches.collectorId))
    .leftJoin(collectionAreas, eq(collectionAreas.id, collectionBatches.collectionAreaId))
    .where(whereClause)
    .orderBy(desc(collectionBatches.openedAt))
    .limit(limit)
    .offset(offset);

  const data = rows.map((r) => ({
    ...r.batch,
    collector: r.collector,
    collectionArea: r.collectionArea,
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
 * Retrieves a single collection batch by ID.
 */
export async function getCollectionBatchById(id: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const condition = isUuid ? eq(collectionBatches.id, id) : sql`lower(${collectionBatches.batchNumber}) = lower(${id.trim()})`;

  const [row] = await db
    .select({
      batch: collectionBatches,
      collector: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
      },
      collectionArea: {
        id: collectionAreas.id,
        name: collectionAreas.name,
      },
    })
    .from(collectionBatches)
    .leftJoin(users, eq(users.id, collectionBatches.collectorId))
    .leftJoin(collectionAreas, eq(collectionAreas.id, collectionBatches.collectionAreaId))
    .where(condition);

  if (!row) {
    const err: any = new Error('Collection batch not found');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  return {
    ...row.batch,
    collector: r_collector(row.collector),
    collectionArea: row.collectionArea,
  };
}

function r_collector(c: any) {
  return c?.id ? c : null;
}

/**
 * Reconciles a collector's remittance against expected cash collections (AT-07 & AT-08).
 * Uses domain financial engine calculateRemittanceReconciliation.
 * Identifies balanced batches (AT-07) and logs shortages (AT-08).
 */
export async function reconcileBatchRemittance(
  batchId: string,
  input: ReconcileBatchInput,
  actor: { id?: string; name: string },
  ip?: string
) {
  return await db.transaction(async (tx) => {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId);
    const condition = isUuid ? eq(collectionBatches.id, batchId) : sql`lower(${collectionBatches.batchNumber}) = lower(${batchId.trim()})`;

    // 1. Lock batch row
    const [batch] = await tx
      .select()
      .from(collectionBatches)
      .where(condition)
      .for('update');

    if (!batch) {
      const err: any = new Error('Collection batch not found');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (batch.status === CollectionBatchStatus.CLOSED) {
      const err: any = new Error('Cannot reconcile a closed collection batch');
      err.statusCode = 400;
      err.code = 'ALREADY_CLOSED';
      throw err;
    }

    // Determine expected cash (allow updating during reconciliation if provided)
    const effectiveExpectedCash =
      input.expectedCashCentavos !== undefined
        ? input.expectedCashCentavos
        : batch.expectedCashCentavos;

    // 2. Perform domain reconciliation calculation
    const reconciliation: ReconciliationResult = calculateRemittanceReconciliation(
      effectiveExpectedCash,
      input.remittedCashCentavos
    );

    // 3. Update collection batch with reconciliation results
    const [updatedBatch] = await tx
      .update(collectionBatches)
      .set({
        expectedCashCentavos: effectiveExpectedCash,
        remittedCashCentavos: input.remittedCashCentavos,
        differenceCentavos: reconciliation.differenceCentavos,
        status: reconciliation.recommendedStatus,
        closedAt: reconciliation.isBalanced ? new Date() : null,
      })
      .where(eq(collectionBatches.id, batch.id))
      .returning();

    // 4. Log reconciliation event (explicit shortage audit log for AT-08)
    await writeAuditLog(
      {
        actorId: actor.id,
        actorName: actor.name,
        action: reconciliation.isShortage ? 'REMITTANCE_SHORTAGE_DETECTED' : 'REMITTANCE_RECONCILED',
        entityType: 'collection_batches',
        entityId: batch.id,
        oldValues: {
          status: batch.status,
          remittedCashCentavos: batch.remittedCashCentavos,
          differenceCentavos: batch.differenceCentavos,
        },
        newValues: {
          status: updatedBatch.status,
          expectedCashCentavos: effectiveExpectedCash,
          remittedCashCentavos: input.remittedCashCentavos,
          differenceCentavos: reconciliation.differenceCentavos,
          isBalanced: reconciliation.isBalanced,
          isShortage: reconciliation.isShortage,
          isOverage: reconciliation.isOverage,
        },
        reason: input.supervisorNotes || reconciliation.statusMessage,
        ipAddress: ip,
      },
      tx
    );

    return {
      message: reconciliation.statusMessage,
      batch: updatedBatch,
      reconciliation,
    };
  });
}

/**
 * Closes an existing collection batch.
 * Enforces AT-08: Rejects closing batches with an unresolved shortage unless explicit override is provided.
 * Requires that batch has been reconciled prior to closing.
 */
export async function closeCollectionBatch(
  batchId: string,
  input: CloseBatchInput,
  actor: { id?: string; name: string },
  ip?: string
) {
  return await db.transaction(async (tx) => {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId);
    const condition = isUuid ? eq(collectionBatches.id, batchId) : sql`lower(${collectionBatches.batchNumber}) = lower(${batchId.trim()})`;

    const [batch] = await tx
      .select()
      .from(collectionBatches)
      .where(condition)
      .for('update');

    if (!batch) {
      const err: any = new Error('Collection batch not found');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (batch.status === CollectionBatchStatus.CLOSED) {
      const err: any = new Error('Collection batch is already closed');
      err.statusCode = 400;
      err.code = 'ALREADY_CLOSED';
      throw err;
    }

    // Require batch to have been reconciled first
    if (
      batch.status !== CollectionBatchStatus.RECONCILED &&
      batch.status !== CollectionBatchStatus.RECONCILED_WITH_SHORTAGE
    ) {
      const err: any = new Error(
        `Cannot close batch that has not been reconciled (Current status: ${batch.status})`
      );
      err.statusCode = 400;
      err.code = 'INVALID_STATUS';
      throw err;
    }

    // AT-08: Do not silently close as balanced if shortage exists
    if (batch.status === CollectionBatchStatus.RECONCILED_WITH_SHORTAGE && !input.force) {
      const err: any = new Error(
        `Cannot close batch with unresolved shortage (Difference: ₱${(batch.differenceCentavos / 100).toFixed(2)}) without supervisor authorization`
      );
      err.statusCode = 400;
      err.code = 'UNRESOLVED_SHORTAGE';
      throw err;
    }

    const [updatedBatch] = await tx
      .update(collectionBatches)
      .set({
        status: CollectionBatchStatus.CLOSED,
        closedAt: new Date(),
      })
      .where(eq(collectionBatches.id, batch.id))
      .returning();

    await writeAuditLog(
      {
        actorId: actor.id,
        actorName: actor.name,
        action: 'COLLECTION_BATCH_CLOSED',
        entityType: 'collection_batches',
        entityId: batch.id,
        oldValues: { status: batch.status },
        newValues: { status: CollectionBatchStatus.CLOSED },
        reason: input.reason || 'Batch formally closed',
        ipAddress: ip,
      },
      tx
    );

    return updatedBatch;
  });
}

/**
 * Reconciles end-of-shift physical cash turned in by a counter cashier against posted cash transactions.
 */
export async function reconcileCashierShift(
  input: CashierShiftReconcileInput,
  actor: { id?: string; name: string },
  ip?: string
) {
  const targetCashierId = input.cashierId || actor.id;

  if (!targetCashierId) {
    const err: any = new Error('Cashier ID is required for shift reconciliation');
    err.statusCode = 400;
    err.code = 'MISSING_CASHIER_ID';
    throw err;
  }

  // Verify cashier exists
  const [cashier] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, targetCashierId));

  if (!cashier) {
    const err: any = new Error('Cashier user not found');
    err.statusCode = 404;
    err.code = 'CASHIER_NOT_FOUND';
    throw err;
  }

  // Determine date bounds (default to current day if shiftDate omitted)
  const shiftDateStr = input.shiftDate || new Date().toISOString().split('T')[0];
  const start = new Date(shiftDateStr);
  start.setHours(0, 0, 0, 0);
  const end = new Date(shiftDateStr);
  end.setHours(23, 59, 59, 999);

  const conditions = [
    eq(payments.cashierId, targetCashierId),
    eq(payments.paymentMethod, 'CASH'),
    eq(payments.isReversed, false),
    gte(payments.paymentDate, start),
    lte(payments.paymentDate, end),
  ];

  // Calculate expected cash sum
  const [sumResult] = await db
    .select({
      totalCash: sql<number>`COALESCE(SUM(${payments.amountCentavos}), 0)::bigint`,
      count: count(),
    })
    .from(payments)
    .where(and(...conditions));

  const expectedCashCentavos = Number(sumResult?.totalCash ?? 0);
  const paymentCount = Number(sumResult?.count ?? 0);

  // Perform domain reconciliation
  const reconciliation = calculateRemittanceReconciliation(
    expectedCashCentavos,
    input.remittedCashCentavos
  );

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: reconciliation.isShortage
      ? 'CASHIER_SHIFT_SHORTAGE_DETECTED'
      : 'CASHIER_SHIFT_RECONCILED',
    entityType: 'cashier_shifts',
    entityId: targetCashierId,
    newValues: {
      cashierId: targetCashierId,
      shiftDate: shiftDateStr,
      paymentCount,
      expectedCashCentavos,
      remittedCashCentavos: input.remittedCashCentavos,
      differenceCentavos: reconciliation.differenceCentavos,
      isBalanced: reconciliation.isBalanced,
      isShortage: reconciliation.isShortage,
      isOverage: reconciliation.isOverage,
    },
    reason: input.notes || reconciliation.statusMessage,
    ipAddress: ip,
  });

  return {
    cashierId: targetCashierId,
    paymentCount,
    shiftDate: shiftDateStr,
    ...reconciliation,
  };
}
