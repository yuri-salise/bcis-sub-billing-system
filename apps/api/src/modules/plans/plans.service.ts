import { eq, ilike, or, and, inArray, desc } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { servicePlans, serviceTypes } from '../../db/schema.js';
import { writeAuditLog } from '../../utils/audit.js';
import { CreatePlanInput, UpdatePlanInput, PlanQueryInput } from '@bcis/validation';

export interface PlanServiceResult {
  id: string;
  planCode: string;
  code: string;
  name: string;
  serviceTypeId: string;
  serviceType: string;
  monthlyFeeCentavos: number;
  monthlyRecurringCentavos: number;
  installationFeeCentavos: number;
  bandwidthMbps: number | null;
  channelCount: number | null;
  isActive: boolean;
  createdAt: Date;
}

/**
 * Normalizes input service type string to supported service type codes.
 */
function getMatchingServiceTypeCodes(type: string): string[] {
  const upper = type.toUpperCase();
  if (upper === 'CABLE' || upper === 'CABLE_TV') return ['CABLE', 'CABLE_TV'];
  if (upper === 'INTERNET') return ['INTERNET'];
  if (upper === 'BUNDLE' || upper === 'COMBO') return ['BUNDLE', 'COMBO'];
  return [upper];
}

/**
 * Resolves or ensures the service type record exists in PostgreSQL.
 */
async function resolveServiceType(type: string) {
  const codes = getMatchingServiceTypeCodes(type);
  const found = await db
    .select()
    .from(serviceTypes)
    .where(inArray(serviceTypes.code, codes))
    .limit(1);

  if (found.length > 0) {
    return found[0];
  }

  // Fallback: insert the service type if missing
  const [created] = await db
    .insert(serviceTypes)
    .values({
      code: codes[0],
      name: `${codes[0]} Service`,
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const refetched = await db
    .select()
    .from(serviceTypes)
    .where(inArray(serviceTypes.code, codes))
    .limit(1);

  return refetched[0];
}

/**
 * Lists service plans with optional filtering.
 */
export async function listPlans(query?: PlanQueryInput): Promise<PlanServiceResult[]> {
  const conditions = [];

  if (query?.isActive !== undefined) {
    conditions.push(eq(servicePlans.isActive, query.isActive));
  }

  if (query?.search) {
    const term = `%${query.search}%`;
    conditions.push(or(ilike(servicePlans.name, term), ilike(servicePlans.planCode, term)));
  }

  let typeFilterIds: string[] | undefined;
  if (query?.serviceType) {
    const matchingCodes = getMatchingServiceTypeCodes(query.serviceType);
    const types = await db
      .select({ id: serviceTypes.id })
      .from(serviceTypes)
      .where(inArray(serviceTypes.code, matchingCodes));
    typeFilterIds = types.map((t) => t.id);
    if (typeFilterIds.length > 0) {
      conditions.push(inArray(servicePlans.serviceTypeId, typeFilterIds));
    } else {
      // No service types match the requested code -> return empty
      return [];
    }
  }

  const queryBuilder = db
    .select({
      plan: servicePlans,
      serviceTypeCode: serviceTypes.code,
    })
    .from(servicePlans)
    .leftJoin(serviceTypes, eq(servicePlans.serviceTypeId, serviceTypes.id))
    .orderBy(desc(servicePlans.createdAt));

  const rows = conditions.length > 0
    ? await queryBuilder.where(and(...conditions))
    : await queryBuilder;

  return rows.map(({ plan, serviceTypeCode }) => ({
    id: plan.id,
    planCode: plan.planCode,
    code: plan.planCode,
    name: plan.name,
    serviceTypeId: plan.serviceTypeId,
    serviceType: serviceTypeCode || 'UNKNOWN',
    monthlyFeeCentavos: plan.monthlyRecurringCentavos,
    monthlyRecurringCentavos: plan.monthlyRecurringCentavos,
    installationFeeCentavos: plan.installationFeeCentavos,
    bandwidthMbps: plan.bandwidthMbps,
    channelCount: plan.channelCount,
    isActive: plan.isActive,
    createdAt: plan.createdAt,
  }));
}

/**
 * Retrieves a single service plan by ID or planCode.
 */
export async function getPlanById(idOrCode: string): Promise<PlanServiceResult | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);
  const condition = isUuid
    ? or(eq(servicePlans.id, idOrCode), eq(servicePlans.planCode, idOrCode))
    : eq(servicePlans.planCode, idOrCode);

  const rows = await db
    .select({
      plan: servicePlans,
      serviceTypeCode: serviceTypes.code,
    })
    .from(servicePlans)
    .leftJoin(serviceTypes, eq(servicePlans.serviceTypeId, serviceTypes.id))
    .where(condition)
    .limit(1);

  if (rows.length === 0) return null;

  const { plan, serviceTypeCode } = rows[0];
  return {
    id: plan.id,
    planCode: plan.planCode,
    code: plan.planCode,
    name: plan.name,
    serviceTypeId: plan.serviceTypeId,
    serviceType: serviceTypeCode || 'UNKNOWN',
    monthlyFeeCentavos: plan.monthlyRecurringCentavos,
    monthlyRecurringCentavos: plan.monthlyRecurringCentavos,
    installationFeeCentavos: plan.installationFeeCentavos,
    bandwidthMbps: plan.bandwidthMbps,
    channelCount: plan.channelCount,
    isActive: plan.isActive,
    createdAt: plan.createdAt,
  };
}

/**
 * Creates a new service plan.
 */
