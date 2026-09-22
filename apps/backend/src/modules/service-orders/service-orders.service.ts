import { eq, and, or, ilike, desc, asc, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  serviceOrders,
  serviceAccounts,
  subscribers,
  subscriberAddresses,
  servicePlans,
  users,
} from '../../db/schema.js';
import {
  CreateServiceOrderInput,
  UpdateServiceOrderInput,
  AssignTechnicianInput,
  CompleteServiceOrderInput,
  CancelServiceOrderInput,
  ServiceOrderQueryInput,
} from '@bcis/validation';
import {
  ServiceOrderDto,
  ServiceOrderStatus,
  ServiceOrderType,
} from '@bcis/shared-types';
import { writeAuditLog } from '../../utils/audit.js';

/**
 * Extracts YYYYMM string from optional date string or current date.
 */
function extractYearMonth(dateStr?: string | null): string {
  if (dateStr && dateStr.length >= 7) {
    return dateStr.slice(0, 7).replace('-', '');
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

/**
 * Generates the next sequential service order number in the format SO-YYYYMM-XXXX.
 * Employs PostgreSQL transaction-scoped advisory locking to guarantee strict monotonicity and zero collision under concurrency.
 */
export async function generateServiceOrderNumber(
  dateStr?: string,
  offset = 1,
  tx: any = db
): Promise<string> {
  const yearMonth = extractYearMonth(dateStr);
  const prefix = `SO-${yearMonth}-`;

  // Transaction-scoped advisory lock for sequential service order numbering
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${'so_numbering_' + yearMonth}))`
  );

  const existing = await tx
    .select({ orderNumber: serviceOrders.orderNumber })
    .from(serviceOrders)
    .where(ilike(serviceOrders.orderNumber, `${prefix}%`));

  let maxSeq = 0;
  for (const row of existing) {
    const part = row.orderNumber.slice(prefix.length);
    const num = parseInt(part, 10);
    if (!isNaN(num) && num > maxSeq) {
      maxSeq = num;
    }
  }

  const nextSeq = String(maxSeq + offset).padStart(4, '0');
  return `${prefix}${nextSeq}`;
}

/**
 * Fetch service order by ID with subscriber, account, plan, and technician details.
 */
export async function getServiceOrderById(id: string): Promise<ServiceOrderDto | null> {
  const rows = await db
    .select({
      order: serviceOrders,
      sa: serviceAccounts,
      sub: subscribers,
      plan: servicePlans,
      tech: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
      },
    })
    .from(serviceOrders)
    .innerJoin(serviceAccounts, eq(serviceOrders.serviceAccountId, serviceAccounts.id))
    .innerJoin(subscribers, eq(serviceOrders.subscriberId, subscribers.id))
    .leftJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
    .leftJoin(users, eq(serviceOrders.assignedTechnicianId, users.id))
    .where(eq(serviceOrders.id, id))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];

  return {
    id: r.order.id,
    orderNumber: r.order.orderNumber,
    orderType: r.order.orderType,
    status: r.order.status,
    serviceAccountId: r.order.serviceAccountId,
    subscriberId: r.order.subscriberId,
    assignedTechnicianId: r.order.assignedTechnicianId,
    priority: r.order.priority,
    scheduledDate: r.order.scheduledDate ? String(r.order.scheduledDate) : null,
    completedAt: r.order.completedAt,
    cancelledAt: r.order.cancelledAt,
    cancellationReason: r.order.cancellationReason,
    targetAddressId: r.order.targetAddressId,
    description: r.order.description,
    resolutionNotes: r.order.resolutionNotes,
    materialsUsed: r.order.materialsUsed as any,
    feeCentavos: Number(r.order.feeCentavos || 0),
    disconnectionType: r.order.disconnectionType,
    createdAt: r.order.createdAt,
    updatedAt: r.order.updatedAt,
    serviceAccount: {
      id: r.sa.id,
      serviceAccountNumber: r.sa.serviceAccountNumber,
      status: r.sa.status,
      planName: r.plan?.name || 'Broadband Plan',
      currentRateCentavos: Number(r.sa.currentRateCentavos),
    },
    subscriber: {
      id: r.sub.id,
      accountNumber: r.sub.accountNumber,
      firstName: r.sub.firstName,
      lastName: r.sub.lastName,
      contactNumber: r.sub.contactNumber,
    },
    assignedTechnician: r.tech?.id ? (r.tech as any) : null,
  };
}

/**
 * List service orders with query filtering and pagination.
 */
export async function listServiceOrders(query: ServiceOrderQueryInput) {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const offset = (page - 1) * limit;

  const conditions = [];

  if (query.serviceAccountId) {
    conditions.push(eq(serviceOrders.serviceAccountId, query.serviceAccountId));
  }

  if (query.subscriberId) {
    conditions.push(eq(serviceOrders.subscriberId, query.subscriberId));
  }

  if (query.assignedTechnicianId) {
    conditions.push(eq(serviceOrders.assignedTechnicianId, query.assignedTechnicianId));
  }

  if (query.orderType) {
    conditions.push(eq(serviceOrders.orderType, query.orderType));
  }

  if (query.status) {
    conditions.push(eq(serviceOrders.status, query.status));
  }

  if (query.priority) {
    conditions.push(eq(serviceOrders.priority, query.priority));
  }

  if (query.search) {
    const s = `%${query.search}%`;
    conditions.push(
      or(
        ilike(serviceOrders.orderNumber, s),
        ilike(subscribers.accountNumber, s),
        ilike(subscribers.firstName, s),
        ilike(subscribers.lastName, s)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(serviceOrders)
    .innerJoin(subscribers, eq(serviceOrders.subscriberId, subscribers.id))
    .where(whereClause);
  const total = Number(countResult[0]?.count || 0);

  const orderByCol =
    query.sortBy === 'orderNumber'
      ? serviceOrders.orderNumber
      : query.sortBy === 'scheduledDate'
      ? serviceOrders.scheduledDate
      : query.sortBy === 'priority'
      ? serviceOrders.priority
      : query.sortBy === 'status'
      ? serviceOrders.status
      : serviceOrders.createdAt;

  const rows = await db
    .select({
      order: serviceOrders,
      sa: serviceAccounts,
      sub: subscribers,
      plan: servicePlans,
      tech: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
      },
    })
    .from(serviceOrders)
    .innerJoin(serviceAccounts, eq(serviceOrders.serviceAccountId, serviceAccounts.id))
    .innerJoin(subscribers, eq(serviceOrders.subscriberId, subscribers.id))
    .leftJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
    .leftJoin(users, eq(serviceOrders.assignedTechnicianId, users.id))
    .where(whereClause)
    .orderBy(query.sortOrder === 'asc' ? asc(orderByCol) : desc(orderByCol))
    .limit(limit)
    .offset(offset);

  const data: ServiceOrderDto[] = rows.map((r) => ({
    id: r.order.id,
    orderNumber: r.order.orderNumber,
    orderType: r.order.orderType,
    status: r.order.status,
    serviceAccountId: r.order.serviceAccountId,
    subscriberId: r.order.subscriberId,
    assignedTechnicianId: r.order.assignedTechnicianId,
    priority: r.order.priority,
    scheduledDate: r.order.scheduledDate ? String(r.order.scheduledDate) : null,
    completedAt: r.order.completedAt,
    cancelledAt: r.order.cancelledAt,
    cancellationReason: r.order.cancellationReason,
    targetAddressId: r.order.targetAddressId,
    description: r.order.description,
    resolutionNotes: r.order.resolutionNotes,
    materialsUsed: r.order.materialsUsed as any,
    feeCentavos: Number(r.order.feeCentavos || 0),
    disconnectionType: r.order.disconnectionType,
    createdAt: r.order.createdAt,
    updatedAt: r.order.updatedAt,
    serviceAccount: {
      id: r.sa.id,
      serviceAccountNumber: r.sa.serviceAccountNumber,
      status: r.sa.status,
      planName: r.plan?.name || 'Broadband Plan',
      currentRateCentavos: Number(r.sa.currentRateCentavos),
    },
    subscriber: {
      id: r.sub.id,
      accountNumber: r.sub.accountNumber,
      firstName: r.sub.firstName,
      lastName: r.sub.lastName,
      contactNumber: r.sub.contactNumber,
    },
    assignedTechnician: r.tech?.id ? (r.tech as any) : null,
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
 * Create a new service order.
 */
export async function createServiceOrder(
  input: CreateServiceOrderInput,
  actor: { id?: string; name: string },
  ip?: string
): Promise<ServiceOrderDto> {
  // 1. Verify service account exists
  const [sa] = await db
    .select()
    .from(serviceAccounts)
    .where(eq(serviceAccounts.id, input.serviceAccountId))
    .limit(1);

  if (!sa) {
    const err = new Error(`Service account '${input.serviceAccountId}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'SERVICE_ACCOUNT_NOT_FOUND';
    throw err;
  }

  // 2. Verify technician if assigned
  if (input.assignedTechnicianId) {
    const [tech] = await db
      .select()
      .from(users)
      .where(eq(users.id, input.assignedTechnicianId))
      .limit(1);

    if (!tech) {
      const err = new Error(`Technician user '${input.assignedTechnicianId}' was not found`) as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 404;
      err.code = 'TECHNICIAN_NOT_FOUND';
      throw err;
    }
  }

  // 3. Verify target address if specified
  if (input.targetAddressId) {
    const [addr] = await db
      .select()
      .from(subscriberAddresses)
      .where(
        and(
          eq(subscriberAddresses.id, input.targetAddressId),
          eq(subscriberAddresses.subscriberId, sa.subscriberId)
        )
      )
      .limit(1);

    if (!addr) {
      const err = new Error(`Target address '${input.targetAddressId}' was not found for this subscriber`) as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 404;
      err.code = 'TARGET_ADDRESS_NOT_FOUND';
      throw err;
    }
  }

  // Initial status: ASSIGNED if technician specified, otherwise PENDING
  const initialStatus = input.assignedTechnicianId ? ServiceOrderStatus.ASSIGNED : ServiceOrderStatus.PENDING;

  // 4. Insert inside transaction with sequential order numbering and advisory lock
  const created = await db.transaction(async (tx) => {
    const orderNumber = await generateServiceOrderNumber(input.scheduledDate || undefined, 1, tx);

    const [newOrder] = await tx
      .insert(serviceOrders)
      .values({
        orderNumber,
        orderType: input.orderType,
        status: initialStatus,
        serviceAccountId: sa.id,
        subscriberId: sa.subscriberId,
        assignedTechnicianId: input.assignedTechnicianId ?? null,
        priority: input.priority || 'NORMAL',
        scheduledDate: input.scheduledDate ?? null,
        targetAddressId: input.targetAddressId ?? null,
        description: input.description,
        feeCentavos: input.feeCentavos || 0,
        disconnectionType: input.disconnectionType ?? null,
      })
      .returning();

    return newOrder;
  });

  const fullOrder = await getServiceOrderById(created.id);

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'SERVICE_ORDER_CREATED',
    entityType: 'SERVICE_ORDER',
    entityId: created.id,
    newValues: fullOrder,
    ipAddress: ip,
  });

  return fullOrder!;
}

