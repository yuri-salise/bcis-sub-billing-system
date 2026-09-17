import { db } from '../../db/client.js';
import {
  dunningNotices,
  serviceAccounts,
  subscribers,
  subscriberAddresses,
  servicePlans,
  invoices,
  serviceOrders,
  users,
} from '../../db/schema.js';
import { eq, and, sql, desc, asc, ilike, notInArray, inArray } from 'drizzle-orm';
import { calculateDaysOverdue } from '@bcis/domain';
import {
  GenerateDunningNoticesInput,
  DunningNoticeQueryInput,
  DeliverDunningNoticeInput,
  ResolveDunningNoticeInput,
  CancelDunningNoticeInput,
} from '@bcis/validation';
import { DunningNoticeDto, DunningStatus } from '@bcis/shared-types';
import { writeAuditLog } from '../../utils/audit.js';
import { generateServiceOrderNumber } from '../service-orders/service-orders.service.js';

export interface ActorInfo {
  id?: string;
  name: string;
  ip?: string;
}

function extractYearMonth(dateStr?: string): string {
  const d = dateStr ? new Date(dateStr) : new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}${mm}`;
}

/**
 * Generates the next sequential dunning notice number in format DUN-YYYYMM-XXXX.
 * Uses PostgreSQL advisory locking for collision-free sequential numbering.
 */
export async function generateDunningNoticeNumber(
  dateStr?: string,
  offset = 1,
  tx: any = db
): Promise<string> {
  const yearMonth = extractYearMonth(dateStr);
  const prefix = `DUN-${yearMonth}-`;

  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${'dunning_numbering_' + yearMonth}))`
  );

  const existing = await tx
    .select({ noticeNumber: dunningNotices.noticeNumber })
    .from(dunningNotices)
    .where(ilike(dunningNotices.noticeNumber, `${prefix}%`));

  let maxSeq = 0;
  for (const row of existing) {
    const part = row.noticeNumber.slice(prefix.length);
    const num = parseInt(part, 10);
    if (!isNaN(num) && num > maxSeq) {
      maxSeq = num;
    }
  }

  const nextSeq = String(maxSeq + offset).padStart(4, '0');
  return `${prefix}${nextSeq}`;
}

/**
 * Generates dunning notices for overdue service accounts.
 */
