import { eq, and, or, ilike, desc, asc, sql, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  collectionAreas,
  collectionRoutes,
  collectionBatches,
  serviceAccounts,
  subscribers,
  subscriberAddresses,
  servicePlans,
  invoices,
  users,
} from '../../db/schema.js';
import {
  CreateCollectionAreaInput,
  UpdateCollectionAreaInput,
  CollectionAreaQueryInput,
  CreateCollectionRouteInput,
  UpdateCollectionRouteInput,
  CollectionRouteQueryInput,
  RouteSheetQueryInput,
} from '@bcis/validation';
import {
  CollectionAreaDto,
  CollectionRouteDto,
  RouteSheetDto,
  RouteSheetAccountItem,
} from '@bcis/shared-types';
import { writeAuditLog } from '../../utils/audit.js';

/**
 * List collection areas with pagination and search.
 */
export async function listCollectionAreas(query: CollectionAreaQueryInput) {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const offset = (page - 1) * limit;

  const conditions = [];

  if (query.search) {
    const s = `%${query.search}%`;
    conditions.push(
      or(
        ilike(collectionAreas.name, s),
        ilike(collectionAreas.code, s),
        ilike(collectionAreas.barangay, s)
      )
    );
  }

  if (query.barangay) {
    conditions.push(ilike(collectionAreas.barangay, `%${query.barangay}%`));
  }

  if (query.collectorId) {
    conditions.push(eq(collectionAreas.assignedCollectorId, query.collectorId));
  }

  if (query.isActive !== undefined) {
    conditions.push(eq(collectionAreas.isActive, query.isActive));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(collectionAreas)
    .where(whereClause);
  const total = Number(countResult[0]?.count || 0);

  const rows = await db
    .select({
      area: collectionAreas,
      collector: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
      },
    })
    .from(collectionAreas)
    .leftJoin(users, eq(collectionAreas.assignedCollectorId, users.id))
    .where(whereClause)
    .orderBy(asc(collectionAreas.name))
    .limit(limit)
    .offset(offset);

  // Collect route and account counts
  const data: CollectionAreaDto[] = [];
  for (const row of rows) {
    const routeCountRes = await db
      .select({ count: sql<number>`count(*)` })
      .from(collectionRoutes)
      .where(eq(collectionRoutes.collectionAreaId, row.area.id));
    const routeCount = Number(routeCountRes[0]?.count || 0);

    const accountCountRes = await db
      .select({ count: sql<number>`count(*)` })
      .from(serviceAccounts)
      .where(eq(serviceAccounts.collectionAreaId, row.area.id));
    const accountCount = Number(accountCountRes[0]?.count || 0);

    data.push({
      id: row.area.id,
      name: row.area.name,
      code: row.area.code,
      description: row.area.description,
      barangay: row.area.barangay,
      city: row.area.city,
      assignedCollectorId: row.area.assignedCollectorId,
      isActive: row.area.isActive,
      createdAt: row.area.createdAt,
      updatedAt: row.area.updatedAt,
      assignedCollector: row.collector?.id ? (row.collector as any) : null,
      routeCount,
      accountCount,
    });
  }

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
 * Get collection area by ID.
 */
export async function getCollectionAreaById(id: string): Promise<CollectionAreaDto | null> {
  const rows = await db
    .select({
      area: collectionAreas,
      collector: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
      },
    })
    .from(collectionAreas)
    .leftJoin(users, eq(collectionAreas.assignedCollectorId, users.id))
    .where(eq(collectionAreas.id, id))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];

  const routes = await db
    .select()
    .from(collectionRoutes)
    .where(eq(collectionRoutes.collectionAreaId, id));

  const accountCountRes = await db
    .select({ count: sql<number>`count(*)` })
    .from(serviceAccounts)
    .where(eq(serviceAccounts.collectionAreaId, id));

  return {
    id: row.area.id,
    name: row.area.name,
    code: row.area.code,
    description: row.area.description,
    barangay: row.area.barangay,
    city: row.area.city,
    assignedCollectorId: row.area.assignedCollectorId,
    isActive: row.area.isActive,
    createdAt: row.area.createdAt,
    updatedAt: row.area.updatedAt,
    assignedCollector: row.collector?.id ? (row.collector as any) : null,
    routeCount: routes.length,
    accountCount: Number(accountCountRes[0]?.count || 0),
  };
}

/**
 * Create a new collection area.
 */
