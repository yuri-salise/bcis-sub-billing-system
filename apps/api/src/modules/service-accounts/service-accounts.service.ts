import { eq, ilike, or, and, desc, count } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  serviceAccounts,
  subscribers,
  servicePlans,
  subscriberAddresses,
  users,
} from '../../db/schema.js';
import { writeAuditLog } from '../../utils/audit.js';
import {
  CreateServiceAccountInput,
  UpdateServiceAccountInput,
  ServiceAccountQueryInput,
} from '@bcis/validation';

/**
 * Generates a unique sequential service account number: SA-YYYYMM-XXXX
 */
export async function generateServiceAccountNumber(): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `SA-${yearMonth}-`;

  const existing = await db
    .select({ accountNumber: serviceAccounts.serviceAccountNumber })
    .from(serviceAccounts)
    .where(ilike(serviceAccounts.serviceAccountNumber, `${prefix}%`));

  let maxSeq = 0;
  for (const row of existing) {
    const part = row.accountNumber.slice(prefix.length);
    const num = parseInt(part, 10);
    if (!isNaN(num) && num > maxSeq) {
      maxSeq = num;
    }
  }

  const nextSeq = String(maxSeq + 1).padStart(4, '0');
  return `${prefix}${nextSeq}`;
}

/**
 * Lists service accounts with pagination and filters.
 */