export async function generateDunningNotices(
  input: GenerateDunningNoticesInput,
  actor: ActorInfo,
  ip?: string
): Promise<{ generated: DunningNoticeDto[]; count: number; skippedCount: number }> {
  const minDays = input.minDaysOverdue || 30;
  const now = new Date();

  return await db.transaction(async (tx) => {
    // 1. Find active service accounts matching criteria with unpaid invoices
    const openInvoiceRows = await tx
      .select({
        serviceAccountId: serviceAccounts.id,
        subscriberId: serviceAccounts.subscriberId,
        invoiceDueDate: invoices.dueDate,
        remainingBalanceCentavos: invoices.remainingBalanceCentavos,
      })
      .from(serviceAccounts)
      .innerJoin(invoices, eq(serviceAccounts.id, invoices.serviceAccountId))
      .where(
        and(
          eq(serviceAccounts.status, 'ACTIVE'),
          sql`${invoices.remainingBalanceCentavos} > 0`,
          notInArray(invoices.status, ['VOID', 'CREDITED']),
          input.serviceAccountId ? eq(serviceAccounts.id, input.serviceAccountId) : undefined,
          input.collectionAreaId ? eq(serviceAccounts.collectionAreaId, input.collectionAreaId) : undefined
        )
      );

    // Group by service account to find max days overdue, oldest due date, and total balance
    const candidateMap = new Map<
      string,
      {
        serviceAccountId: string;
        subscriberId: string;
        oldestDueDate: string;
        maxDaysOverdue: number;
        totalOverdueCentavos: number;
      }
    >();

    for (const row of openInvoiceRows) {
      const daysOverdue = calculateDaysOverdue(row.invoiceDueDate, now);
      const bal = Number(row.remainingBalanceCentavos);

      if (!candidateMap.has(row.serviceAccountId)) {
        candidateMap.set(row.serviceAccountId, {
          serviceAccountId: row.serviceAccountId,
          subscriberId: row.subscriberId,
          oldestDueDate: row.invoiceDueDate,
          maxDaysOverdue: daysOverdue,
          totalOverdueCentavos: 0,
        });
      }

      const entry = candidateMap.get(row.serviceAccountId)!;
      entry.totalOverdueCentavos += bal;
      if (daysOverdue > entry.maxDaysOverdue) {
        entry.maxDaysOverdue = daysOverdue;
        entry.oldestDueDate = row.invoiceDueDate;
      }
    }

    // Filter accounts exceeding minDaysOverdue
    const eligibleAccounts = Array.from(candidateMap.values()).filter(
      (a) => a.maxDaysOverdue >= minDays && a.totalOverdueCentavos > 0
    );

    const generatedNotices: DunningNoticeDto[] = [];
    let skippedCount = 0;
    let seqOffset = 1;

    for (const acc of eligibleAccounts) {
      // Determine notice level if not explicitly provided
      let level = input.noticeLevel;
      if (!level) {
        if (acc.maxDaysOverdue >= 90) level = 3;
        else if (acc.maxDaysOverdue >= 60) level = 2;
        else level = 1;
      }

      // Check if an active notice (ISSUED or DELIVERED) at this level already exists for this account
      const [existingActive] = await tx
        .select()
        .from(dunningNotices)
        .where(
          and(
            eq(dunningNotices.serviceAccountId, acc.serviceAccountId),
            eq(dunningNotices.noticeLevel, level),
            inArray(dunningNotices.status, ['ISSUED', 'DELIVERED'])
          )
        )
        .limit(1);

      if (existingActive) {
        skippedCount++;
        continue;
      }

      const noticeNumber = await generateDunningNoticeNumber(undefined, seqOffset++, tx);

      const [inserted] = await tx
        .insert(dunningNotices)
        .values({
          noticeNumber,
          serviceAccountId: acc.serviceAccountId,
          subscriberId: acc.subscriberId,
          noticeLevel: level,
          status: 'ISSUED',
          overdueBalanceCentavos: acc.totalOverdueCentavos,
          daysOverdue: acc.maxDaysOverdue,
          oldestInvoiceDueDate: acc.oldestDueDate,
          issuedBy: actor.id,
          notes: input.notes || null,
        })
        .returning();

      generatedNotices.push({
        ...inserted,
        noticeLevel: inserted.noticeLevel,
        overdueBalanceCentavos: Number(inserted.overdueBalanceCentavos),
        daysOverdue: inserted.daysOverdue,
      } as DunningNoticeDto);

      // Audit log per notice
      await writeAuditLog(
        {
          actorId: actor.id,
          actorName: actor.name,
          action: 'DUNNING_NOTICE_GENERATED',
          entityType: 'DUNNING_NOTICE',
          entityId: inserted.id,
          newValues: {
            noticeNumber: inserted.noticeNumber,
            serviceAccountId: acc.serviceAccountId,
            subscriberId: acc.subscriberId,
            noticeLevel: level,
            overdueBalanceCentavos: acc.totalOverdueCentavos,
            daysOverdue: acc.maxDaysOverdue,
          },
          ipAddress: ip,
        },
        tx
      );
    }

    return {
      generated: generatedNotices,
      count: generatedNotices.length,
      skippedCount,
    };
  });
}

/**
 * List dunning notices with pagination, filtering, and search.
 */
