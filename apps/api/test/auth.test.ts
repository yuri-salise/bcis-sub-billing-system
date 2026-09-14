import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';
import { FastifyInstance } from 'fastify';
import { pool, db } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { users, auditLogs } from '../src/db/schema.js';
import { hashPassword } from '../src/utils/password.js';
import { eq } from 'drizzle-orm';
import { clearRevokedTokens } from '../src/plugins/jwt.js';

describe('Authentication & Session Engine (Phase 2)', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    // Seed standard base roles, permissions, admin, and cashier users
    await seedDatabase();
    server = buildServer();
    await server.ready();
  });

  afterAll(async () => {
    clearRevokedTokens();
    await server.close();
    await pool.end();
  });

  describe('POST /api/v1/auth/login', () => {
    it('successfully authenticates Super Admin and returns JWT token with roles and permissions', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'admin',
          password: 'Admin123!',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);

      expect(data.token).toBeDefined();
      expect(typeof data.token).toBe('string');
      expect(data.user).toBeDefined();
      expect(data.user.username).toBe('admin');
      expect(data.user.roles).toContain('ROLE_SUPER_ADMIN');
      // Super Admin inherits all 41 granular permissions
      expect(data.user.permissions.length).toBe(41);
      expect(data.user.permissions).toContain('user.manage');
      expect(data.user.permissions).toContain('subscriber.create');
      expect(data.user.permissions).toContain('payment.create');
    });

    it('successfully authenticates Cashier and returns scoped permissions', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'cashier',
          password: 'Cashier123!',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);

      expect(data.user.username).toBe('cashier');
      expect(data.user.roles).toContain('ROLE_CASHIER');
      // Cashier has payment.create and receipt.view, but not user.manage
      expect(data.user.permissions).toContain('payment.create');
      expect(data.user.permissions).toContain('receipt.view');
      expect(data.user.permissions).not.toContain('user.manage');
      expect(data.user.permissions).not.toContain('billing.generate');
    });

    it('rejects login with non-existent username with HTTP 401', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'nonexistent_user',
          password: 'SomePassword123',
        },
      });

      expect(response.statusCode).toBe(401);
      const error = JSON.parse(response.payload);
      expect(error.statusCode).toBe(401);
      expect(error.error).toBe('Unauthorized');
      expect(error.message).toBe('Invalid username or password');
      expect(error.timestamp).toBeDefined();
    });

    it('rejects login with incorrect password with HTTP 401', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'admin',
          password: 'WrongPassword!',
        },
      });

      expect(response.statusCode).toBe(401);
      const error = JSON.parse(response.payload);
      expect(error.statusCode).toBe(401);
      expect(error.message).toBe('Invalid username or password');
    });

    it('rejects malformed payload with HTTP 400 and validation details', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: 'ab', // min 3 chars
          password: '123', // min 6 chars
        },
      });

      expect(response.statusCode).toBe(400);
      const error = JSON.parse(response.payload);
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('INVALID_INPUT');
      expect(error.details).toBeDefined();
      expect(error.details.length).toBeGreaterThanOrEqual(2);
    });

    it('enforces account lockout after 5 consecutive failed login attempts', async () => {
      const lockoutUser = 'lockout_test_user';
      const hash = await hashPassword('ValidPass123!');

      // Ensure clean state before test
      const prev = await db.select({ id: users.id }).from(users).where(eq(users.username, lockoutUser)).limit(1);
      if (prev[0]) {
        await db.delete(auditLogs).where(eq(auditLogs.actorId, prev[0].id));
        await db.delete(users).where(eq(users.id, prev[0].id));
      }

      // Insert test user for lockout
      await db
        .insert(users)
        .values({
          username: lockoutUser,
          passwordHash: hash,
          fullName: 'Lockout Test Subject',
          isActive: true,
          failedLoginAttempts: 0,
        });

      // Attempts 1 through 4: Should return 401
      for (let i = 1; i <= 4; i++) {
        const res = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { username: lockoutUser, password: 'BadPassword!' },
        });
        expect(res.statusCode).toBe(401);
      }

      // 5th failed attempt: Locks the account with HTTP 423
      const res5 = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: lockoutUser, password: 'BadPassword!' },
      });
      expect(res5.statusCode).toBe(423);
      const body5 = JSON.parse(res5.payload);
      expect(body5.message).toContain('Account has been temporarily locked');

      // 6th attempt even with CORRECT password should be rejected because account is locked
      const res6 = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: lockoutUser, password: 'ValidPass123!' },
      });
      expect(res6.statusCode).toBe(423);
      const body6 = JSON.parse(res6.payload);
      expect(body6.message).toContain('temporarily locked');

      // Cleanup
      const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.username, lockoutUser)).limit(1);
      if (existingUser[0]) {
        await db.delete(auditLogs).where(eq(auditLogs.actorId, existingUser[0].id));
        await db.delete(users).where(eq(users.id, existingUser[0].id));
      }
    });

    it('rejects login for deactivated/inactive accounts with HTTP 403', async () => {
      const inactiveUser = 'inactive_employee';
      const hash = await hashPassword('Password123!');

      // Ensure clean state before test
      const prevInactive = await db.select({ id: users.id }).from(users).where(eq(users.username, inactiveUser)).limit(1);
      if (prevInactive[0]) {
        await db.delete(auditLogs).where(eq(auditLogs.actorId, prevInactive[0].id));
        await db.delete(users).where(eq(users.id, prevInactive[0].id));
      }

      await db
        .insert(users)
        .values({
          username: inactiveUser,
          passwordHash: hash,
          fullName: 'Inactive Employee',
          isActive: false,
        });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          username: inactiveUser,
          password: 'Password123!',
        },
      });

      expect(response.statusCode).toBe(403);
      const error = JSON.parse(response.payload);
      expect(error.statusCode).toBe(403);
      expect(error.message).toContain('deactivated');

      // Cleanup
      const existingInactive = await db.select({ id: users.id }).from(users).where(eq(users.username, inactiveUser)).limit(1);
      if (existingInactive[0]) {
        await db.delete(auditLogs).where(eq(auditLogs.actorId, existingInactive[0].id));
        await db.delete(users).where(eq(users.id, existingInactive[0].id));
      }
    });

    it('resets failed attempts counter after lockout period expires without instant re-lockout on single typo', async () => {
      const expiredLockUser = 'expired_lock_user';
      const hash = await hashPassword('ValidPass123!');

      // Insert user whose lockout expired 5 minutes ago
      const expiredDate = new Date(Date.now() - 5 * 60 * 1000);
      const [inserted] = await db
        .insert(users)
        .values({
          username: expiredLockUser,
          passwordHash: hash,
          fullName: 'Expired Lock Test User',
          isActive: true,
          failedLoginAttempts: 5,
          lockedUntil: expiredDate,
        })
        .returning({ id: users.id });

      // First attempt with a typo after lockout expiry: should be attempt 1, NOT re-lockout!
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: expiredLockUser, password: 'TypoPassword!' },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.message).toBe('Invalid username or password');

      // Verify attempts is 1, not 6
      const [updated] = await db.select().from(users).where(eq(users.id, inserted.id));
      expect(updated.failedLoginAttempts).toBe(1);
      expect(updated.lockedUntil).toBeNull();

      // Cleanup
      await db.delete(auditLogs).where(eq(auditLogs.actorId, inserted.id));
      await db.delete(users).where(eq(users.id, inserted.id));
    });

    it('records AUTH_LOGIN_FAILED audit log entries for failed attempts and unknown users', async () => {
      // Unknown user probe
      await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'unknown_probe_user', password: 'SomePassword123!' },
      });

      const auditUnknown = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, 'unknown_probe_user'))
        .limit(1);
      expect(auditUnknown.length).toBe(1);
      expect(auditUnknown[0].action).toBe('AUTH_LOGIN_FAILED');
      expect(auditUnknown[0].reason).toContain('User not found');

      // Cleanup audit entry
      await db.delete(auditLogs).where(eq(auditLogs.id, auditUnknown[0].id));
    });
  });

  describe('GET /api/v1/auth/me', () => {
    let token: string;

    beforeAll(async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'admin', password: 'Admin123!' },
      });
      token = JSON.parse(res.payload).token;
    });

    it('returns current user profile and permissions when provided valid Bearer token', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.user).toBeDefined();
      expect(data.user.username).toBe('admin');
      expect(data.user.roles).toContain('ROLE_SUPER_ADMIN');
      expect(data.user.permissions.length).toBe(41);
    });

    it('rejects request with HTTP 401 when Authorization header is missing', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
      });

      expect(response.statusCode).toBe(401);
      const error = JSON.parse(response.payload);
      expect(error.statusCode).toBe(401);
      expect(error.message).toContain('missing Bearer token');
    });

    it('rejects request with HTTP 401 when token signature is invalid', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: 'Bearer invalid.tampered.token',
        },
      });

      expect(response.statusCode).toBe(401);
      const error = JSON.parse(response.payload);
      expect(error.statusCode).toBe(401);
      expect(error.message).toContain('Invalid token signature');
    });

    it('rejects deactivated user with HTTP 403 Forbidden and ACCOUNT_INACTIVE', async () => {
      const tempUser = 'temp_deact_me_user';
      const hash = await hashPassword('TempPass123!');
      const [u] = await db
        .insert(users)
        .values({
          username: tempUser,
          passwordHash: hash,
          fullName: 'Temp Deact User',
          isActive: true,
        })
        .returning({ id: users.id });

      const loginRes = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: tempUser, password: 'TempPass123!' },
      });
      const userToken = JSON.parse(loginRes.payload).token;

      // Deactivate user in database
      await db.update(users).set({ isActive: false }).where(eq(users.id, u.id));

      const meRes = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(meRes.statusCode).toBe(403);
      const error = JSON.parse(meRes.payload);
      expect(error.code).toBe('ACCOUNT_INACTIVE');

      // Cleanup
      await db.delete(auditLogs).where(eq(auditLogs.actorId, u.id));
      await db.delete(users).where(eq(users.id, u.id));
    });
  });

  describe('POST /api/v1/auth/logout & Session Revocation', () => {
    it('revokes the session token so subsequent requests fail with HTTP 401', async () => {
      // 1. Log in to obtain a fresh token
      const loginRes = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'admin', password: 'Admin123!' },
      });
      const userToken = JSON.parse(loginRes.payload).token;

      // 2. Verify token works before logout
      const beforeLogoutRes = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(beforeLogoutRes.statusCode).toBe(200);

      // 3. Logout
      const logoutRes = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(logoutRes.statusCode).toBe(200);
      expect(JSON.parse(logoutRes.payload).message).toBe('Logged out successfully');

      // 4. Verify the revoked token is rejected
      const afterLogoutRes = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(afterLogoutRes.statusCode).toBe(401);
      const error = JSON.parse(afterLogoutRes.payload);
      expect(error.message).toContain('Token has been revoked');
    });
  });

  describe('POST /api/v1/auth/lock & POST /api/v1/auth/unlock', () => {
    let token: string;

    beforeAll(async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'admin', password: 'Admin123!' },
      });
      token = JSON.parse(res.payload).token;
    });

    it('locks desktop workstation session without invalidating token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/lock',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.locked).toBe(true);
      expect(data.message).toContain('Workstation session locked');
    });

    it('unlocks workstation screen upon entering correct password', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/unlock',
        headers: { authorization: `Bearer ${token}` },
        payload: { password: 'Admin123!' },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.unlocked).toBe(true);
      expect(data.message).toContain('Workstation session unlocked');
    });

    it('rejects unlocking workstation with wrong password', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/unlock',
        headers: { authorization: `Bearer ${token}` },
        payload: { password: 'WrongPassword999!' },
      });

      expect(response.statusCode).toBe(401);
      const error = JSON.parse(response.payload);
      expect(error.statusCode).toBe(401);
      expect(error.message).toBe('Invalid password');
    });

    it('enforces lockout on 5 consecutive failed unlock attempts with HTTP 423', async () => {
      const unlockTestUser = 'unlock_lockout_user';
      const hash = await hashPassword('UnlockPass123!');
      const [u] = await db
        .insert(users)
        .values({
          username: unlockTestUser,
          passwordHash: hash,
          fullName: 'Unlock Lockout User',
          isActive: true,
        })
        .returning({ id: users.id });

      const loginRes = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: unlockTestUser, password: 'UnlockPass123!' },
      });
      const userToken = JSON.parse(loginRes.payload).token;

      // Attempts 1 through 4 should return 401
      for (let i = 1; i <= 4; i++) {
        const res = await server.inject({
          method: 'POST',
          url: '/api/v1/auth/unlock',
          headers: { authorization: `Bearer ${userToken}` },
          payload: { password: 'WrongPassword!' },
        });
        expect(res.statusCode).toBe(401);
      }

      // 5th attempt triggers lockout
      const res5 = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/unlock',
        headers: { authorization: `Bearer ${userToken}` },
        payload: { password: 'WrongPassword!' },
      });
      expect(res5.statusCode).toBe(423);
      const body5 = JSON.parse(res5.payload);
      expect(body5.code).toBe('ACCOUNT_LOCKED');

      // Cleanup
      await db.delete(auditLogs).where(eq(auditLogs.actorId, u.id));
      await db.delete(users).where(eq(users.id, u.id));
    });

    it('rejects unlock for deactivated account with HTTP 403 and ACCOUNT_INACTIVE', async () => {
      const deactUser = 'unlock_deactivated_user';
      const hash = await hashPassword('UnlockPass123!');
      const [u] = await db
        .insert(users)
        .values({
          username: deactUser,
          passwordHash: hash,
          fullName: 'Unlock Deactivated User',
          isActive: true,
        })
        .returning({ id: users.id });

      const loginRes = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: deactUser, password: 'UnlockPass123!' },
      });
      const userToken = JSON.parse(loginRes.payload).token;

      // Deactivate user in DB
      await db.update(users).set({ isActive: false }).where(eq(users.id, u.id));

      const unlockRes = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/unlock',
        headers: { authorization: `Bearer ${userToken}` },
        payload: { password: 'UnlockPass123!' },
      });

      expect(unlockRes.statusCode).toBe(403);
      const error = JSON.parse(unlockRes.payload);
      expect(error.code).toBe('ACCOUNT_INACTIVE');

      // Cleanup
      await db.delete(auditLogs).where(eq(auditLogs.actorId, u.id));
      await db.delete(users).where(eq(users.id, u.id));
    });
  });
});