export async function createCollectionArea(
  input: CreateCollectionAreaInput,
  actor: { id?: string; name: string },
  ip?: string
): Promise<CollectionAreaDto> {
  // Check name uniqueness
  const [existingName] = await db
    .select()
    .from(collectionAreas)
    .where(ilike(collectionAreas.name, input.name))
    .limit(1);

  if (existingName) {
    const err = new Error(`Collection area with name '${input.name}' already exists`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 409;
    err.code = 'AREA_NAME_EXISTS';
    throw err;
  }

  // Check code uniqueness if provided
  if (input.code) {
    const [existingCode] = await db
      .select()
      .from(collectionAreas)
      .where(ilike(collectionAreas.code, input.code))
      .limit(1);

    if (existingCode) {
      const err = new Error(`Collection area with code '${input.code}' already exists`) as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 409;
      err.code = 'AREA_CODE_EXISTS';
      throw err;
    }
  }

  // Validate collector if specified
  if (input.assignedCollectorId) {
    const [collector] = await db
      .select()
      .from(users)
      .where(eq(users.id, input.assignedCollectorId))
      .limit(1);

    if (!collector) {
      const err = new Error(`Collector user '${input.assignedCollectorId}' was not found`) as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 404;
      err.code = 'COLLECTOR_NOT_FOUND';
      throw err;
    }
  }

  const [created] = await db
    .insert(collectionAreas)
    .values({
      name: input.name,
      code: input.code ?? null,
      description: input.description ?? null,
      barangay: input.barangay ?? null,
      city: input.city || 'Malaybalay',
      assignedCollectorId: input.assignedCollectorId ?? null,
      isActive: true,
    })
    .returning();

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'COLLECTION_AREA_CREATED',
    entityType: 'COLLECTION_AREA',
    entityId: created.id,
    newValues: created,
    ipAddress: ip,
  });

  const full = await getCollectionAreaById(created.id);
  return full!;
}

/**
 * Update an existing collection area.
 */
export async function updateCollectionArea(
  id: string,
  input: UpdateCollectionAreaInput,
  actor: { id?: string; name: string },
  ip?: string
): Promise<CollectionAreaDto> {
  const current = await getCollectionAreaById(id);
  if (!current) {
    const err = new Error(`Collection area '${id}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'AREA_NOT_FOUND';
    throw err;
  }

  if (input.name && input.name.toLowerCase() !== current.name.toLowerCase()) {
    const [existing] = await db
      .select()
      .from(collectionAreas)
      .where(ilike(collectionAreas.name, input.name))
      .limit(1);

    if (existing && existing.id !== id) {
      const err = new Error(`Collection area with name '${input.name}' already exists`) as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 409;
      err.code = 'AREA_NAME_EXISTS';
      throw err;
    }
  }

  if (input.code && input.code !== current.code) {
    const [existingCode] = await db
      .select()
      .from(collectionAreas)
      .where(ilike(collectionAreas.code, input.code))
      .limit(1);

    if (existingCode && existingCode.id !== id) {
      const err = new Error(`Collection area with code '${input.code}' already exists`) as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 409;
      err.code = 'AREA_CODE_EXISTS';
      throw err;
    }
  }

  const updateValues: Partial<typeof collectionAreas.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) updateValues.name = input.name;
  if (input.code !== undefined) updateValues.code = input.code;
  if (input.description !== undefined) updateValues.description = input.description;
  if (input.barangay !== undefined) updateValues.barangay = input.barangay;
  if (input.city !== undefined) updateValues.city = input.city;
  if (input.assignedCollectorId !== undefined) updateValues.assignedCollectorId = input.assignedCollectorId;
  if (input.isActive !== undefined) updateValues.isActive = input.isActive;

  await db.update(collectionAreas).set(updateValues).where(eq(collectionAreas.id, id));

  const updated = await getCollectionAreaById(id);

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'COLLECTION_AREA_UPDATED',
    entityType: 'COLLECTION_AREA',
    entityId: id,
    oldValues: current,
    newValues: updated,
    ipAddress: ip,
  });

  return updated!;
}

/**
 * Delete a collection area.
 */
export async function deleteCollectionArea(
  id: string,
  actor: { id?: string; name: string },
  ip?: string
): Promise<{ success: boolean; message: string }> {
  const current = await getCollectionAreaById(id);
  if (!current) {
    const err = new Error(`Collection area '${id}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'AREA_NOT_FOUND';
    throw err;
  }

  // Check if any service accounts are directly assigned to this area
  const [hasAccounts] = await db
    .select({ id: serviceAccounts.id })
    .from(serviceAccounts)
    .where(eq(serviceAccounts.collectionAreaId, id))
    .limit(1);

  if (hasAccounts) {
    const err = new Error('Cannot delete collection area with assigned service accounts. Reassign or deactivate the area instead.') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 400;
    err.code = 'AREA_HAS_ACCOUNTS';
    throw err;
  }

  // Check if any routes in this area have assigned service accounts
  const [hasRoutesWithAccounts] = await db
    .select({ id: serviceAccounts.id })
    .from(serviceAccounts)
    .innerJoin(collectionRoutes, eq(serviceAccounts.collectionRouteId, collectionRoutes.id))
    .where(eq(collectionRoutes.collectionAreaId, id))
    .limit(1);

  if (hasRoutesWithAccounts) {
    const err = new Error('Cannot delete collection area whose routes have assigned service accounts.') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 400;
    err.code = 'AREA_ROUTES_HAVE_ACCOUNTS';
    throw err;
  }

  // Check if any collection batches reference this area
  const [hasBatches] = await db
    .select()
    .from(collectionBatches)
    .where(eq(collectionBatches.collectionAreaId, id))
    .limit(1);

  if (hasBatches) {
    const err = new Error('Cannot delete collection area with existing collection batches. Deactivate the area instead.') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 400;
    err.code = 'AREA_HAS_BATCHES';
    throw err;
  }

  await db.delete(collectionAreas).where(eq(collectionAreas.id, id));

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'COLLECTION_AREA_DELETED',
    entityType: 'COLLECTION_AREA',
    entityId: id,
    oldValues: current,
    ipAddress: ip,
  });

  return { success: true, message: 'Collection area deleted successfully' };
}