export async function listServiceAccounts(query?: ServiceAccountQueryInput) {
  const page = query?.page ?? 1;
  const limit = query?.limit ?? 20;
  const offset = (page - 1) * limit;

  const conditions = [];

  if (query?.subscriberId) {
    conditions.push(eq(serviceAccounts.subscriberId, query.subscriberId));
  }

  if (query?.servicePlanId) {
    conditions.push(eq(serviceAccounts.servicePlanId, query.servicePlanId));
  }

  if (query?.status) {
    conditions.push(eq(serviceAccounts.status, query.status));
  }

  if (query?.search) {
    const s = `%${query.search}%`;
    conditions.push(
      or(
        ilike(serviceAccounts.serviceAccountNumber, s),
        ilike(subscribers.firstName, s),
        ilike(subscribers.lastName, s),
        ilike(subscribers.accountNumber, s)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Total count
  const [totalRes] = await db
    .select({ count: count() })
    .from(serviceAccounts)
    .leftJoin(subscribers, eq(serviceAccounts.subscriberId, subscribers.id))
    .where(whereClause);

  const total = Number(totalRes?.count ?? 0);

  const rows = await db
    .select({
      account: serviceAccounts,
      subscriber: {
        id: subscribers.id,
        accountNumber: subscribers.accountNumber,
        firstName: subscribers.firstName,
        lastName: subscribers.lastName,
        businessName: subscribers.businessName,
      },
      plan: {
        id: servicePlans.id,
        planCode: servicePlans.planCode,
        name: servicePlans.name,
        monthlyRecurringCentavos: servicePlans.monthlyRecurringCentavos,
      },
      installationAddress: subscriberAddresses,
    })
    .from(serviceAccounts)
    .leftJoin(subscribers, eq(serviceAccounts.subscriberId, subscribers.id))
    .leftJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
    .leftJoin(subscriberAddresses, eq(serviceAccounts.installationAddressId, subscriberAddresses.id))
    .where(whereClause)
    .orderBy(desc(serviceAccounts.createdAt))
    .limit(limit)
    .offset(offset);

  const data = rows.map(({ account, subscriber, plan, installationAddress }) => ({
    ...account,
    subscriber,
    plan,
    installationAddress,
  }));

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Retrieves a service account by ID or serviceAccountNumber.
 */
export async function getServiceAccountById(idOrNumber: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    idOrNumber
  );

  const condition = isUuid
    ? or(eq(serviceAccounts.id, idOrNumber), eq(serviceAccounts.serviceAccountNumber, idOrNumber))
    : eq(serviceAccounts.serviceAccountNumber, idOrNumber);

  const rows = await db
    .select({
      account: serviceAccounts,
      subscriber: subscribers,
      plan: servicePlans,
      installationAddress: subscriberAddresses,
      collector: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
      },
    })
    .from(serviceAccounts)
    .leftJoin(subscribers, eq(serviceAccounts.subscriberId, subscribers.id))
    .leftJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
    .leftJoin(subscriberAddresses, eq(serviceAccounts.installationAddressId, subscriberAddresses.id))
    .leftJoin(users, eq(serviceAccounts.collectorId, users.id))
    .where(condition)
    .limit(1);

  if (rows.length === 0) return null;

  const { account, subscriber, plan, installationAddress, collector } = rows[0];
  return {
    ...account,
    subscriber,
    plan,
    installationAddress,
    collector: collector?.id ? collector : null,
  };
}

/**
 * Provisions a new service account under an active subscriber.
 */
export async function createServiceAccount(
  input: CreateServiceAccountInput,
  actor: { id?: string; name: string },
  ip?: string
) {
  // 1. Verify subscriber exists
  const [sub] = await db
    .select()
    .from(subscribers)
    .where(eq(subscribers.id, input.subscriberId))
    .limit(1);

  if (!sub) {
    const err = new Error(`Subscriber with ID '${input.subscriberId}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'SUBSCRIBER_NOT_FOUND';
    throw err;
  }

  // 2. Verify service plan exists
  const [plan] = await db
    .select()
    .from(servicePlans)
    .where(eq(servicePlans.id, input.servicePlanId))
    .limit(1);

  if (!plan) {
    const err = new Error(`Service plan with ID '${input.servicePlanId}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'PLAN_NOT_FOUND';
    throw err;
  }

  // 3. Resolve installation address
  let addressId = input.installationAddressId ?? null;

  if (!addressId && input.streetAddress && input.barangay) {
    // Create new installation address for subscriber
    const [newAddress] = await db
      .insert(subscriberAddresses)
      .values({
        subscriberId: sub.id,
        addressType: 'INSTALLATION',
        streetAddress: input.streetAddress,
        barangay: input.barangay,
        municipality: input.municipality || 'Malaybalay',
        province: input.province || 'Bukidnon',
        postalCode: input.postalCode || '8700',
        isPrimary: false,
      })
      .returning();
    addressId = newAddress.id;
  } else if (!addressId) {
    // Fallback to subscriber primary address
    const [primaryAddr] = await db
      .select()
      .from(subscriberAddresses)
      .where(and(eq(subscriberAddresses.subscriberId, sub.id), eq(subscriberAddresses.isPrimary, true)))
      .limit(1);
    if (primaryAddr) {
      addressId = primaryAddr.id;
    }
  }

  // 4. Rate in integer centavos defaults to plan rate if not explicitly specified
  const currentRateCentavos = input.currentRateCentavos ?? plan.monthlyRecurringCentavos;

  // 5. Generate unique service account number
  const serviceAccountNumber = await generateServiceAccountNumber();

  // 6. Determine activation date
  const status = input.status || 'PENDING';
  let activationDate = input.activationDate ?? null;
  if (status === 'ACTIVE' && !activationDate) {
    activationDate = new Date().toISOString().slice(0, 10);
  }

  const [created] = await db
    .insert(serviceAccounts)
    .values({
      serviceAccountNumber,
      subscriberId: sub.id,
      servicePlanId: plan.id,
      installationAddressId: addressId,
      collectorId: input.collectorId ?? null,
      billingDayOfMonth: input.billingDayOfMonth ?? 1,
      currentRateCentavos,
      status,
      activationDate,
    })
    .returning();

  const fullRecord = await getServiceAccountById(created.id);

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'SERVICE_ACCOUNT_CREATED',
    entityType: 'SERVICE_ACCOUNT',
    entityId: created.id,
    newValues: fullRecord,
    ipAddress: ip,
  });

  return fullRecord;
}

/**
 * Updates an existing service account (plan, address, collector, rate, billingDay).
 */
export async function updateServiceAccount(
  id: string,
  input: UpdateServiceAccountInput,
  actor: { id?: string; name: string },
  ip?: string
) {
  const current = await getServiceAccountById(id);
  if (!current) return null;

  const updateValues: Partial<typeof serviceAccounts.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.servicePlanId !== undefined) {
    // Verify plan exists
    const [newPlan] = await db
      .select()
      .from(servicePlans)
      .where(eq(servicePlans.id, input.servicePlanId))
      .limit(1);

    if (!newPlan) {
      const err = new Error(`Service plan with ID '${input.servicePlanId}' was not found`) as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 404;
      err.code = 'PLAN_NOT_FOUND';
      throw err;
    }
    updateValues.servicePlanId = input.servicePlanId;
    // If rate wasn't explicitly provided, update to new plan rate
    if (input.currentRateCentavos === undefined) {
      updateValues.currentRateCentavos = newPlan.monthlyRecurringCentavos;
    }
  }

  if (input.installationAddressId !== undefined) {
    updateValues.installationAddressId = input.installationAddressId;
  }

  if (input.collectorId !== undefined) {
    updateValues.collectorId = input.collectorId;
  }

  if (input.billingDayOfMonth !== undefined) {
    updateValues.billingDayOfMonth = input.billingDayOfMonth;
  }

  if (input.currentRateCentavos !== undefined) {
    updateValues.currentRateCentavos = input.currentRateCentavos;
  }

  if (input.status !== undefined) {
    updateValues.status = input.status;
    if (input.status === 'ACTIVE' && !current.activationDate && !input.activationDate) {
      updateValues.activationDate = new Date().toISOString().slice(0, 10);
    }
  }

  if (input.activationDate !== undefined) {
    updateValues.activationDate = input.activationDate;
  }

  await db.update(serviceAccounts).set(updateValues).where(eq(serviceAccounts.id, current.id));

  const updated = await getServiceAccountById(current.id);

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'SERVICE_ACCOUNT_UPDATED',
    entityType: 'SERVICE_ACCOUNT',
    entityId: current.id,
    oldValues: current,
    newValues: updated,
    ipAddress: ip,
  });

  return updated;
}

/**
 * Transitions service account status (PENDING, ACTIVE, SUSPENDED, TERMINATED) with reason.
 */
export async function changeServiceAccountStatus(
  id: string,
  newStatus: string,
  reason: string | undefined,
  actor: { id?: string; name: string },
  ip?: string
) {
  const current = await getServiceAccountById(id);
  if (!current) return null;

  const updateValues: Partial<typeof serviceAccounts.$inferInsert> = {
    status: newStatus,
    updatedAt: new Date(),
  };

  if (newStatus === 'ACTIVE' && !current.activationDate) {
    updateValues.activationDate = new Date().toISOString().slice(0, 10);
  }

  await db.update(serviceAccounts).set(updateValues).where(eq(serviceAccounts.id, current.id));

  const updated = await getServiceAccountById(current.id);

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'SERVICE_ACCOUNT_STATUS_CHANGED',
    entityType: 'SERVICE_ACCOUNT',
    entityId: current.id,
    oldValues: { status: current.status },
    newValues: { status: newStatus },
    reason: reason || `Status changed from ${current.status} to ${newStatus}`,
    ipAddress: ip,
  });

  return updated;
}
