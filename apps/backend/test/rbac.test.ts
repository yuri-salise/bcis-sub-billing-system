import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';
import { FastifyInstance } from 'fastify';
import { pool } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { requirePermission, requireRole } from '../src/middleware/rbac.js';
import { UserRole } from '@bcis/shared-types';

describe('RBAC Authorization Engine & Acceptance Test AT-10', () => {
  let server: FastifyInstance;
  let superAdminToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    await seedDatabase();
    server = buildServer();

    // Register additional test routes with specific permission guards
    server.register(async (testScope) => {
      testScope.get(
        '/api/v1/test/payment-action',
        { preHandler: [testScope.authenticate, requirePermission('payment.create')] },
        async () => ({ success: true, message: 'Payment authorized' })
      );

      testScope.get(
        '/api/v1/test/backup-restore',
        { preHandler: [testScope.authenticate, requirePermission('backup.restore')] },
        async () => ({ success: true, message: 'Restore authorized' })
      );

      testScope.get(
        '/api/v1/test/multi-permission-all',
        { preHandler: [testScope.authenticate, requirePermission(['billing.generate', 'billing.void'], 'all')] },
        async () => ({ success: true, message: 'Billing batch and void authorized' })
      );

      testScope.get(
        '/api/v1/test/admin-role-only',
        { preHandler: [testScope.authenticate, requireRole(UserRole.SUPER_ADMIN)] },
        async () => ({ success: true, message: 'Super admin only' })
      );

      // Standalone hooks (without explicit fastify.authenticate before them)
      testScope.get(
        '/api/v1/test/standalone-permission',
        { preHandler: [requirePermission('payment.create')] },
        async () => ({ success: true, message: 'Standalone permission authorized' })
      );

      testScope.get(
        '/api/v1/test/standalone-role',
        { preHandler: [requireRole(UserRole.CASHIER)] },
        async () => ({ success: true, message: 'Standalone role authorized' })
      );
    });

    await server.ready();

    // Log in Super Admin
    const adminLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'Admin123!' },
    });
    superAdminToken = JSON.parse(adminLogin.payload).token;

    // Log in Cashier
    const cashierLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'cashier', password: 'Cashier123!' },
    });
    cashierToken = JSON.parse(cashierLogin.payload).token;
  });

  afterAll(async () => {
    await server.close();
    await pool.end();
  });

  describe('Acceptance Test AT-10: Server-Side RBAC Enforcement', () => {
    it('AT-10: rejects cashier attempting to call user.manage endpoint with HTTP 403 Forbidden', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: {
          authorization: `Bearer ${cashierToken}`,
        },
        payload: {
          username: 'new_staff',
          fullName: 'New Staff',
        },
      });

      expect(response.statusCode).toBe(403);
      const error = JSON.parse(response.payload);
      expect(error.statusCode).toBe(403);
      expect(error.error).toBe('Forbidden');
      expect(error.message).toBe('Insufficient permissions: missing user.manage');
      expect(error.timestamp).toBeDefined();
    });

    it('AT-10: permits super admin to invoke user.manage endpoint with HTTP 201 Created', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: {
          authorization: `Bearer ${superAdminToken}`,
        },
        payload: {
          username: 'new_staff',
          fullName: 'New Staff',
        },
      });

      expect(response.statusCode).toBe(201);
      const data = JSON.parse(response.payload);
      expect(data.message).toBe('User created successfully');
    });

    it('rejects unauthenticated request to protected endpoint with HTTP 401', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
      });

      expect(response.statusCode).toBe(401);
      const error = JSON.parse(response.payload);
      expect(error.statusCode).toBe(401);
      expect(error.error).toBe('Unauthorized');
      expect(error.message).toContain('missing Bearer token');
    });
  });

  describe('Granular Permission Checks', () => {
    it('permits cashier to access payment.create endpoint (granted to cashier)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/test/payment-action',
        headers: {
          authorization: `Bearer ${cashierToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.message).toBe('Payment authorized');
    });

    it('blocks cashier from backup.restore endpoint with HTTP 403 Forbidden', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/test/backup-restore',
        headers: {
          authorization: `Bearer ${cashierToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const error = JSON.parse(response.payload);
      expect(error.message).toBe('Insufficient permissions: missing backup.restore');
    });

    it('permits super admin to access backup.restore endpoint due to unrestricted authority', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/test/backup-restore',
        headers: {
          authorization: `Bearer ${superAdminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.message).toBe('Restore authorized');
    });

    it('enforces all permissions in multi-permission array when mode is all', async () => {
      // Cashier lacks billing.generate and billing.void
      const cashierRes = await server.inject({
        method: 'GET',
        url: '/api/v1/test/multi-permission-all',
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(cashierRes.statusCode).toBe(403);

      // Super Admin passes
      const adminRes = await server.inject({
        method: 'GET',
        url: '/api/v1/test/multi-permission-all',
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      expect(adminRes.statusCode).toBe(200);
    });

    it('enforces requireRole preHandler guard', async () => {
      // Cashier lacks ROLE_SUPER_ADMIN
      const cashierRes = await server.inject({
        method: 'GET',
        url: '/api/v1/test/admin-role-only',
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(cashierRes.statusCode).toBe(403);
      expect(JSON.parse(cashierRes.payload).message).toContain('Insufficient role');

      // Super Admin passes
      const adminRes = await server.inject({
        method: 'GET',
        url: '/api/v1/test/admin-role-only',
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      expect(adminRes.statusCode).toBe(200);
    });

    it('permits authorized user when requirePermission is used standalone without explicit fastify.authenticate', async () => {
      // Cashier has payment.create permission
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/test/standalone-permission',
        headers: { authorization: `Bearer ${cashierToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload).message).toBe('Standalone permission authorized');
    });

    it('permits authorized user when requireRole is used standalone without explicit fastify.authenticate', async () => {
      // Cashier has ROLE_CASHIER
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/test/standalone-role',
        headers: { authorization: `Bearer ${cashierToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload).message).toBe('Standalone role authorized');
    });

    it('safely denies access without 500 when token payload has malformed/missing roles or permissions', async () => {
      // Create a token where roles and permissions are undefined or not arrays
      const malformedToken = server.jwt.sign({
        id: '00000000-0000-0000-0000-000000000099',
        username: 'malformed_user',
        fullName: 'Malformed User',
        roles: undefined as any,
        permissions: undefined as any,
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/test/standalone-permission',
        headers: { authorization: `Bearer ${malformedToken}` },
      });

      // Must cleanly return 403 Forbidden with INSUFFICIENT_PERMISSIONS, NOT 500 TypeError
      expect(response.statusCode).toBe(403);
      const error = JSON.parse(response.payload);
      expect(error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });
  });

  describe('JWT Token Expiration Verification', () => {
    it('rejects expired JWT token with HTTP 401 Unauthorized', async () => {
      // Generate a token that expires in 1ms
      const expiredToken = server.jwt.sign(
        {
          id: '00000000-0000-0000-0000-000000000001',
          username: 'expired_user',
          fullName: 'Expired User',
          roles: [UserRole.SUPER_ADMIN],
          permissions: [],
        },
        { expiresIn: '1ms' }
      );

      // Brief pause to ensure token is past expiration timestamp
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: {
          authorization: `Bearer ${expiredToken}`,
        },
      });

      expect(response.statusCode).toBe(401);
      const error = JSON.parse(response.payload);
      expect(error.statusCode).toBe(401);
      expect(error.error).toBe('Unauthorized');
      expect(error.message).toBe('Token has expired');
    });
  });
});
