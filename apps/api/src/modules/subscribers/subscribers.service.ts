import { eq, ilike, or, and, desc, asc, sql, count, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  subscribers,
  subscriberAddresses,
  serviceAccounts,
  servicePlans,
} from '../../db/schema.js';
import { writeAuditLog } from '../../utils/audit.js';
import {
  CreateSubscriberInput,
  UpdateSubscriberInput,
  SubscriberQueryInput,
} from '@bcis/validation';

/**
 * Generates a unique sequential subscriber account number: SUB-YYYYMM-XXXX
 */
export async function generateSubscriberAccountNumber(): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `SUB-${yearMonth}-`;

  const existing = await db
    .select({ accountNumber: subscribers.accountNumber })
    .from(subscribers)
    .where(ilike(subscribers.accountNumber, `${prefix}%`));

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
 * Lists subscribers with pagination, filtering, and search.
 */
export async function listSubscribers(query?: SubscriberQueryInput) {
  const page = query?.page ?? 1;
  const limit = query?.limit ?? 20;
  const offset = (page - 1) * limit;

  const conditions = [];

  if (query?.status) {
    conditions.push(eq(subscribers.status, query.status));
  }

  if (query?.phone) {
    const p = `%${query.phone}%`;
    conditions.push(or(ilike(subscribers.contactNumber, p), ilike(subscribers.alternateContact, p)));
  }

  if (query?.email) {
    conditions.push(ilike(subscribers.email, `%${query.email}%`));
  }

  if (query?.name) {
    const n = `%${query.name}%`;
    conditions.push(
      or(
        ilike(subscribers.firstName, n),
        ilike(subscribers.lastName, n),
        ilike(subscribers.businessName, n)
      )
    );
  }

  if (query?.search) {
    const s = `%${query.search}%`;
    conditions.push(
      or(
        ilike(subscribers.accountNumber, s),
        ilike(subscribers.firstName, s),
        ilike(subscribers.lastName, s),
        ilike(subscribers.businessName, s),
        ilike(subscribers.contactNumber, s),
        ilike(subscribers.email, s)
      )
    );
  }

  if (query?.barangay) {
    // Filter by barangay using subquery
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM subscriber_addresses sa
        WHERE sa.subscriber_id = ${subscribers.id}
        AND sa.barangay ILIKE ${'%' + query.barangay + '%'}
      )`
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Total count
  const [totalRes] = await db
    .select({ count: count() })
    .from(subscribers)
    .where(whereClause);

  const total = Number(totalRes?.count ?? 0);

  // Sorting
  const sortCol =
    query?.sortBy === 'accountNumber'
      ? subscribers.accountNumber
      : query?.sortBy === 'lastName'
      ? subscribers.lastName
      : query?.sortBy === 'firstName'
      ? subscribers.firstName
      : subscribers.createdAt;

  const orderDirection = query?.sortOrder === 'asc' ? asc(sortCol) : desc(sortCol);

  const subscriberRows = await db
    .select()
    .from(subscribers)
    .where(whereClause)
    .orderBy(orderDirection)
    .limit(limit)
    .offset(offset);

  // Load primary addresses for fetched subscribers
  const subscriberIds = subscriberRows.map((s) => s.id);
  const addresses = subscriberIds.length > 0
    ? await db
        .select()
        .from(subscriberAddresses)
        .where(
          and(
            inArray(subscriberAddresses.subscriberId, subscriberIds),
            eq(subscriberAddresses.isPrimary, true)
          )
        )
    : [];

  const addressMap = new Map(addresses.map((a) => [a.subscriberId, a]));

  const data = subscriberRows.map((sub) => ({
    ...sub,
    primaryAddress: addressMap.get(sub.id) ?? null,
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
 * Retrieves a single subscriber by ID or account number with addresses and service accounts.
 */
export async function getSubscriberById(idOrAccountNumber: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    idOrAccountNumber
  );

  const condition = isUuid
    ? or(eq(subscribers.id, idOrAccountNumber), eq(subscribers.accountNumber, idOrAccountNumber))
    : eq(subscribers.accountNumber, idOrAccountNumber);

  const [sub] = await db.select().from(subscribers).where(condition).limit(1);

  if (!sub) return null;

  // Fetch addresses
  const addresses = await db
    .select()
    .from(subscriberAddresses)
    .where(eq(subscriberAddresses.subscriberId, sub.id));

  // Fetch service accounts with plan info
  const accounts = await db
    .select({
      account: serviceAccounts,
      planName: servicePlans.name,
      planCode: servicePlans.planCode,
    })
    .from(serviceAccounts)
    .leftJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
    .where(eq(serviceAccounts.subscriberId, sub.id))
    .orderBy(desc(serviceAccounts.createdAt));

  const primaryAddress = addresses.find((a) => a.isPrimary) ?? addresses[0] ?? null;

  return {
    ...sub,
    addresses,
    primaryAddress,
    serviceAccounts: accounts.map(({ account, planName, planCode }) => ({
      ...account,
      planName,
      planCode,
    })),
  };
}

/**
 * Registers a new subscriber along with a primary billing address.
 */
export async function createSubscriber(
  input: CreateSubscriberInput,
  actor: { id?: string; name: string },
  ip?: string
) {
  const accountNumber = input.accountNumber || (await generateSubscriberAccountNumber());

  // Check unique account number
  const existing = await db
    .select({ id: subscribers.id })
    .from(subscribers)
    .where(eq(subscribers.accountNumber, accountNumber))
    .limit(1);

  if (existing.length > 0) {
    const err = new Error(
      `Subscriber with account number '${accountNumber}' already exists`
    ) as Error & { statusCode: number; code: string };
    err.statusCode = 409;
    err.code = 'ACCOUNT_NUMBER_EXISTS';
    throw err;
  }

  // Insert subscriber and primary address within transaction
  const result = await db.transaction(async (tx) => {
    const [sub] = await tx
      .insert(subscribers)
      .values({
        accountNumber,
        firstName: input.firstName,
        middleName: input.middleName ?? null,
        lastName: input.lastName,
        businessName: input.businessName ?? null,
        contactNumber: input.contactNumber,
        alternateContact: input.alternateContact ?? null,
        email: input.email || null,
        idType: input.idType ?? null,
        idNumber: input.idNumber ?? null,
        status: 'ACTIVE',
        notes: input.notes ?? null,
        advanceCreditCentavos: 0,
      })
      .returning();

    const [address] = await tx
      .insert(subscriberAddresses)
      .values({
        subscriberId: sub.id,
        addressType: 'BILLING',
        streetAddress: input.streetAddress,
        barangay: input.barangay,
        municipality: input.municipality || 'Malaybalay',
        province: input.province || 'Bukidnon',
        postalCode: input.postalCode || '8700',
        latitude: input.latitude ? String(input.latitude) : null,
        longitude: input.longitude ? String(input.longitude) : null,
        isPrimary: true,
      })
      .returning();

    return {
      ...sub,
      primaryAddress: address,
      addresses: [address],
    };
  });

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'SUBSCRIBER_CREATED',
    entityType: 'SUBSCRIBER',
    entityId: result.id,
    newValues: result,
    ipAddress: ip,
  });

  return result;
}

/**
 * Updates an existing subscriber and optionally their primary address.
 */
export async function updateSubscriber(
  id: string,
  input: UpdateSubscriberInput,
  actor: { id?: string; name: string },
  ip?: string
) {
  const current = await getSubscriberById(id);
  if (!current) return null;

  const updateSubValues: Partial<typeof subscribers.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.firstName !== undefined) updateSubValues.firstName = input.firstName;
  if (input.middleName !== undefined) updateSubValues.middleName = input.middleName;
  if (input.lastName !== undefined) updateSubValues.lastName = input.lastName;
  if (input.businessName !== undefined) updateSubValues.businessName = input.businessName;
  if (input.contactNumber !== undefined) updateSubValues.contactNumber = input.contactNumber;
  if (input.alternateContact !== undefined) updateSubValues.alternateContact = input.alternateContact;
  if (input.email !== undefined) updateSubValues.email = input.email || null;
  if (input.idType !== undefined) updateSubValues.idType = input.idType;
  if (input.idNumber !== undefined) updateSubValues.idNumber = input.idNumber;
  if (input.status !== undefined) updateSubValues.status = input.status;
  if (input.notes !== undefined) updateSubValues.notes = input.notes;

  const result = await db.transaction(async (tx) => {
    const [updatedSub] = await tx
      .update(subscribers)
      .set(updateSubValues)
      .where(eq(subscribers.id, current.id))
      .returning();

    // Check if address fields need update
    const hasAddressUpdate =
      input.streetAddress !== undefined ||
      input.barangay !== undefined ||
      input.municipality !== undefined ||
      input.province !== undefined ||
      input.postalCode !== undefined;

    let updatedAddress = current.primaryAddress;

    if (hasAddressUpdate) {
      if (current.primaryAddress) {
        const addressValues: Partial<typeof subscriberAddresses.$inferInsert> = {};
        if (input.streetAddress !== undefined) addressValues.streetAddress = input.streetAddress;
        if (input.barangay !== undefined) addressValues.barangay = input.barangay;
        if (input.municipality !== undefined) addressValues.municipality = input.municipality;
        if (input.province !== undefined) addressValues.province = input.province;
        if (input.postalCode !== undefined) addressValues.postalCode = input.postalCode;

        const [addr] = await tx
          .update(subscriberAddresses)
          .set(addressValues)
          .where(eq(subscriberAddresses.id, current.primaryAddress.id))
          .returning();
        updatedAddress = addr;
      } else {
        const [addr] = await tx
          .insert(subscriberAddresses)
          .values({
            subscriberId: current.id,
            addressType: 'BILLING',
            streetAddress: input.streetAddress || 'N/A',
            barangay: input.barangay || 'Poblacion',
            municipality: input.municipality || 'Malaybalay',
            province: input.province || 'Bukidnon',
            postalCode: input.postalCode || '8700',
            isPrimary: true,
          })
          .returning();
        updatedAddress = addr;
      }
    }

    return {
      ...updatedSub,
      primaryAddress: updatedAddress,
    };
  });

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'SUBSCRIBER_UPDATED',
    entityType: 'SUBSCRIBER',
    entityId: current.id,
    oldValues: current,
    newValues: result,
    ipAddress: ip,
  });

  return result;
}

/**
 * Soft deletes / archives a subscriber (per PRODUCT.md line 635).
 */
export async function archiveSubscriber(
  id: string,
  actor: { id?: string; name: string },
  reason?: string,
  ip?: string
) {
  const current = await getSubscriberById(id);
  if (!current) return null;

  const [archived] = await db
    .update(subscribers)
    .set({
      status: 'ARCHIVED',
      updatedAt: new Date(),
    })
    .where(eq(subscribers.id, current.id))
    .returning();

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'SUBSCRIBER_ARCHIVED',
    entityType: 'SUBSCRIBER',
    entityId: current.id,
    oldValues: { status: current.status },
    newValues: { status: 'ARCHIVED' },
    reason: reason ?? 'Archived via administrative action',
    ipAddress: ip,
  });

  return archived;
}