export async function listDunningNotices(query: DunningNoticeQueryInput) {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const offset = (page - 1) * limit;

  const conditions = [];

  if (query.status) {
    conditions.push(eq(dunningNotices.status, query.status));
  }
  if (query.serviceAccountId) {
    conditions.push(eq(dunningNotices.serviceAccountId, query.serviceAccountId));
  }
  if (query.subscriberId) {
    conditions.push(eq(dunningNotices.subscriberId, query.subscriberId));
  }
  if (query.noticeLevel) {
    conditions.push(eq(dunningNotices.noticeLevel, query.noticeLevel));
  }
  if (query.search) {
    const term = `%${query.search.trim()}%`;
    conditions.push(
      sql`(${dunningNotices.noticeNumber} ILIKE ${term} OR ${serviceAccounts.serviceAccountNumber} ILIKE ${term} OR ${subscribers.firstName} || ' ' || ${subscribers.lastName} ILIKE ${term})`
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ total: sql<string>`count(*)` })
    .from(dunningNotices)
    .innerJoin(serviceAccounts, eq(dunningNotices.serviceAccountId, serviceAccounts.id))
    .innerJoin(subscribers, eq(dunningNotices.subscriberId, subscribers.id))
    .where(whereClause);

  const total = Number(countResult?.total || 0);

  const orderByCol =
    query.sortBy === 'noticeNumber'
      ? dunningNotices.noticeNumber
      : query.sortBy === 'daysOverdue'
      ? dunningNotices.daysOverdue
      : query.sortBy === 'overdueBalanceCentavos'
      ? dunningNotices.overdueBalanceCentavos
      : query.sortBy === 'status'
      ? dunningNotices.status
      : dunningNotices.issuedAt;

  const orderDir = query.sortOrder === 'asc' ? asc(orderByCol) : desc(orderByCol);

  const rows = await db
    .select({
      id: dunningNotices.id,
      noticeNumber: dunningNotices.noticeNumber,
      serviceAccountId: dunningNotices.serviceAccountId,
      subscriberId: dunningNotices.subscriberId,
      noticeLevel: dunningNotices.noticeLevel,
      status: dunningNotices.status,
      overdueBalanceCentavos: dunningNotices.overdueBalanceCentavos,
      daysOverdue: dunningNotices.daysOverdue,
      oldestInvoiceDueDate: dunningNotices.oldestInvoiceDueDate,
      issuedAt: dunningNotices.issuedAt,
      issuedBy: dunningNotices.issuedBy,
      deliveredAt: dunningNotices.deliveredAt,
      deliveredBy: dunningNotices.deliveredBy,
      deliveryNotes: dunningNotices.deliveryNotes,
      resolvedAt: dunningNotices.resolvedAt,
      resolvedReason: dunningNotices.resolvedReason,
      notes: dunningNotices.notes,
      createdAt: dunningNotices.createdAt,
      updatedAt: dunningNotices.updatedAt,
      serviceAccountNumber: serviceAccounts.serviceAccountNumber,
      serviceAccountStatus: serviceAccounts.status,
      planName: servicePlans.name,
      currentRateCentavos: serviceAccounts.currentRateCentavos,
      subscriberAccountNumber: subscribers.accountNumber,
      subscriberFirstName: subscribers.firstName,
      subscriberLastName: subscribers.lastName,
      contactNumber: subscribers.contactNumber,
    })
    .from(dunningNotices)
    .innerJoin(serviceAccounts, eq(dunningNotices.serviceAccountId, serviceAccounts.id))
    .innerJoin(subscribers, eq(dunningNotices.subscriberId, subscribers.id))
    .leftJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
    .where(whereClause)
    .orderBy(orderDir)
    .limit(limit)
    .offset(offset);

  const data: DunningNoticeDto[] = rows.map((r) => ({
    id: r.id,
    noticeNumber: r.noticeNumber,
    serviceAccountId: r.serviceAccountId,
    subscriberId: r.subscriberId,
    noticeLevel: r.noticeLevel,
    status: r.status,
    overdueBalanceCentavos: Number(r.overdueBalanceCentavos),
    daysOverdue: r.daysOverdue,
    oldestInvoiceDueDate: r.oldestInvoiceDueDate,
    issuedAt: r.issuedAt,
    issuedBy: r.issuedBy,
    deliveredAt: r.deliveredAt,
    deliveredBy: r.deliveredBy,
    deliveryNotes: r.deliveryNotes,
    resolvedAt: r.resolvedAt,
    resolvedReason: r.resolvedReason,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    serviceAccount: {
      id: r.serviceAccountId,
      serviceAccountNumber: r.serviceAccountNumber,
      status: r.serviceAccountStatus,
      planName: r.planName || undefined,
      currentRateCentavos: Number(r.currentRateCentavos),
    },
    subscriber: {
      id: r.subscriberId,
      accountNumber: r.subscriberAccountNumber,
      firstName: r.subscriberFirstName,
      lastName: r.subscriberLastName,
      contactNumber: r.contactNumber,
    },
  }));

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Get dunning notice by ID with details.
 */
export async function getDunningNoticeById(id: string): Promise<DunningNoticeDto> {
  const [row] = await db
    .select({
      id: dunningNotices.id,
      noticeNumber: dunningNotices.noticeNumber,
      serviceAccountId: dunningNotices.serviceAccountId,
      subscriberId: dunningNotices.subscriberId,
      noticeLevel: dunningNotices.noticeLevel,
      status: dunningNotices.status,
      overdueBalanceCentavos: dunningNotices.overdueBalanceCentavos,
      daysOverdue: dunningNotices.daysOverdue,
      oldestInvoiceDueDate: dunningNotices.oldestInvoiceDueDate,
      issuedAt: dunningNotices.issuedAt,
      issuedBy: dunningNotices.issuedBy,
      deliveredAt: dunningNotices.deliveredAt,
      deliveredBy: dunningNotices.deliveredBy,
      deliveryNotes: dunningNotices.deliveryNotes,
      resolvedAt: dunningNotices.resolvedAt,
      resolvedReason: dunningNotices.resolvedReason,
      notes: dunningNotices.notes,
      createdAt: dunningNotices.createdAt,
      updatedAt: dunningNotices.updatedAt,
      serviceAccountNumber: serviceAccounts.serviceAccountNumber,
      serviceAccountStatus: serviceAccounts.status,
      planName: servicePlans.name,
      currentRateCentavos: serviceAccounts.currentRateCentavos,
      subscriberAccountNumber: subscribers.accountNumber,
      subscriberFirstName: subscribers.firstName,
      subscriberLastName: subscribers.lastName,
      contactNumber: subscribers.contactNumber,
    })
    .from(dunningNotices)
    .innerJoin(serviceAccounts, eq(dunningNotices.serviceAccountId, serviceAccounts.id))
    .innerJoin(subscribers, eq(dunningNotices.subscriberId, subscribers.id))
    .leftJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
    .where(eq(dunningNotices.id, id))
    .limit(1);

  if (!row) {
    const error: any = new Error(`Dunning notice with ID ${id} not found`);
    error.statusCode = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  return {
    id: row.id,
    noticeNumber: row.noticeNumber,
    serviceAccountId: row.serviceAccountId,
    subscriberId: row.subscriberId,
    noticeLevel: row.noticeLevel,
    status: row.status,
    overdueBalanceCentavos: Number(row.overdueBalanceCentavos),
    daysOverdue: row.daysOverdue,
    oldestInvoiceDueDate: row.oldestInvoiceDueDate,
    issuedAt: row.issuedAt,
    issuedBy: row.issuedBy,
    deliveredAt: row.deliveredAt,
    deliveredBy: row.deliveredBy,
    deliveryNotes: row.deliveryNotes,
    resolvedAt: row.resolvedAt,
    resolvedReason: row.resolvedReason,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    serviceAccount: {
      id: row.serviceAccountId,
      serviceAccountNumber: row.serviceAccountNumber,
      status: row.serviceAccountStatus,
      planName: row.planName || undefined,
      currentRateCentavos: Number(row.currentRateCentavos),
    },
    subscriber: {
      id: row.subscriberId,
      accountNumber: row.subscriberAccountNumber,
      firstName: row.subscriberFirstName,
      lastName: row.subscriberLastName,
      contactNumber: row.contactNumber,
    },
  };
}

/**
 * Deliver dunning notice: marks status DELIVERED.
 */
export async function deliverDunningNotice(
  id: string,
  input: DeliverDunningNoticeInput,
  actor: ActorInfo,
  ip?: string
): Promise<DunningNoticeDto> {
  const existing = await getDunningNoticeById(id);

  if (existing.status === 'RESOLVED' || existing.status === 'CANCELLED') {
    const error: any = new Error(
      `Cannot mark notice as DELIVERED because it is already ${existing.status}`
    );
    error.statusCode = 400;
    error.code = 'INVALID_STATUS_TRANSITION';
    throw error;
  }

  const deliveredDate = input.deliveredAt ? new Date(input.deliveredAt) : new Date();

  const [updated] = await db
    .update(dunningNotices)
    .set({
      status: 'DELIVERED',
      deliveredAt: deliveredDate,
      deliveredBy: actor.id,
      deliveryNotes: input.deliveryNotes || existing.deliveryNotes,
      updatedAt: new Date(),
    })
    .where(eq(dunningNotices.id, id))
    .returning();

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'DUNNING_NOTICE_DELIVERED',
    entityType: 'DUNNING_NOTICE',
    entityId: id,
    oldValues: { status: existing.status },
    newValues: {
      status: 'DELIVERED',
      deliveredAt: deliveredDate.toISOString(),
      deliveredBy: actor.id,
      deliveryNotes: input.deliveryNotes,
    },
    ipAddress: ip,
  });

  return {
    ...existing,
    status: updated.status,
    deliveredAt: updated.deliveredAt,
    deliveredBy: updated.deliveredBy,
    deliveryNotes: updated.deliveryNotes,
    updatedAt: updated.updatedAt,
  };
}

