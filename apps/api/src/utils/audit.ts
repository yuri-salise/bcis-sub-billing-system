import { FastifyRequest } from 'fastify';
import { db } from '../db/client.js';
import { auditLogs } from '../db/schema.js';

export interface AuditLogInput {
  actorId?: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
}

/**
 * Persists an immutable structured audit log entry into PostgreSQL.
 */
export async function writeAuditLog(entry: AuditLogInput): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: entry.actorId ?? null,
    actorName: entry.actorName,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    oldValues: entry.oldValues ?? null,
    newValues: entry.newValues ?? null,
    reason: entry.reason ?? null,
    ipAddress: entry.ipAddress ?? null,
  });
}

/**
 * Extracts actor details from an authenticated FastifyRequest.
 */
export function extractActor(request: FastifyRequest): { id?: string; name: string; ip?: string } {
  const user = request.user;
  return {
    id: user?.id,
    name: user?.fullName || user?.username || 'System',
    ip: request.ip,
  };
}