export async function createPlan(
  input: CreatePlanInput,
  actor: { id?: string; name: string },
  ip?: string
): Promise<PlanServiceResult> {
  const st = await resolveServiceType(input.serviceType);
  if (!st) {
    const err = new Error(`Unsupported service type: ${input.serviceType}`) as Error & { statusCode: number; code: string };
    err.statusCode = 400;
    err.code = 'INVALID_SERVICE_TYPE';
    throw err;
  }

  const planCode = input.planCode || input.code || `PLAN-${input.serviceType.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-4)}`;

  // Check unique planCode
  const existing = await db
    .select({ id: servicePlans.id })
    .from(servicePlans)
    .where(eq(servicePlans.planCode, planCode))
    .limit(1);

  if (existing.length > 0) {
    const err = new Error(`Service plan with code '${planCode}' already exists`) as Error & { statusCode: number; code: string };
    err.statusCode = 409;
    err.code = 'PLAN_CODE_EXISTS';
    throw err;
  }

  const monthlyFeeCentavos = input.monthlyFeeCentavos ?? input.monthlyRecurringCentavos ?? 0;

  const [inserted] = await db
    .insert(servicePlans)
    .values({
      serviceTypeId: st.id,
      planCode,
      name: input.name,
      monthlyRecurringCentavos: monthlyFeeCentavos,
      installationFeeCentavos: input.installationFeeCentavos ?? 0,
      bandwidthMbps: input.bandwidthMbps ?? null,
      channelCount: input.channelCount ?? null,
      isActive: input.isActive ?? true,
    })
    .returning();

  const result: PlanServiceResult = {
    id: inserted.id,
    planCode: inserted.planCode,
    code: inserted.planCode,
    name: inserted.name,
    serviceTypeId: inserted.serviceTypeId,
    serviceType: st.code,
    monthlyFeeCentavos: inserted.monthlyRecurringCentavos,
    monthlyRecurringCentavos: inserted.monthlyRecurringCentavos,
    installationFeeCentavos: inserted.installationFeeCentavos,
    bandwidthMbps: inserted.bandwidthMbps,
    channelCount: inserted.channelCount,
    isActive: inserted.isActive,
    createdAt: inserted.createdAt,
  };

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'PLAN_CREATED',
    entityType: 'SERVICE_PLAN',
    entityId: inserted.id,
    newValues: result,
    ipAddress: ip,
  });

  return result;
}

/**
 * Updates an existing service plan.
 */
export async function updatePlan(
  id: string,
  input: UpdatePlanInput,
  actor: { id?: string; name: string },
  ip?: string
): Promise<PlanServiceResult | null> {
  const current = await getPlanById(id);
  if (!current) return null;

  const newPlanCode = input.planCode || input.code;
  if (newPlanCode && newPlanCode !== current.planCode) {
    const existing = await db
      .select({ id: servicePlans.id })
      .from(servicePlans)
      .where(eq(servicePlans.planCode, newPlanCode))
      .limit(1);

    if (existing.length > 0) {
      const err = new Error(`Service plan with code '${newPlanCode}' already exists`) as Error & { statusCode: number; code: string };
      err.statusCode = 409;
      err.code = 'PLAN_CODE_EXISTS';
      throw err;
    }
  }

  let newServiceTypeId: string | undefined;
  let newServiceTypeCode = current.serviceType;
  if (input.serviceType) {
    const st = await resolveServiceType(input.serviceType);
    if (st) {
      newServiceTypeId = st.id;
      newServiceTypeCode = st.code;
    }
  }

  const updateValues: Partial<typeof servicePlans.$inferInsert> = {};
  if (input.name !== undefined) updateValues.name = input.name;
  if (newPlanCode !== undefined) updateValues.planCode = newPlanCode;
  if (newServiceTypeId !== undefined) updateValues.serviceTypeId = newServiceTypeId;
  if (input.monthlyFeeCentavos !== undefined) updateValues.monthlyRecurringCentavos = input.monthlyFeeCentavos;
  else if (input.monthlyRecurringCentavos !== undefined) updateValues.monthlyRecurringCentavos = input.monthlyRecurringCentavos;
  if (input.installationFeeCentavos !== undefined) updateValues.installationFeeCentavos = input.installationFeeCentavos;
  if (input.bandwidthMbps !== undefined) updateValues.bandwidthMbps = input.bandwidthMbps;
  if (input.channelCount !== undefined) updateValues.channelCount = input.channelCount;
  if (input.isActive !== undefined) updateValues.isActive = input.isActive;

  const [updated] = await db
    .update(servicePlans)
    .set(updateValues)
    .where(eq(servicePlans.id, current.id))
    .returning();

  const result: PlanServiceResult = {
    id: updated.id,
    planCode: updated.planCode,
    code: updated.planCode,
    name: updated.name,
    serviceTypeId: updated.serviceTypeId,
    serviceType: newServiceTypeCode,
    monthlyFeeCentavos: updated.monthlyRecurringCentavos,
    monthlyRecurringCentavos: updated.monthlyRecurringCentavos,
    installationFeeCentavos: updated.installationFeeCentavos,
    bandwidthMbps: updated.bandwidthMbps,
    channelCount: updated.channelCount,
    isActive: updated.isActive,
    createdAt: updated.createdAt,
  };

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'PLAN_UPDATED',
    entityType: 'SERVICE_PLAN',
    entityId: updated.id,
    oldValues: current,
    newValues: result,
    ipAddress: ip,
  });

  return result;
}