/**
 * Resolve dunning notice: marks status RESOLVED with documented reason.
 */
export async function resolveDunningNotice(
  id: string,
  input: ResolveDunningNoticeInput,
  actor: ActorInfo,
  ip?: string
): Promise<DunningNoticeDto> {
  const existing = await getDunningNoticeById(id);

  if (existing.status === 'RESOLVED') {
    return existing;
  }
  if (existing.status === 'CANCELLED') {
    const error: any = new Error('Cannot resolve a cancelled dunning notice');
    error.statusCode = 400;
    error.code = 'INVALID_STATUS_TRANSITION';
    throw error;
  }

  const now = new Date();

  const [updated] = await db
    .update(dunningNotices)
    .set({
      status: 'RESOLVED',
      resolvedAt: now,
      resolvedReason: input.resolvedReason,
      notes: input.notes || existing.notes,
      updatedAt: now,
    })
    .where(eq(dunningNotices.id, id))
    .returning();

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'DUNNING_NOTICE_RESOLVED',
    entityType: 'DUNNING_NOTICE',
    entityId: id,
    oldValues: { status: existing.status },
    newValues: {
      status: 'RESOLVED',
      resolvedReason: input.resolvedReason,
      resolvedAt: now.toISOString(),
    },
    ipAddress: ip,
  });

  return {
    ...existing,
    status: updated.status,
    resolvedAt: updated.resolvedAt,
    resolvedReason: updated.resolvedReason,
    notes: updated.notes,
    updatedAt: updated.updatedAt,
  };
}

