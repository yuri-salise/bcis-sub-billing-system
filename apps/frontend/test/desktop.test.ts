import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentMethod, InvoiceStatus, UserRole } from '@bcis/shared-types';
import { formatCurrency, parseCurrencyToCentavos, allocatePaymentFIFO, calculateDaysOverdue, getAgingBucket } from '@bcis/domain';
import { apiClient } from '../src/api/client.js';
import { canAccessWorkspace, getAllowedWorkspaces, getDefaultWorkspace, getRoleDisplayName } from '../src/auth/rbac.js';

describe('Desktop Client & Role-Based Workspaces (Phase 8)', () => {
  beforeEach(() => {
    apiClient.setToken(null);
    apiClient.setBaseUrl('http://127.0.0.1:4000');
  });

  describe('1. Fastify LAN API Client & Configuration', () => {
    it('initializes with default LAN base URL and supports runtime update', () => {
      expect(apiClient.getBaseUrl()).toBe('http://127.0.0.1:4000');
      apiClient.setBaseUrl('http://192.168.1.150:4000/');
      expect(apiClient.getBaseUrl()).toBe('http://192.168.1.150:4000');
    });

    it('stores and clears session JWT token securely', () => {
      expect(apiClient.getToken()).toBeNull();
      apiClient.setToken('test-jwt-bearer-token');
      expect(apiClient.getToken()).toBe('test-jwt-bearer-token');
      apiClient.setToken(null);
      expect(apiClient.getToken()).toBeNull();
    });

    it('handles offline fallback demo login when LAN server is not yet booted', async () => {
      const res = await apiClient.login('cashier', 'Cashier123!');
      expect(res.token).toBeDefined();
      expect(res.user.username).toBe('cashier');
      expect(res.user.roles).toContain(UserRole.CASHIER);
    });
  });

  describe('2. Cashier POS: Multi-Tender, Change Calculator & FIFO Allocation', () => {
    it('calculates exact change for cash tender without floating-point errors', () => {
      const totalDueCentavos = 149950; // ₱1,499.50
      const tenderedCentavos = parseCurrencyToCentavos('1500.00'); // ₱1,500.00 (150000 centavos)
      const changeCentavos = tenderedCentavos - totalDueCentavos;

      expect(changeCentavos).toBe(50); // Exactly 50 centavos (₱0.50)
      expect(formatCurrency(changeCentavos)).toBe('₱0.50');
    });

    it('detects cash shortage when tendered amount is insufficient', () => {
      const totalDueCentavos = 249900; // ₱2,499.00
      const tenderedCentavos = parseCurrencyToCentavos('2000.00'); // ₱2,000.00
      const changeCentavos = tenderedCentavos - totalDueCentavos;

      expect(changeCentavos).toBe(-49900); // Negative ₱499.00
      expect(changeCentavos < 0).toBe(true);
    });

    it('generates real-time FIFO allocation preview across multiple outstanding invoices', () => {
      const mockInvoices = [
        {
          id: 'inv-1',
          invoiceNumber: 'INV-2026-001',
          dueDate: '2026-08-15',
          createdAt: '2026-08-01',
          totalDueCentavos: 100000, // ₱1,000.00
          allocatedCentavos: 0,
          remainingBalanceCentavos: 100000,
        },
        {
          id: 'inv-2',
          invoiceNumber: 'INV-2026-002',
          dueDate: '2026-09-15',
          createdAt: '2026-09-01',
          totalDueCentavos: 100000, // ₱1,000.00
          allocatedCentavos: 0,
          remainingBalanceCentavos: 100000,
        },
      ];

      // Customer pays ₱1,500.00 (150000 centavos)
      const plan = allocatePaymentFIFO(150000, mockInvoices);

      expect(plan.totalAllocatedCentavos).toBe(150000);
      expect(plan.advanceCreditCentavos).toBe(0);
      expect(plan.allocations).toHaveLength(2);

      // Oldest invoice fully paid
      expect(plan.allocations[0].invoiceNumber).toBe('INV-2026-001');
      expect(plan.allocations[0].allocatedAmountCentavos).toBe(100000);
      expect(plan.allocations[0].newStatus).toBe(InvoiceStatus.PAID);

      // Newer invoice partially paid
      expect(plan.allocations[1].invoiceNumber).toBe('INV-2026-002');
      expect(plan.allocations[1].allocatedAmountCentavos).toBe(50000);
      expect(plan.allocations[1].newRemainingBalanceCentavos).toBe(50000);
      expect(plan.allocations[1].newStatus).toBe(InvoiceStatus.PARTIALLY_PAID);
    });

    it('allocates excess funds into advance credit', () => {
      const mockInvoices = [
        {
          id: 'inv-1',
          invoiceNumber: 'INV-2026-001',
          dueDate: '2026-09-15',
          createdAt: '2026-09-01',
          totalDueCentavos: 99900,
          allocatedCentavos: 0,
          remainingBalanceCentavos: 99900,
        },
      ];

      // Customer pays ₱1,500.00
      const plan = allocatePaymentFIFO(150000, mockInvoices);
      expect(plan.allocations[0].newStatus).toBe(InvoiceStatus.PAID);
      expect(plan.advanceCreditCentavos).toBe(50100); // ₱501.00 excess
    });

    it('strictly ignores DRAFT and VOID status invoices during payment allocation preview', () => {
      const mockInvoices = [
        {
          id: 'inv-draft',
          invoiceNumber: 'INV-DRAFT-001',
          dueDate: '2026-08-01',
          createdAt: '2026-08-01',
          status: InvoiceStatus.DRAFT,
          totalDueCentavos: 100000,
          allocatedCentavos: 0,
          remainingBalanceCentavos: 100000,
        },
        {
          id: 'inv-void',
          invoiceNumber: 'INV-VOID-001',
          dueDate: '2026-08-05',
          createdAt: '2026-08-05',
          status: InvoiceStatus.VOID,
          totalDueCentavos: 50000,
          allocatedCentavos: 0,
          remainingBalanceCentavos: 50000,
        },
        {
          id: 'inv-unpaid',
          invoiceNumber: 'INV-POSTED-001',
          dueDate: '2026-08-15',
          createdAt: '2026-08-15',
          status: InvoiceStatus.UNPAID,
          totalDueCentavos: 100000,
          allocatedCentavos: 0,
          remainingBalanceCentavos: 100000,
        },
      ];

      // Paying ₱1,500.00: only the posted unpaid invoice should be paid (₱1,000), remainder goes to advance credit
      const plan = allocatePaymentFIFO(150000, mockInvoices);
      expect(plan.allocations).toHaveLength(1);
      expect(plan.allocations[0].invoiceNumber).toBe('INV-POSTED-001');
      expect(plan.allocations[0].allocatedAmountCentavos).toBe(100000);
      expect(plan.totalAllocatedCentavos).toBe(100000);
      expect(plan.advanceCreditCentavos).toBe(50000);
    });
  });

  describe('3. Official Receipt (OR) BIR Compliance Calculation', () => {
    it('computes 12% VATable sales and VAT breakdown accurately', () => {
      const totalPaidCentavos = 149950; // ₱1,499.50 inclusive of 12% VAT
      const vatableSalesCentavos = Math.round(totalPaidCentavos / 1.12);
      const vatAmountCentavos = totalPaidCentavos - vatableSalesCentavos;

      expect(vatableSalesCentavos + vatAmountCentavos).toBe(totalPaidCentavos);
      expect(formatCurrency(vatableSalesCentavos)).toBe('₱1,338.84');
      expect(formatCurrency(vatAmountCentavos)).toBe('₱160.66');
    });
  });

  describe('4. Reports: 5-Bucket AR Aging Computations', () => {
    it('categorizes invoices into appropriate aging buckets based on calendar overdue days', () => {
      const asOf = new Date('2026-09-19');

      // Due today or future -> CURRENT
      expect(getAgingBucket('2026-09-20', asOf)).toBe('CURRENT');

      // 15 days overdue -> DAYS_1_30
      expect(getAgingBucket('2026-09-04', asOf)).toBe('DAYS_1_30');

      // 45 days overdue -> DAYS_31_60
      expect(getAgingBucket('2026-08-05', asOf)).toBe('DAYS_31_60');

      // 75 days overdue -> DAYS_61_90
      expect(getAgingBucket('2026-07-06', asOf)).toBe('DAYS_61_90');

      // 105 days overdue -> DAYS_90_PLUS
      expect(getAgingBucket('2026-06-06', asOf)).toBe('DAYS_90_PLUS');
    });

    it('normalizes AR aging response with 5 standard domain buckets and percentages', async () => {
      const res = await apiClient.getArAging();
      expect(res.data.buckets).toHaveLength(5);
      expect(res.data.buckets.map((b) => b.bucket)).toEqual([
        'CURRENT',
        'DAYS_1_30',
        'DAYS_31_60',
        'DAYS_61_90',
        'DAYS_90_PLUS',
      ]);
      expect(res.data.totalReceivablesCentavos).toBeGreaterThan(0);
      const totalPct = res.data.buckets.reduce((acc, b) => acc + b.percentage, 0);
      expect(Math.round(totalPct)).toBe(100);
    });

    it('normalizes daily collections report and computes summary totals', async () => {
      const res = await apiClient.getDailyCollections('2026-09-19');
      expect(res.data.reportDate).toBe('2026-09-19');
      expect(res.data.totalCollectedCentavos).toBeGreaterThan(0);
      expect(res.data.items.length).toBeGreaterThan(0);
      expect(res.data.totalPayments).toBe(res.data.items.length);
    });
  });

  describe('5. Field Collections & Route Sheets', () => {
    it('fetches area route sheet with correct path and returns delinquent accounts', async () => {
      const res = await apiClient.getAreaRouteSheet('area-1', true);
      expect(res.data).toBeDefined();
      expect(Array.isArray(res.data)).toBe(true);
      expect(res.data.length).toBeGreaterThan(0);
      expect(res.data[0].arrearsCentavos).toBeGreaterThan(0);
    });

    it('fetches route-specific route sheet and verifies route association', async () => {
      const res = await apiClient.getRouteRouteSheet('route-1', false);
      expect(res.data).toBeDefined();
      expect(Array.isArray(res.data)).toBe(true);
      expect(res.data.length).toBeGreaterThan(0);
      expect(res.data[0].routeId).toBe('route-1');
    });
  });

  describe('6. Subscriber Management & Service Order Financial Parsing', () => {
    it('parses currency input into integer centavos for service orders without float drift', () => {
      expect(parseCurrencyToCentavos('1500.00')).toBe(150000);
      expect(parseCurrencyToCentavos('999.50')).toBe(99950);
      expect(parseCurrencyToCentavos('0')).toBe(0);
      expect(parseCurrencyToCentavos('')).toBe(0);
    });

    it('calls updateSubscriber endpoint with patched fields', async () => {
      const res = await apiClient.updateSubscriber('sub-001', { phone: '09991234567' });
      expect(res.data).toBeDefined();
      expect(res.data.id).toBe('sub-001');
      expect(res.data.phone).toBe('09991234567');
    });
  });

  describe('7. RBAC Matrix & Desktop Workspace Gating', () => {
    it('permits Cashier ONLY in Cashier POS workspace and strictly denies other modules', () => {
      const cashierRoles = [UserRole.CASHIER];

      expect(canAccessWorkspace(cashierRoles, 'pos')).toBe(true);
      expect(canAccessWorkspace(cashierRoles, 'billing')).toBe(false);
      expect(canAccessWorkspace(cashierRoles, 'collections')).toBe(false);
      expect(canAccessWorkspace(cashierRoles, 'tech')).toBe(false);
      expect(canAccessWorkspace(cashierRoles, 'reports')).toBe(false);
      expect(canAccessWorkspace(cashierRoles, 'settings')).toBe(false);

      expect(getAllowedWorkspaces(cashierRoles)).toEqual(['pos']);
      expect(getDefaultWorkspace(UserRole.CASHIER)).toBe('pos');
    });

    it('permits Technician ONLY in Service Orders workspace', () => {
      const techRoles = [UserRole.TECHNICIAN];

      expect(canAccessWorkspace(techRoles, 'tech')).toBe(true);
      expect(canAccessWorkspace(techRoles, 'pos')).toBe(false);
      expect(canAccessWorkspace(techRoles, 'billing')).toBe(false);
      expect(canAccessWorkspace(techRoles, 'collections')).toBe(false);
      expect(canAccessWorkspace(techRoles, 'reports')).toBe(false);
      expect(canAccessWorkspace(techRoles, 'settings')).toBe(false);

      expect(getAllowedWorkspaces(techRoles)).toEqual(['tech']);
      expect(getDefaultWorkspace(UserRole.TECHNICIAN)).toBe('tech');
    });

    it('permits Collection Supervisor in collections and tech but denies pos and billing', () => {
      const supervisorRoles = [UserRole.COLLECTION_SUPERVISOR];

      expect(canAccessWorkspace(supervisorRoles, 'collections')).toBe(true);
      expect(canAccessWorkspace(supervisorRoles, 'tech')).toBe(true);
      expect(canAccessWorkspace(supervisorRoles, 'pos')).toBe(false);
      expect(canAccessWorkspace(supervisorRoles, 'billing')).toBe(false);
      expect(canAccessWorkspace(supervisorRoles, 'settings')).toBe(false);

      expect(getDefaultWorkspace(UserRole.COLLECTION_SUPERVISOR)).toBe('collections');
    });

    it('permits Accounting in reports and collections but denies pos and settings', () => {
      const accountingRoles = [UserRole.ACCOUNTING];

      expect(canAccessWorkspace(accountingRoles, 'reports')).toBe(true);
      expect(canAccessWorkspace(accountingRoles, 'collections')).toBe(true);
      expect(canAccessWorkspace(accountingRoles, 'pos')).toBe(false);
      expect(canAccessWorkspace(accountingRoles, 'billing')).toBe(false);
      expect(canAccessWorkspace(accountingRoles, 'tech')).toBe(false);
      expect(canAccessWorkspace(accountingRoles, 'settings')).toBe(false);

      expect(getDefaultWorkspace(UserRole.ACCOUNTING)).toBe('reports');
    });

    it('permits Administrator across billing, collections, tech, reports, and pos', () => {
      const adminRoles = [UserRole.ADMIN];

      expect(canAccessWorkspace(adminRoles, 'billing')).toBe(true);
      expect(canAccessWorkspace(adminRoles, 'collections')).toBe(true);
      expect(canAccessWorkspace(adminRoles, 'tech')).toBe(true);
      expect(canAccessWorkspace(adminRoles, 'reports')).toBe(true);
      expect(canAccessWorkspace(adminRoles, 'pos')).toBe(true);
      expect(canAccessWorkspace(adminRoles, 'settings')).toBe(true);

      expect(getDefaultWorkspace(UserRole.ADMIN)).toBe('billing');
    });

    it('permits Super Admin unrestricted access to all 6 workspaces', () => {
      const superAdminRoles = [UserRole.SUPER_ADMIN];

      const allWorkspaces = ['pos', 'billing', 'collections', 'tech', 'reports', 'settings'] as const;
      allWorkspaces.forEach((view) => {
        expect(canAccessWorkspace(superAdminRoles, view)).toBe(true);
      });

      expect(getAllowedWorkspaces(superAdminRoles)).toHaveLength(6);
    });

    it('provides human-readable display names for all system roles', () => {
      expect(getRoleDisplayName(UserRole.CASHIER)).toBe('Cashier Counter');
      expect(getRoleDisplayName(UserRole.ADMIN)).toBe('Administrator');
      expect(getRoleDisplayName(UserRole.SUPER_ADMIN)).toBe('Owner / Super Admin');
      expect(getRoleDisplayName(UserRole.COLLECTION_SUPERVISOR)).toBe('Collection Supervisor');
      expect(getRoleDisplayName(UserRole.ACCOUNTING)).toBe('Accounting / Auditor');
      expect(getRoleDisplayName(UserRole.TECHNICIAN)).toBe('Field Technician');
    });
  });

  describe('8. Strict Offline Demo Accounts & Role Isolation', () => {
    it('logs in cashier with strictly Cashier role and without wildcard permissions', async () => {
      const res = await apiClient.login('cashier', 'Cashier123!');
      expect(res.user.roles).toEqual([UserRole.CASHIER]);
      expect(res.user.roles).not.toContain(UserRole.SUPER_ADMIN);
      expect(res.user.permissions).not.toContain('*');
      expect(res.user.permissions).toContain('payment.create');
      expect(res.user.permissions).toContain('receipt.view');
    });

    it('logs in admin, supervisor, tech, and accounting with accurate role mappings', async () => {
      const adminRes = await apiClient.login('admin', 'Admin123!');
      expect(adminRes.user.roles).toContain(UserRole.SUPER_ADMIN);

      const billingAdminRes = await apiClient.login('billing_admin', 'Admin123!');
      expect(billingAdminRes.user.roles).toEqual([UserRole.ADMIN]);

      const techRes = await apiClient.login('tech', 'Tech123!');
      expect(techRes.user.roles).toEqual([UserRole.TECHNICIAN]);

      const collRes = await apiClient.login('collector', 'Coll123!');
      expect(collRes.user.roles).toEqual([UserRole.COLLECTION_SUPERVISOR]);

      const acctRes = await apiClient.login('accounting', 'Acct123!');
      expect(acctRes.user.roles).toEqual([UserRole.ACCOUNTING]);

      const superRes = await apiClient.login('superadmin', 'Super123!');
      expect(superRes.user.roles).toEqual([UserRole.SUPER_ADMIN]);
      expect(superRes.user.permissions).toContain('*');
    });

    it('verifies quick test role account switching maps to accurate permissions and isolates workspaces', async () => {
      const quickTestAccounts: Array<{ role: UserRole; expectedWorkspaces: string[] }> = [
        { role: UserRole.CASHIER, expectedWorkspaces: ['pos'] },
        { role: UserRole.TECHNICIAN, expectedWorkspaces: ['tech'] },
        { role: UserRole.COLLECTION_SUPERVISOR, expectedWorkspaces: ['collections', 'tech'] },
        { role: UserRole.ACCOUNTING, expectedWorkspaces: ['reports', 'collections'] },
        { role: UserRole.ADMIN, expectedWorkspaces: ['pos', 'billing', 'collections', 'tech', 'reports', 'settings'] },
        { role: UserRole.SUPER_ADMIN, expectedWorkspaces: ['pos', 'billing', 'collections', 'tech', 'reports', 'settings'] },
      ];

      for (const account of quickTestAccounts) {
        const allowed = getAllowedWorkspaces(account.role);
        expect(allowed.sort()).toEqual(account.expectedWorkspaces.sort());
      }
    });
  });

  describe('8. Field Service Orders & Dispatch', () => {
    it('creates a service order with valid payload and fallback in offline mode', async () => {
      const orderRes = await apiClient.createServiceOrder({
        serviceAccountId: '11111111-1111-1111-1111-111111111111',
        orderType: 'INSTALLATION',
        priority: 'NORMAL',
        description: 'New fiber installation and optical link provisioning',
        feeCentavos: 150000,
      });
      expect(orderRes.data).toBeDefined();
      expect(orderRes.data.orderType).toBe('INSTALLATION');
      expect(orderRes.data.orderNumber).toMatch(/^SO-\d{6}-\d+/);
    });

    it('retrieves service orders with normalized subscriber and technician names', async () => {
      const ordersRes = await apiClient.listServiceOrders();
      expect(ordersRes.data.length).toBeGreaterThan(0);
      expect(ordersRes.data[0].subscriberName).toBeDefined();
      expect(ordersRes.data[0].orderNumber).toBeDefined();
    });
  });
});

