import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, roles, permissions, rolePermissions, userRoles, auditLogs } from '../../db/schema.js';
import { verifyPassword, dummyVerifyPassword } from '../../utils/password.js';
import { AuthUser, UserRole } from '@bcis/shared-types';

export interface AuthSuccessResult {
  success: true;
  user: AuthUser;
}

export interface AuthFailureResult {
  success: false;
  code: 'INVALID_CREDENTIALS' | 'ACCOUNT_INACTIVE' | 'ACCOUNT_LOCKED';
  statusCode: number;
  message: string;
}

export type AuthResult = AuthSuccessResult | AuthFailureResult;

/**
 * Finds user by username (case-insensitive).
 */
export async function findUserByUsername(username: string) {
  const results = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);
  return results[0];
}

/**
 * Finds user by primary UUID.
 */
export async function findUserById(userId: string) {
  const results = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return results[0];
}

/**
 * Fetches all assigned role codes for a user.
 */
export async function getUserRoles(userId: string): Promise<string[]> {
  const results = await db
    .select({ code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
  return results.map((r) => r.code);
}

/**
 * Fetches distinct permission codes for a user based on their roles.
 * ROLE_SUPER_ADMIN inherits all available system permissions.
 */
export async function getUserPermissions(userId: string, roleCodes: string[]): Promise<string[]> {
  if (roleCodes.includes(UserRole.SUPER_ADMIN)) {
    const allPerms = await db.select({ code: permissions.code }).from(permissions);
    return allPerms.map((p) => p.code);
  }

  const results = await db
    .selectDistinct({ code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .innerJoin(userRoles, eq(rolePermissions.roleId, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  return results.map((p) => p.code);
}

/**
 * Increments failed login count and locks account if threshold (5) reached.
 */
export async function handleFailedLogin(userId: string, currentAttempts: number) {
  const newAttempts = currentAttempts + 1;
  const isLocked = newAttempts >= 5;
  const lockedUntil = isLocked ? new Date(Date.now() + 15 * 60 * 1000) : null;

  await db
    .update(users)
    .set({
      failedLoginAttempts: newAttempts,
      lockedUntil,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return { attempts: newAttempts, isLocked, lockedUntil };
}

/**
 * Resets failed login count and unlocks account upon successful authentication.
 */
export async function handleSuccessfulLogin(userId: string) {
  await db
    .update(users)
    .set({
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/**
 * Records an immutable audit log entry for authentication and security events.
 */
export async function recordAuditLog(entry: {
  actorId?: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  ipAddress?: string;
  oldValues?: unknown;
  newValues?: unknown;
  reason?: string;
}) {
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
 * Authenticates user credentials, enforces lockout rules, and gathers roles & permissions.
 */
export async function authenticateUser(
  username: string,
  plainTextPassword: string,
  ipAddress?: string
): Promise<AuthResult> {
  const user = await findUserByUsername(username);

  if (!user) {
    // Constant-time mitigation against username enumeration
    await dummyVerifyPassword(plainTextPassword);

    await recordAuditLog({
      actorId: null,
      actorName: username,
      action: 'AUTH_LOGIN_FAILED',
      entityType: 'USER',
      entityId: username,
      ipAddress,
      reason: 'User not found',
    });

    return {
      success: false,
      code: 'INVALID_CREDENTIALS',
      statusCode: 401,
      message: 'Invalid username or password',
    };
  }

  // Check if account is active
  if (!user.isActive) {
    await recordAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'AUTH_LOGIN_FAILED',
      entityType: 'USER',
      entityId: user.id,
      ipAddress,
      reason: 'Account is deactivated',
    });

    return {
      success: false,
      code: 'ACCOUNT_INACTIVE',
      statusCode: 403,
      message: 'Account is deactivated. Contact administrator.',
    };
  }

  // Check if account is currently locked due to failed login attempts
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const remainingMins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / (60 * 1000));

    await recordAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'AUTH_LOGIN_FAILED',
      entityType: 'USER',
      entityId: user.id,
      ipAddress,
      reason: 'Account is temporarily locked',
    });

    return {
      success: false,
      code: 'ACCOUNT_LOCKED',
      statusCode: 423,
      message: `Account is temporarily locked due to multiple failed login attempts. Try again in ${remainingMins} minute(s).`,
    };
  }

  // If lockout duration has elapsed, reset counter so user is not re-locked on a single typo
  let currentFailedAttempts = user.failedLoginAttempts;
  if (user.lockedUntil && user.lockedUntil <= new Date()) {
    await db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    currentFailedAttempts = 0;
  }

  // Verify password hash
  const isValid = await verifyPassword(user.passwordHash, plainTextPassword);

  if (!isValid) {
    const { isLocked, attempts } = await handleFailedLogin(user.id, currentFailedAttempts);

    if (isLocked) {
      await recordAuditLog({
        actorId: user.id,
        actorName: user.fullName,
        action: 'AUTH_ACCOUNT_LOCKED',
        entityType: 'USER',
        entityId: user.id,
        ipAddress,
        reason: 'Consecutive failed login attempts threshold reached (5)',
        newValues: { failedLoginAttempts: attempts },
      });

      return {
        success: false,
        code: 'ACCOUNT_LOCKED',
        statusCode: 423,
        message: 'Account has been temporarily locked for 15 minutes due to 5 failed login attempts.',
      };
    }

    await recordAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'AUTH_LOGIN_FAILED',
      entityType: 'USER',
      entityId: user.id,
      ipAddress,
      reason: 'Invalid password provided',
      newValues: { failedLoginAttempts: attempts },
    });

    return {
      success: false,
      code: 'INVALID_CREDENTIALS',
      statusCode: 401,
      message: 'Invalid username or password',
    };
  }

  // Reset failed login counter on success
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await handleSuccessfulLogin(user.id);
  }

  const roleCodes = await getUserRoles(user.id);
  const permissionCodes = await getUserPermissions(user.id, roleCodes);

  const authUser: AuthUser = {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    roles: roleCodes,
    permissions: permissionCodes,
  };

  // Audit successful login
  await recordAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'AUTH_LOGIN',
    entityType: 'USER',
    entityId: user.id,
    ipAddress,
    newValues: { username: user.username, roles: roleCodes },
  });

  return {
    success: true,
    user: authUser,
  };
}

/**
 * Authenticates password and enforces lockout/audit rules for workstation screen unlock.
 */
export async function authenticateUnlock(
  userId: string,
  plainTextPassword: string,
  ipAddress?: string
): Promise<AuthResult> {
  const user = await findUserById(userId);

  if (!user) {
    return {
      success: false,
      code: 'INVALID_CREDENTIALS',
      statusCode: 401,
      message: 'User account not found',
    };
  }

  if (!user.isActive) {
    await recordAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'AUTH_UNLOCK_FAILED',
      entityType: 'SESSION',
      entityId: user.id,
      ipAddress,
      reason: 'Account is deactivated',
    });

    return {
      success: false,
      code: 'ACCOUNT_INACTIVE',
      statusCode: 403,
      message: 'Account is deactivated. Contact administrator.',
    };
  }

  // Check active lockout
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const remainingMins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / (60 * 1000));

    await recordAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'AUTH_UNLOCK_FAILED',
      entityType: 'SESSION',
      entityId: user.id,
      ipAddress,
      reason: 'Account is temporarily locked',
    });

    return {
      success: false,
      code: 'ACCOUNT_LOCKED',
      statusCode: 423,
      message: `Account is temporarily locked due to multiple failed attempts. Try again in ${remainingMins} minute(s).`,
    };
  }

  // If lockout duration has elapsed, reset counter
  let currentFailedAttempts = user.failedLoginAttempts;
  if (user.lockedUntil && user.lockedUntil <= new Date()) {
    await db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    currentFailedAttempts = 0;
  }

  const isValid = await verifyPassword(user.passwordHash, plainTextPassword);

  if (!isValid) {
    const { isLocked, attempts } = await handleFailedLogin(user.id, currentFailedAttempts);

    if (isLocked) {
      await recordAuditLog({
        actorId: user.id,
        actorName: user.fullName,
        action: 'AUTH_ACCOUNT_LOCKED',
        entityType: 'USER',
        entityId: user.id,
        ipAddress,
        reason: 'Consecutive failed unlock attempts threshold reached (5)',
        newValues: { failedLoginAttempts: attempts },
      });

      return {
        success: false,
        code: 'ACCOUNT_LOCKED',
        statusCode: 423,
        message: 'Account has been temporarily locked for 15 minutes due to 5 failed attempts.',
      };
    }

    await recordAuditLog({
      actorId: user.id,
      actorName: user.fullName,
      action: 'AUTH_UNLOCK_FAILED',
      entityType: 'SESSION',
      entityId: user.id,
      ipAddress,
      reason: 'Invalid password provided during unlock',
      newValues: { failedLoginAttempts: attempts },
    });

    return {
      success: false,
      code: 'INVALID_CREDENTIALS',
      statusCode: 401,
      message: 'Invalid password',
    };
  }

  // Reset failed login attempts on successful unlock
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await handleSuccessfulLogin(user.id);
  }

  await recordAuditLog({
    actorId: user.id,
    actorName: user.fullName,
    action: 'AUTH_SCREEN_UNLOCK',
    entityType: 'SESSION',
    entityId: user.id,
    ipAddress,
  });

  const roleCodes = await getUserRoles(user.id);
  const permissionCodes = await getUserPermissions(user.id, roleCodes);

  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      roles: roleCodes,
      permissions: permissionCodes,
    },
  };
}