/**
 * Cancel dunning notice: marks status CANCELLED with documented reason.
 */
export async function cancelDunningNotice(
  id: string,
  input: CancelDunningNoticeInput,
  actor: ActorInfo,
  ip?: string
): Promise<DunningNoticeDto> {
  const existing = await getDunningNoticeById(id);

  if (existing.status === 'RESOLVED') {
    const error: any = new Error('Cannot cancel an already resolved dunning notice');
    error.statusCode = 400;
    error.code = 'INVALID_STATUS_TRANSITION';
    throw error;
  }
  if (existing.status === 'CANCELLED') {
    return existing;
  }

  const now = new Date();

  const [updated] = await db
    .update(dunningNotices)
    .set({
      status: 'CANCELLED',
      notes: input.reason,
      updatedAt: now,
    })
    .where(eq(dunningNotices.id, id))
    .returning();

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'DUNNING_NOTICE_CANCELLED',
    entityType: 'DUNNING_NOTICE',
    entityId: id,
    oldValues: { status: existing.status },
    newValues: {
      status: 'CANCELLED',
      cancellationReason: input.reason,
      updatedAt: now.toISOString(),
    },
    ipAddress: ip,
  });

  return {
    ...existing,
    status: updated.status,
    notes: updated.notes,
    updatedAt: updated.updatedAt,
  };
}