/**
 * Assign a collector to a collection area.
 */
export async function assignCollectorToArea(
  areaId: string,
  collectorId: string,
  actor: { id?: string; name: string },
  ip?: string
): Promise<CollectionAreaDto> {
  const current = await getCollectionAreaById(areaId);
  if (!current) {
    const err = new Error(`Collection area '${areaId}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'AREA_NOT_FOUND';
    throw err;
  }

  const [collector] = await db
    .select()
    .from(users)
    .where(eq(users.id, collectorId))
    .limit(1);

  if (!collector) {
    const err = new Error(`Collector user '${collectorId}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'COLLECTOR_NOT_FOUND';
    throw err;
  }

  await db
    .update(collectionAreas)
    .set({
      assignedCollectorId: collectorId,
      updatedAt: new Date(),
    })
    .where(eq(collectionAreas.id, areaId));

  const updated = await getCollectionAreaById(areaId);

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'COLLECTOR_ASSIGNED_TO_AREA',
    entityType: 'COLLECTION_AREA',
    entityId: areaId,
    oldValues: { assignedCollectorId: current.assignedCollectorId },
    newValues: { assignedCollectorId: collectorId, collectorName: collector.fullName },
    ipAddress: ip,
  });

  return updated!;
}

// ==============================================================================
// Collection Routes
// ==============================================================================

/**
 * List collection routes.
 */