/**
 * Update service order details.
 */
export async function updateServiceOrder(
  id: string,
  input: UpdateServiceOrderInput,
  actor: { id?: string; name: string },
  ip?: string
): Promise<ServiceOrderDto> {
  const current = await getServiceOrderById(id);
  if (!current) {
    const err = new Error(`Service order '${id}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }

  // Reject modifications on terminal states
  if (current.status === ServiceOrderStatus.COMPLETED || current.status === ServiceOrderStatus.CANCELLED) {
    const err = new Error(`Cannot modify a service order with status '${current.status}'`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 400;
    err.code = 'TERMINAL_STATE_IMMUTABLE';
    throw err;
  }

  if (input.assignedTechnicianId) {
    const [tech] = await db
      .select()
      .from(users)
      .where(eq(users.id, input.assignedTechnicianId))
      .limit(1);

    if (!tech) {
      const err = new Error(`Technician user '${input.assignedTechnicianId}' was not found`) as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 404;
      err.code = 'TECHNICIAN_NOT_FOUND';
      throw err;
    }
  }

  const updateValues: Partial<typeof serviceOrders.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.description !== undefined) updateValues.description = input.description;
  if (input.priority !== undefined) updateValues.priority = input.priority;
  if (input.scheduledDate !== undefined) updateValues.scheduledDate = input.scheduledDate;
  if (input.targetAddressId !== undefined && input.targetAddressId !== null) {
    const [addr] = await db
      .select()
      .from(subscriberAddresses)
      .where(
        and(
          eq(subscriberAddresses.id, input.targetAddressId),
          eq(subscriberAddresses.subscriberId, current.subscriberId)
        )
      )
      .limit(1);

    if (!addr) {
      const err = new Error(`Target address '${input.targetAddressId}' was not found for this subscriber`) as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 404;
      err.code = 'TARGET_ADDRESS_NOT_FOUND';
      throw err;
    }
    updateValues.targetAddressId = input.targetAddressId;
  }

  if (input.assignedTechnicianId !== undefined) {
    updateValues.assignedTechnicianId = input.assignedTechnicianId;
    if (current.status === ServiceOrderStatus.PENDING && input.assignedTechnicianId) {
      updateValues.status = ServiceOrderStatus.ASSIGNED;
    } else if (current.status === ServiceOrderStatus.ASSIGNED && !input.assignedTechnicianId) {
      updateValues.status = ServiceOrderStatus.PENDING;
    }
  }

  if (input.status !== undefined) {
    const techId = input.assignedTechnicianId !== undefined ? input.assignedTechnicianId : current.assignedTechnicianId;
    if (input.status === ServiceOrderStatus.IN_PROGRESS && !techId) {
      const err = new Error('Cannot transition unassigned service order to IN_PROGRESS. Assign a technician first.') as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 400;
      err.code = 'TECHNICIAN_REQUIRED';
      throw err;
    }
    updateValues.status = input.status;
  }

  await db.update(serviceOrders).set(updateValues).where(eq(serviceOrders.id, id));

  const updated = await getServiceOrderById(id);

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'SERVICE_ORDER_UPDATED',
    entityType: 'SERVICE_ORDER',
    entityId: id,
    oldValues: current,
    newValues: updated,
    ipAddress: ip,
  });

  return updated!;
}

/**
 * Assign a technician to a service order.
 */
export async function assignTechnician(
  id: string,
  input: AssignTechnicianInput,
  actor: { id?: string; name: string },
  ip?: string
): Promise<ServiceOrderDto> {
  const current = await getServiceOrderById(id);
  if (!current) {
    const err = new Error(`Service order '${id}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }

  if (current.status === ServiceOrderStatus.COMPLETED || current.status === ServiceOrderStatus.CANCELLED) {
    const err = new Error(`Cannot assign technician to a service order with status '${current.status}'`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 400;
    err.code = 'TERMINAL_STATE_IMMUTABLE';
    throw err;
  }

  const [tech] = await db
    .select()
    .from(users)
    .where(eq(users.id, input.technicianId))
    .limit(1);

  if (!tech) {
    const err = new Error(`Technician user '${input.technicianId}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'TECHNICIAN_NOT_FOUND';
    throw err;
  }

  const updateValues: Partial<typeof serviceOrders.$inferInsert> = {
    assignedTechnicianId: input.technicianId,
    status: current.status === ServiceOrderStatus.PENDING ? ServiceOrderStatus.ASSIGNED : current.status,
    updatedAt: new Date(),
  };

  if (input.scheduledDate) {
    updateValues.scheduledDate = input.scheduledDate;
  }

  await db.update(serviceOrders).set(updateValues).where(eq(serviceOrders.id, id));

  const updated = await getServiceOrderById(id);

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'SERVICE_ORDER_ASSIGNED',
    entityType: 'SERVICE_ORDER',
    entityId: id,
    oldValues: {
      assignedTechnicianId: current.assignedTechnicianId,
      status: current.status,
    },
    newValues: {
      assignedTechnicianId: input.technicianId,
      technicianName: tech.fullName,
      status: updateValues.status,
    },
    ipAddress: ip,
  });

  return updated!;
}

/**
 * Transitions status of a service order (e.g. to IN_PROGRESS).
 */
export async function changeServiceOrderStatus(
  id: string,
  newStatus: string,
  actor: { id?: string; name: string },
  ip?: string,
  reason?: string
): Promise<ServiceOrderDto> {
  const current = await getServiceOrderById(id);
  if (!current) {
    const err = new Error(`Service order '${id}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }

  if (current.status === ServiceOrderStatus.COMPLETED || current.status === ServiceOrderStatus.CANCELLED) {
    const err = new Error(`Cannot change status of a service order with status '${current.status}'`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 400;
    err.code = 'TERMINAL_STATE_IMMUTABLE';
    throw err;
  }

  if (newStatus === ServiceOrderStatus.COMPLETED) {
    const err = new Error('To complete a service order, use the complete endpoint (POST /api/v1/service-orders/:id/complete)') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 400;
    err.code = 'INVALID_STATUS_TRANSITION';
    throw err;
  }

  if (newStatus === ServiceOrderStatus.CANCELLED) {
    const err = new Error('To cancel a service order, use the cancel endpoint (POST /api/v1/service-orders/:id/cancel)') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 400;
    err.code = 'INVALID_STATUS_TRANSITION';
    throw err;
  }

  if (newStatus === ServiceOrderStatus.IN_PROGRESS && !current.assignedTechnicianId) {
    const err = new Error('Cannot transition unassigned service order to IN_PROGRESS. Assign a technician first.') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 400;
    err.code = 'TECHNICIAN_REQUIRED';
    throw err;
  }

  await db
    .update(serviceOrders)
    .set({
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(serviceOrders.id, id));

  const updated = await getServiceOrderById(id);

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'SERVICE_ORDER_STATUS_CHANGED',
    entityType: 'SERVICE_ORDER',
    entityId: id,
    oldValues: { status: current.status },
    newValues: { status: newStatus },
    reason: reason ?? `Status changed from ${current.status} to ${newStatus}`,
    ipAddress: ip,
  });

  return updated!;
}

/**
 * Completes a service order and atomically synchronizes the associated service account's status.
 *
 * Automatic synchronization rules:
 * - INSTALLATION: Service account becomes ACTIVE, sets activationDate
 * - DISCONNECTION: Service account becomes SUSPENDED (or TERMINATED if PERMANENT)
 * - RECONNECTION: Service account becomes ACTIVE
 * - RELOCATION: Updates installationAddressId, ensures status is ACTIVE
 */
export async function completeServiceOrder(
  id: string,
  input: CompleteServiceOrderInput,
  actor: { id?: string; name: string },
  ip?: string
): Promise<ServiceOrderDto> {
  const current = await getServiceOrderById(id);
  if (!current) {
    const err = new Error(`Service order '${id}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }

  if (current.status === ServiceOrderStatus.COMPLETED) {
    const err = new Error('Service order is already completed') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 400;
    err.code = 'ORDER_ALREADY_COMPLETED';
    throw err;
  }

  if (current.status === ServiceOrderStatus.CANCELLED) {
    const err = new Error('Cannot complete a cancelled service order') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 400;
    err.code = 'ORDER_CANCELLED';
    throw err;
  }

  const completionDate = input.completedAt ? new Date(input.completedAt) : new Date();
  const completionDateStr = completionDate.toISOString().slice(0, 10);

  // Execute order completion and service account status synchronization in a single transaction with advisory lock
  await db.transaction(async (tx) => {
    // Transaction-scoped advisory lock on service order to guarantee idempotency and zero race conditions
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'service_order_' + id}))`
    );

    const [orderRow] = await tx
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, id))
      .limit(1);

    if (!orderRow) {
      const err = new Error(`Service order '${id}' was not found`) as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 404;
      err.code = 'ORDER_NOT_FOUND';
      throw err;
    }

    if (orderRow.status === ServiceOrderStatus.COMPLETED) {
      const err = new Error('Service order is already completed') as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 400;
      err.code = 'ORDER_ALREADY_COMPLETED';
      throw err;
    }

    if (orderRow.status === ServiceOrderStatus.CANCELLED) {
      const err = new Error('Cannot complete a cancelled service order') as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 400;
      err.code = 'ORDER_CANCELLED';
      throw err;
    }

    // Target address validation for RELOCATION
    const targetAddressId = input.targetAddressId || orderRow.targetAddressId;
    if (orderRow.orderType === ServiceOrderType.RELOCATION) {
      if (!targetAddressId) {
        const err = new Error('RELOCATION service order requires a target installation address') as Error & {
          statusCode: number;
          code: string;
        };
        err.statusCode = 400;
        err.code = 'TARGET_ADDRESS_REQUIRED';
        throw err;
      }

      const [targetAddr] = await tx
        .select()
        .from(subscriberAddresses)
        .where(
          and(
            eq(subscriberAddresses.id, targetAddressId),
            eq(subscriberAddresses.subscriberId, orderRow.subscriberId)
          )
        )
        .limit(1);

      if (!targetAddr) {
        const err = new Error(`Target address '${targetAddressId}' was not found for this subscriber`) as Error & {
          statusCode: number;
          code: string;
        };
        err.statusCode = 404;
        err.code = 'TARGET_ADDRESS_NOT_FOUND';
        throw err;
      }
    }

    // 1. Update service order to COMPLETED
    await tx
      .update(serviceOrders)
      .set({
        status: ServiceOrderStatus.COMPLETED,
        completedAt: completionDate,
        resolutionNotes: input.resolutionNotes,
        materialsUsed: input.materialsUsed ? (input.materialsUsed as any) : orderRow.materialsUsed,
        disconnectionType: input.disconnectionType || orderRow.disconnectionType,
        targetAddressId: targetAddressId || null,
        updatedAt: new Date(),
      })
      .where(eq(serviceOrders.id, id));

    // 2. Synchronize service account status based on order type
    const [sa] = await tx
      .select()
      .from(serviceAccounts)
      .where(eq(serviceAccounts.id, orderRow.serviceAccountId))
      .limit(1);

    if (sa) {
      let targetStatus: string | null = null;
      const saUpdates: Partial<typeof serviceAccounts.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (orderRow.orderType === ServiceOrderType.INSTALLATION) {
        targetStatus = 'ACTIVE';
        saUpdates.status = 'ACTIVE';
        if (!sa.activationDate) {
          saUpdates.activationDate = completionDateStr;
        }
      } else if (orderRow.orderType === ServiceOrderType.DISCONNECTION) {
        const discType = input.disconnectionType || orderRow.disconnectionType;
        targetStatus = discType === 'PERMANENT' ? 'TERMINATED' : 'SUSPENDED';
        saUpdates.status = targetStatus;
      } else if (orderRow.orderType === ServiceOrderType.RECONNECTION) {
        targetStatus = 'ACTIVE';
        saUpdates.status = 'ACTIVE';
      } else if (orderRow.orderType === ServiceOrderType.RELOCATION) {
        if (targetAddressId) {
          saUpdates.installationAddressId = targetAddressId;
        }
        targetStatus = 'ACTIVE';
        saUpdates.status = 'ACTIVE';
      } else if (orderRow.orderType === ServiceOrderType.TRANSFER) {
        targetStatus = 'ACTIVE';
        saUpdates.status = 'ACTIVE';
      } else if (orderRow.orderType === ServiceOrderType.REPAIR) {
        targetStatus = 'ACTIVE';
        saUpdates.status = 'ACTIVE';
      }

      if (Object.keys(saUpdates).length > 1) {
        await tx
          .update(serviceAccounts)
          .set(saUpdates)
          .where(eq(serviceAccounts.id, sa.id));

        if (targetStatus && targetStatus !== sa.status) {
          await writeAuditLog(
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'SERVICE_ACCOUNT_STATUS_CHANGED',
              entityType: 'SERVICE_ACCOUNT',
              entityId: sa.id,
              oldValues: { status: sa.status },
              newValues: { status: targetStatus },
              reason: `Synchronized upon completion of ${orderRow.orderType} order ${orderRow.orderNumber}`,
              ipAddress: ip,
            },
            tx
          );
        }
      }
    }
  });

  const updated = await getServiceOrderById(id);

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'SERVICE_ORDER_COMPLETED',
    entityType: 'SERVICE_ORDER',
    entityId: id,
    oldValues: { status: current.status },
    newValues: {
      status: ServiceOrderStatus.COMPLETED,
      completedAt: completionDate,
      resolutionNotes: input.resolutionNotes,
    },
    reason: input.resolutionNotes,
    ipAddress: ip,
  });

  return updated!;
}