/**
 * Creates a DISCONNECTION service order directly from an active dunning notice.
 * Integrates dunning notices with the field service orders queue.
 */
export async function createDisconnectionOrderFromNotice(
  noticeId: string,
  actor: ActorInfo,
  ip?: string
) {
  const notice = await getDunningNoticeById(noticeId);

  if (notice.status === 'CANCELLED' || notice.status === 'RESOLVED') {
    const error: any = new Error(
      `Cannot issue disconnection order for a ${notice.status} dunning notice`
    );
    error.statusCode = 400;
    error.code = 'INVALID_NOTICE_STATUS';
    throw error;
  }

  return await db.transaction(async (tx) => {
    // 1. Verify service account is ACTIVE
    const [account] = await tx
      .select()
      .from(serviceAccounts)
      .where(eq(serviceAccounts.id, notice.serviceAccountId))
      .limit(1);

    if (!account) {
      const error: any = new Error('Associated service account not found');
      error.statusCode = 404;
      error.code = 'SERVICE_ACCOUNT_NOT_FOUND';
      throw error;
    }

    if (account.status !== 'ACTIVE') {
      const error: any = new Error(
        `Cannot issue disconnection order: Service account is currently ${account.status}`
      );
      error.statusCode = 400;
      error.code = 'INVALID_ACCOUNT_STATUS';
      throw error;
    }

    // 2. Check for existing pending/assigned disconnection order for this account
    const [existingOrder] = await tx
      .select()
      .from(serviceOrders)
      .where(
        and(
          eq(serviceOrders.serviceAccountId, notice.serviceAccountId),
          eq(serviceOrders.orderType, 'DISCONNECTION'),
          inArray(serviceOrders.status, ['PENDING', 'ASSIGNED', 'IN_PROGRESS'])
        )
      )
      .limit(1);

    if (existingOrder) {
      const error: any = new Error(
        `A disconnection service order (${existingOrder.orderNumber}) is already active for this account`
      );
      error.statusCode = 409;
      error.code = 'ACTIVE_ORDER_EXISTS';
      throw error;
    }

    const orderNumber = await generateServiceOrderNumber(undefined, 1, tx);

    const description = `Disconnection order generated from Dunning Notice ${notice.noticeNumber} (Overdue: PHP ${(notice.overdueBalanceCentavos / 100).toFixed(2)}, ${notice.daysOverdue} days past due)`;

    const [createdOrder] = await tx
      .insert(serviceOrders)
      .values({
        orderNumber,
        orderType: 'DISCONNECTION',
        status: 'PENDING',
        serviceAccountId: notice.serviceAccountId,
        subscriberId: notice.subscriberId,
        priority: 'HIGH',
        description,
        disconnectionType: 'TEMPORARY',
        feeCentavos: 0,
      })
      .returning();

    // Audit log
    await writeAuditLog(
      {
        actorId: actor.id,
        actorName: actor.name,
        action: 'DISCONNECTION_ORDER_FROM_DUNNING',
        entityType: 'SERVICE_ORDER',
        entityId: createdOrder.id,
        newValues: {
          orderNumber: createdOrder.orderNumber,
          dunningNoticeId: notice.id,
          dunningNoticeNumber: notice.noticeNumber,
          serviceAccountId: notice.serviceAccountId,
          overdueBalanceCentavos: notice.overdueBalanceCentavos,
        },
        ipAddress: ip,
      },
      tx
    );

    return createdOrder;
  });
}