export async function listCollectionRoutes(query: CollectionRouteQueryInput) {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const offset = (page - 1) * limit;

  const conditions = [];

  if (query.collectionAreaId) {
    conditions.push(eq(collectionRoutes.collectionAreaId, query.collectionAreaId));
  }

  if (query.search) {
    const s = `%${query.search}%`;
    conditions.push(
      or(
        ilike(collectionRoutes.name, s),
        ilike(collectionRoutes.routeCode, s)
      )
    );
  }

  if (query.collectorId) {
    conditions.push(eq(collectionRoutes.assignedCollectorId, query.collectorId));
  }

  if (query.isActive !== undefined) {
    conditions.push(eq(collectionRoutes.isActive, query.isActive));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(collectionRoutes)
    .where(whereClause);
  const total = Number(countResult[0]?.count || 0);

  const rows = await db
    .select({
      route: collectionRoutes,
      area: {
        id: collectionAreas.id,
        name: collectionAreas.name,
      },
      collector: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
      },
    })
    .from(collectionRoutes)
    .innerJoin(collectionAreas, eq(collectionRoutes.collectionAreaId, collectionAreas.id))
    .leftJoin(users, eq(collectionRoutes.assignedCollectorId, users.id))
    .where(whereClause)
    .orderBy(asc(collectionRoutes.routeCode))
    .limit(limit)
    .offset(offset);

  const data: CollectionRouteDto[] = rows.map((r) => ({
    id: r.route.id,
    collectionAreaId: r.route.collectionAreaId,
    routeCode: r.route.routeCode,
    name: r.route.name,
    description: r.route.description,
    assignedCollectorId: r.route.assignedCollectorId,
    isActive: r.route.isActive,
    createdAt: r.route.createdAt,
    updatedAt: r.route.updatedAt,
    collectionArea: r.area,
    assignedCollector: r.collector?.id ? (r.collector as any) : null,
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
 * Get route by ID.
 */
export async function getCollectionRouteById(id: string): Promise<CollectionRouteDto | null> {
  const rows = await db
    .select({
      route: collectionRoutes,
      area: {
        id: collectionAreas.id,
        name: collectionAreas.name,
      },
      collector: {
        id: users.id,
        username: users.username,
        fullName: users.fullName,
      },
    })
    .from(collectionRoutes)
    .innerJoin(collectionAreas, eq(collectionRoutes.collectionAreaId, collectionAreas.id))
    .leftJoin(users, eq(collectionRoutes.assignedCollectorId, users.id))
    .where(eq(collectionRoutes.id, id))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];

  return {
    id: r.route.id,
    collectionAreaId: r.route.collectionAreaId,
    routeCode: r.route.routeCode,
    name: r.route.name,
    description: r.route.description,
    assignedCollectorId: r.route.assignedCollectorId,
    isActive: r.route.isActive,
    createdAt: r.route.createdAt,
    updatedAt: r.route.updatedAt,
    collectionArea: r.area,
    assignedCollector: r.collector?.id ? (r.collector as any) : null,
  };
}

/**
 * Create a new collection route.
 */
export async function createCollectionRoute(
  input: CreateCollectionRouteInput,
  actor: { id?: string; name: string },
  ip?: string
): Promise<CollectionRouteDto> {
  const [area] = await db
    .select()
    .from(collectionAreas)
    .where(eq(collectionAreas.id, input.collectionAreaId))
    .limit(1);

  if (!area) {
    const err = new Error(`Collection area '${input.collectionAreaId}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'AREA_NOT_FOUND';
    throw err;
  }

  const [existingCode] = await db
    .select()
    .from(collectionRoutes)
    .where(ilike(collectionRoutes.routeCode, input.routeCode))
    .limit(1);

  if (existingCode) {
    const err = new Error(`Route code '${input.routeCode}' already exists`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 409;
    err.code = 'ROUTE_CODE_EXISTS';
    throw err;
  }

  const [created] = await db
    .insert(collectionRoutes)
    .values({
      collectionAreaId: input.collectionAreaId,
      routeCode: input.routeCode,
      name: input.name,
      description: input.description ?? null,
      assignedCollectorId: input.assignedCollectorId ?? area.assignedCollectorId ?? null,
      isActive: true,
    })
    .returning();

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'COLLECTION_ROUTE_CREATED',
    entityType: 'COLLECTION_ROUTE',
    entityId: created.id,
    newValues: created,
    ipAddress: ip,
  });

  const full = await getCollectionRouteById(created.id);
  return full!;
}

/**
 * Update an existing collection route.
 */
export async function updateCollectionRoute(
  id: string,
  input: UpdateCollectionRouteInput,
  actor: { id?: string; name: string },
  ip?: string
): Promise<CollectionRouteDto> {
  const current = await getCollectionRouteById(id);
  if (!current) {
    const err = new Error(`Collection route '${id}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'ROUTE_NOT_FOUND';
    throw err;
  }

  if (input.routeCode && input.routeCode !== current.routeCode) {
    const [existing] = await db
      .select()
      .from(collectionRoutes)
      .where(ilike(collectionRoutes.routeCode, input.routeCode))
      .limit(1);

    if (existing && existing.id !== id) {
      const err = new Error(`Route code '${input.routeCode}' already exists`) as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 409;
      err.code = 'ROUTE_CODE_EXISTS';
      throw err;
    }
  }

  const updateValues: Partial<typeof collectionRoutes.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.collectionAreaId !== undefined) updateValues.collectionAreaId = input.collectionAreaId;
  if (input.routeCode !== undefined) updateValues.routeCode = input.routeCode;
  if (input.name !== undefined) updateValues.name = input.name;
  if (input.description !== undefined) updateValues.description = input.description;
  if (input.assignedCollectorId !== undefined) updateValues.assignedCollectorId = input.assignedCollectorId;
  if (input.isActive !== undefined) updateValues.isActive = input.isActive;

  await db.update(collectionRoutes).set(updateValues).where(eq(collectionRoutes.id, id));

  const updated = await getCollectionRouteById(id);

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'COLLECTION_ROUTE_UPDATED',
    entityType: 'COLLECTION_ROUTE',
    entityId: id,
    oldValues: current,
    newValues: updated,
    ipAddress: ip,
  });

  return updated!;
}

/**
 * Delete a collection route.
 */
export async function deleteCollectionRoute(
  id: string,
  actor: { id?: string; name: string },
  ip?: string
): Promise<{ success: boolean; message: string }> {
  const current = await getCollectionRouteById(id);
  if (!current) {
    const err = new Error(`Collection route '${id}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'ROUTE_NOT_FOUND';
    throw err;
  }

  // Check if any service accounts are assigned to this route
  const [hasAccounts] = await db
    .select({ id: serviceAccounts.id })
    .from(serviceAccounts)
    .where(eq(serviceAccounts.collectionRouteId, id))
    .limit(1);

  if (hasAccounts) {
    const err = new Error('Cannot delete collection route with assigned service accounts. Reassign or deactivate the route instead.') as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 400;
    err.code = 'ROUTE_HAS_ACCOUNTS';
    throw err;
  }

  await db.delete(collectionRoutes).where(eq(collectionRoutes.id, id));

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'COLLECTION_ROUTE_DELETED',
    entityType: 'COLLECTION_ROUTE',
    entityId: id,
    oldValues: current,
    ipAddress: ip,
  });

  return { success: true, message: 'Collection route deleted successfully' };
}

// ==============================================================================
// Route Sheet Generation
// ==============================================================================

/**
 * Generates a field collection route sheet for a specific collection area.
 * Lists all subscribers with open/overdue balances in the area.
 */
export async function generateRouteSheetForArea(
  areaId: string,
  query?: RouteSheetQueryInput
): Promise<RouteSheetDto> {
  const area = await getCollectionAreaById(areaId);
  if (!area) {
    const err = new Error(`Collection area '${areaId}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'AREA_NOT_FOUND';
    throw err;
  }

  // Find service accounts in this area
  // Rule: If collectionAreaId is explicitly assigned, strictly match areaId.
  // Fallback (only for unassigned collectionAreaId): match by address barangay or collectorId.
  const fallbackConditions = [];
  if (area.name) {
    fallbackConditions.push(ilike(subscriberAddresses.barangay, `%${area.name}%`));
  }
  if (area.barangay) {
    fallbackConditions.push(ilike(subscriberAddresses.barangay, `%${area.barangay}%`));
  }
  if (area.assignedCollectorId) {
    fallbackConditions.push(eq(serviceAccounts.collectorId, area.assignedCollectorId));
  }

  const areaCondition = fallbackConditions.length > 0
    ? or(
        eq(serviceAccounts.collectionAreaId, areaId),
        and(
          isNull(serviceAccounts.collectionAreaId),
          or(...fallbackConditions)
        )
      )
    : eq(serviceAccounts.collectionAreaId, areaId);

  const accountRows = await db
    .select({
      sa: serviceAccounts,
      sub: subscribers,
      addr: subscriberAddresses,
      plan: servicePlans,
    })
    .from(serviceAccounts)
    .innerJoin(subscribers, eq(serviceAccounts.subscriberId, subscribers.id))
    .leftJoin(subscriberAddresses, eq(serviceAccounts.installationAddressId, subscriberAddresses.id))
    .leftJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
    .where(areaCondition);

  const items: RouteSheetAccountItem[] = [];
  let totalArrearsCentavos = 0;

  for (const row of accountRows) {
    // Find open / overdue invoices for this account
    const unpaidInvoices = await db
      .select({
        id: invoices.id,
        dueDate: invoices.dueDate,
        remainingBalanceCentavos: invoices.remainingBalanceCentavos,
        status: invoices.status,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.serviceAccountId, row.sa.id),
          inArray(invoices.status, ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'])
        )
      )
      .orderBy(asc(invoices.dueDate));

    const arrearsCentavos = unpaidInvoices.reduce(
      (sum, inv) => sum + Number(inv.remainingBalanceCentavos),
      0
    );

    // List all accounts in the area, calculating arrears
    const oldestInvoice = unpaidInvoices[0];
    const advanceCreditCentavos = row.sub.advanceCreditCentavos || 0;
    const netDueCentavos = Math.max(0, arrearsCentavos - advanceCreditCentavos);

    const subscriberName = `${row.sub.lastName}, ${row.sub.firstName}${row.sub.businessName ? ` (${row.sub.businessName})` : ''}`;
    const fullAddress = row.addr
      ? `${row.addr.streetAddress}, ${row.addr.barangay}, ${row.addr.municipality}`
      : 'No address recorded';

    items.push({
      serviceAccountId: row.sa.id,
      serviceAccountNumber: row.sa.serviceAccountNumber,
      subscriberId: row.sub.id,
      subscriberAccountNumber: row.sub.accountNumber,
      subscriberName,
      contactNumber: row.sub.contactNumber,
      address: fullAddress,
      barangay: row.addr?.barangay || area.barangay || area.name,
      collectionRouteId: row.sa.collectionRouteId,
      servicePlanName: row.plan?.name || 'Broadband Plan',
      monthlyRateCentavos: row.sa.currentRateCentavos,
      status: row.sa.status,
      openInvoiceCount: unpaidInvoices.length,
      oldestInvoiceDueDate: oldestInvoice ? String(oldestInvoice.dueDate) : null,
      totalArrearsCentavos: arrearsCentavos,
      advanceCreditCentavos,
      netDueCentavos,
    });

    totalArrearsCentavos += arrearsCentavos;
  }

  // Sort: accounts with arrears first (descending by total arrears), then alphabetical
  items.sort((a, b) => {
    if (b.totalArrearsCentavos !== a.totalArrearsCentavos) {
      return b.totalArrearsCentavos - a.totalArrearsCentavos;
    }
    return a.subscriberName.localeCompare(b.subscriberName);
  });

  const totalDelinquentAccounts = items.filter((i) => i.totalArrearsCentavos > 0).length;

  const resultAccounts = query?.overdueOnly
    ? items.filter((i) => i.totalArrearsCentavos > 0)
    : items;

  return {
    area: {
      id: area.id,
      name: area.name,
      code: area.code,
      barangay: area.barangay,
    },
    route: null,
    collector: area.assignedCollector || null,
    generatedAt: new Date().toISOString(),
    totalAccounts: resultAccounts.length,
    totalDelinquentAccounts,
    totalArrearsCentavos,
    accounts: resultAccounts,
  };
}

/**
 * Generates a field collection route sheet for a specific collection route.
 * Filters accounts assigned specifically to this route.
 */
export async function generateRouteSheetForRoute(
  routeId: string,
  query?: RouteSheetQueryInput
): Promise<RouteSheetDto> {
  const route = await getCollectionRouteById(routeId);
  if (!route) {
    const err = new Error(`Collection route '${routeId}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'ROUTE_NOT_FOUND';
    throw err;
  }

  // Get area sheet
  const areaSheet = await generateRouteSheetForArea(route.collectionAreaId, query);

  // Filter accounts assigned specifically to this route
  const routeAccounts = areaSheet.accounts.filter(
    (a) => a.collectionRouteId === route.id
  );

  const totalAccounts = routeAccounts.length;
  const totalDelinquentAccounts = routeAccounts.filter((i) => i.totalArrearsCentavos > 0).length;
  const totalArrearsCentavos = routeAccounts.reduce((sum, i) => sum + i.totalArrearsCentavos, 0);

  return {
    area: areaSheet.area,
    route: {
      id: route.id,
      routeCode: route.routeCode,
      name: route.name,
    },
    collector: route.assignedCollector || areaSheet.collector,
    generatedAt: new Date().toISOString(),
    totalAccounts,
    totalDelinquentAccounts,
    totalArrearsCentavos,
    accounts: routeAccounts,
  };
}

/**
 * Generates a route sheet for a specific collection batch.
 */
export async function generateRouteSheetForBatch(
  batchId: string,
  query?: RouteSheetQueryInput
): Promise<RouteSheetDto> {
  const [batch] = await db
    .select()
    .from(collectionBatches)
    .where(eq(collectionBatches.id, batchId))
    .limit(1);

  if (!batch) {
    const err = new Error(`Collection batch '${batchId}' was not found`) as Error & {
      statusCode: number;
      code: string;
    };
    err.statusCode = 404;
    err.code = 'BATCH_NOT_FOUND';
    throw err;
  }

  const [collector] = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
    })
    .from(users)
    .where(eq(users.id, batch.collectorId))
    .limit(1);

  const sheet = await generateRouteSheetForArea(batch.collectionAreaId, query);

  return {
    ...sheet,
    collector: collector || sheet.collector,
  };
}