/**
 * Cancels a service order.
 */
export async function cancelServiceOrder(
  id: string,
  input: CancelServiceOrderInput,
  actor: { id?: string; name: string },
  ip?: string
): Promise<ServiceOrderDto> {
  const current = await getServiceOrderById(id);
  if (!current) {
    const err = new Error(`Service order '${id}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }

  if (current.status === ServiceOrderStatus.COMPLETED) {
    const err = new Error('Cannot cancel an already completed service order') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 400;
    err.code = 'ORDER_ALREADY_COMPLETED';
    throw err;
  }

  if (current.status === ServiceOrderStatus.CANCELLED) {
    const err = new Error('Cannot cancel an already cancelled service order') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 400;
    err.code = 'ORDER_ALREADY_CANCELLED';
    throw err;
  }

  const cancelledAt = new Date();
  let previousStatus = current.status;

  await db.transaction(async (tx) => {
    // Transaction-scoped advisory lock to prevent race conditions
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'service_order_' + id}))`
    );

    const [orderRow] = await tx
      .select()
      .from(serviceOrders)
      .where(eq(serviceOrders.id, id))
      .limit(1);

    if (!orderRow) {
      const err = new Error(`Service order '${id}' was not found`) as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 404;
      err.code = 'ORDER_NOT_FOUND';
      throw err;
    }

    if (orderRow.status === ServiceOrderStatus.COMPLETED) {
      const err = new Error('Cannot cancel an already completed service order') as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 400;
      err.code = 'ORDER_ALREADY_COMPLETED';
      throw err;
    }

    if (orderRow.status === ServiceOrderStatus.CANCELLED) {
      const err = new Error('Cannot cancel an already cancelled service order') as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 400;
      err.code = 'ORDER_ALREADY_CANCELLED';
      throw err;
    }

    previousStatus = orderRow.status;

    await tx
      .update(serviceOrders)
      .set({
        status: ServiceOrderStatus.CANCELLED,
        cancelledAt,
        cancellationReason: input.reason,
        updatedAt: cancelledAt,
      })
      .where(eq(serviceOrders.id, id));
  });

  const updated = await getServiceOrderById(id);

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'SERVICE_ORDER_CANCELLED',
    entityType: 'SERVICE_ORDER',
    entityId: id,
    oldValues: { status: previousStatus },
    newValues: {
      status: ServiceOrderStatus.CANCELLED,
      cancelledAt,
      cancellationReason: input.reason,
    },
    reason: input.reason,
    ipAddress: ip,
  });

  return updated!;
}
