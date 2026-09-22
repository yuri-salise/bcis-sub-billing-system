import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { pool, db } from '../src/db/client.js';
import { seedDatabase } from '../src/db/seed.js';
import { auditLogs, subscribers, subscriberAddresses } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('Subscribers Module (Phase 3)', () => {
  let server: FastifyInstance;
  let adminToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    await seedDatabase();
    server = buildServer();
    await server.ready();

    // Log in Admin
    const adminLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'Admin123!' },
    });
    adminToken = JSON.parse(adminLogin.payload).token;

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

  describe('RBAC & Authentication', () => {
    it('rejects unauthenticated request with HTTP 401', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/subscribers',
      });
      expect(response.statusCode).toBe(401);
    });

    it('denies Cashier from registering a subscriber with HTTP 403 Forbidden', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${cashierToken}` },
        payload: {
          firstName: 'Juan',
          lastName: 'Dela Cruz',
          contactNumber: '09171234567',
          streetAddress: 'Purok 1',
          barangay: 'Casisang',
        },
      });

      expect(response.statusCode).toBe(403);
      const error = JSON.parse(response.payload);
      expect(error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('allows Cashier to view subscriber list', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${cashierToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toBeDefined();
    });
  });

  describe('Input Validation & Constraints', () => {
    it('rejects invalid Philippine mobile phone format with HTTP 400', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Juan',
          lastName: 'Dela Cruz',
          contactNumber: '123456', // Invalid phone
          streetAddress: 'Purok 1',
          barangay: 'Casisang',
        },
      });

      expect(response.statusCode).toBe(400);
      const error = JSON.parse(response.payload);
      expect(error.code).toBe('INVALID_INPUT');
      expect(error.details.some((d: { issue: string }) => d.issue.includes('Philippine mobile'))).toBe(true);
    });

    it('rejects invalid email address with HTTP 400', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Maria',
          lastName: 'Clara',
          contactNumber: '09181234567',
          email: 'not-an-email',
          streetAddress: 'Purok 2',
          barangay: 'Sumpong',
        },
      });

      expect(response.statusCode).toBe(400);
      const error = JSON.parse(response.payload);
      expect(error.details.some((d: { issue: string }) => d.issue.includes('email'))).toBe(true);
    });

    it('rejects missing streetAddress or barangay with HTTP 400', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Pedro',
          lastName: 'Penduko',
          contactNumber: '09191234567',
          // Missing streetAddress & barangay
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Registration & Lifecycle', () => {
    let subscriberId: string;
    let accountNumber: string;

    it('registers a subscriber with auto-generated account number and primary address', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/subscribers',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Cardo',
          middleName: 'Agila',
          lastName: 'Dalisay',
          businessName: 'Agila Security Services',
          contactNumber: '09201234567',
          alternateContact: '09219876543',
          email: 'cardo.dalisay@cidg.gov.ph',
          idType: 'POLICE_ID',
          idNumber: 'CIDG-8888',
          streetAddress: 'Sayre Highway Km 4',
          barangay: 'Casisang',
          municipality: 'Malaybalay',
          province: 'Bukidnon',
          postalCode: '8700',
          notes: 'VIP customer',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.data.id).toBeDefined();
      expect(body.data.accountNumber).toMatch(/^SUB-\d{6}-\d{4}$/);
      expect(body.data.firstName).toBe('Cardo');
      expect(body.data.businessName).toBe('Agila Security Services');
      expect(body.data.status).toBe('ACTIVE');

      // Verify primary address
      expect(body.data.primaryAddress).toBeDefined();
      expect(body.data.primaryAddress.streetAddress).toBe('Sayre Highway Km 4');
      expect(body.data.primaryAddress.barangay).toBe('Casisang');
      expect(body.data.primaryAddress.municipality).toBe('Malaybalay');
      expect(body.data.primaryAddress.province).toBe('Bukidnon');
      expect(body.data.primaryAddress.isPrimary).toBe(true);

      subscriberId = body.data.id;
      accountNumber = body.data.accountNumber;

      // Verify audit log
      const audit = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, subscriberId));
      expect(audit.length).toBeGreaterThan(0);
      expect(audit[0].action).toBe('SUBSCRIBER_CREATED');
      expect(audit[0].entityType).toBe('SUBSCRIBER');
    });

    it('retrieves subscriber by ID', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/subscribers/${subscriberId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.id).toBe(subscriberId);
      expect(body.data.accountNumber).toBe(accountNumber);
      expect(body.data.primaryAddress).toBeDefined();
      expect(Array.isArray(body.data.addresses)).toBe(true);
      expect(Array.isArray(body.data.serviceAccounts)).toBe(true);
    });

    it('retrieves subscriber by account number', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/subscribers/${accountNumber}`,
        headers: { authorization: `Bearer ${cashierToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.id).toBe(subscriberId);
      expect(body.data.accountNumber).toBe(accountNumber);
    });

    it('returns HTTP 404 for non-existent subscriber ID or account number', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/subscribers/SUB-999999-9999',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(404);
      const error = JSON.parse(response.payload);
      expect(error.code).toBe('SUBSCRIBER_NOT_FOUND');
    });

    it('updates subscriber details and primary address via PATCH', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: `/api/v1/subscribers/${subscriberId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          firstName: 'Ricardo',
          contactNumber: '09229998888',
          streetAddress: 'Fortich Street Corner Impalambong',
          barangay: 'Impalambong',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.firstName).toBe('Ricardo');
      expect(body.data.contactNumber).toBe('09229998888');
      expect(body.data.primaryAddress.streetAddress).toBe('Fortich Street Corner Impalambong');
      expect(body.data.primaryAddress.barangay).toBe('Impalambong');

      // Verify audit log
      const audit = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, subscriberId));
      const updateLogs = audit.filter((a) => a.action === 'SUBSCRIBER_UPDATED');
      expect(updateLogs.length).toBeGreaterThan(0);
    });

    it('soft-deletes / archives subscriber via DELETE (per PRODUCT.md rule 635)', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/subscribers/${subscriberId}?reason=Requested+cancellation`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.status).toBe('ARCHIVED');

      // Verify database record still exists (not deleted!)
      const dbRow = await db
        .select()
        .from(subscribers)
        .where(eq(subscribers.id, subscriberId));
      expect(dbRow.length).toBe(1);
      expect(dbRow[0].status).toBe('ARCHIVED');

      // Verify audit log
      const audit = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, subscriberId));
      const archiveLogs = audit.filter((a) => a.action === 'SUBSCRIBER_ARCHIVED');
      expect(archiveLogs.length).toBeGreaterThan(0);
      expect(archiveLogs[0].reason).toBe('Requested cancellation');
    });
  });

  describe('Listing, Pagination, Filtering and Global Search', () => {
    const runSuffix = Date.now().toString().slice(-4);
    const targetBarangay = `Aglayan_${runSuffix}`;
    const targetPhone = `0917${runSuffix}002`;
    const targetSearch = `Guzman_${runSuffix}`;

    beforeAll(async () => {
      // Seed several test subscribers with valid 11-digit numbers
      const samples = [
        {
          firstName: 'Alyssa',
          lastName: `Valdez_${runSuffix}`,
          contactNumber: `0917${runSuffix}001`,
          email: `alyssa_${runSuffix}@volleyball.ph`,
          streetAddress: 'Zone 1',
          barangay: targetBarangay,
        },
        {
          firstName: 'Mika',
          lastName: 'Reyes',
          contactNumber: targetPhone,
          email: `mika_${runSuffix}@volleyball.ph`,
          streetAddress: 'Zone 2',
          barangay: 'Sumpong',
        },
        {
          firstName: 'Jia',
          lastName: targetSearch,
          contactNumber: `0917${runSuffix}003`,
          email: `jia_${runSuffix}@volleyball.ph`,
          streetAddress: 'Zone 3',
          barangay: targetBarangay,
        },
      ];

      for (const s of samples) {
        const res = await server.inject({
          method: 'POST',
          url: '/api/v1/subscribers',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: s,
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it('paginates subscriber records with page and limit parameters', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/subscribers?page=1&limit=2',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.length).toBeLessThanOrEqual(2);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBe(2);
      expect(body.pagination.total).toBeGreaterThanOrEqual(3);
    });

    it('filters subscribers by barangay', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/subscribers?barangay=${targetBarangay}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.length).toBe(2);
      expect(
        body.data.every(
          (s: { primaryAddress: { barangay: string } }) => s.primaryAddress.barangay === targetBarangay
        )
      ).toBe(true);
    });

    it('filters subscribers by phone', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/subscribers?phone=${targetPhone}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.length).toBe(1);
      expect(body.data[0].lastName).toBe('Reyes');
    });

    it('searches subscribers by name via global search query', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/subscribers?search=${targetSearch}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.length).toBe(1);
      expect(body.data[0].firstName).toBe('Jia');
    });
  });
});
