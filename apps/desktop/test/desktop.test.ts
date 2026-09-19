import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentMethod, InvoiceStatus, UserRole } from '@bcis/shared-types';
import { formatCurrency, parseCurrencyToCentavos, allocatePaymentFIFO, calculateDaysOverdue, getAgingBucket } from '@bcis/domain';
import { apiClient } from '../src/api/client.js';

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
});

