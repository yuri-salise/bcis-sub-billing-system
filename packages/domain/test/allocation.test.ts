import { describe, it, expect } from 'vitest';
import { allocatePaymentFIFO, AllocatableInvoice } from '../src/allocation.js';
import { InvoiceStatus } from '@bcis/shared-types';

describe('Payment Allocation Engine & Acceptance Criteria (AT-01 to AT-04)', () => {
  // Scenario: AT-01 Exact Payment
  it('AT-01 Exact Payment: marks invoice PAID and zeroes remaining balance', () => {
    const invoices: AllocatableInvoice[] = [
      {
        id: 'inv-1',
        invoiceNumber: 'INV-202609-000001',
        dueDate: '2026-09-15T00:00:00.000Z',
        createdAt: '2026-09-01T00:00:00.000Z',
        totalDueCentavos: 99900,
        allocatedCentavos: 0,
        remainingBalanceCentavos: 99900,
      },
    ];

    const result = allocatePaymentFIFO(99900, invoices);

    expect(result.totalAllocatedCentavos).toBe(99900);
    expect(result.advanceCreditCentavos).toBe(0);
    expect(result.allocations).toHaveLength(1);

    const alloc = result.allocations[0];
    expect(alloc.invoiceId).toBe('inv-1');
    expect(alloc.allocatedAmountCentavos).toBe(99900);
    expect(alloc.newRemainingBalanceCentavos).toBe(0);
    expect(alloc.newStatus).toBe(InvoiceStatus.PAID);
  });

  // Scenario: AT-02 Partial Payment
  it('AT-02 Partial Payment: marks invoice PARTIALLY_PAID and computes remaining arrears', () => {
    const invoices: AllocatableInvoice[] = [
      {
        id: 'inv-2',
        invoiceNumber: 'INV-202609-000002',
        dueDate: '2026-09-15T00:00:00.000Z',
        createdAt: '2026-09-01T00:00:00.000Z',
        totalDueCentavos: 99900,
        allocatedCentavos: 0,
        remainingBalanceCentavos: 99900,
      },
    ];

    // Cashier enters ₱500.00 (50000 centavos)
    const result = allocatePaymentFIFO(50000, invoices);

    expect(result.totalAllocatedCentavos).toBe(50000);
    expect(result.advanceCreditCentavos).toBe(0);
    expect(result.allocations).toHaveLength(1);

    const alloc = result.allocations[0];
    expect(alloc.allocatedAmountCentavos).toBe(50000);
    expect(alloc.newRemainingBalanceCentavos).toBe(49900); // ₱499.00 remaining
    expect(alloc.newStatus).toBe(InvoiceStatus.PARTIALLY_PAID);
  });

  // Scenario: AT-03 Advance Payment / Overpayment
  it('AT-03 Advance Payment: satisfies invoice and credits remaining funds to subscriber advance balance', () => {
    const invoices: AllocatableInvoice[] = [
      {
        id: 'inv-3',
        invoiceNumber: 'INV-202609-000003',
        dueDate: '2026-09-15T00:00:00.000Z',
        createdAt: '2026-09-01T00:00:00.000Z',
        totalDueCentavos: 100000, // ₱1,000.00
        allocatedCentavos: 0,
        remainingBalanceCentavos: 100000,
      },
    ];

    // Subscriber pays ₱3,000.00 (300000 centavos)
    const result = allocatePaymentFIFO(300000, invoices);

    expect(result.totalAllocatedCentavos).toBe(100000);
    expect(result.advanceCreditCentavos).toBe(200000); // ₱2,000.00 unallocated advance credit
    expect(result.allocations[0].newStatus).toBe(InvoiceStatus.PAID);
    expect(result.allocations[0].newRemainingBalanceCentavos).toBe(0);
  });

  // Scenario: AT-04 FIFO (Oldest-First) Allocation
  it('AT-04 Oldest-First Allocation: allocates sequentially to oldest unpaid invoice first', () => {
    const invoices: AllocatableInvoice[] = [
      {
        id: 'inv-sep',
        invoiceNumber: 'INV-202609-000025',
        dueDate: '2026-09-15T00:00:00.000Z',
        createdAt: '2026-09-01T00:00:00.000Z',
        totalDueCentavos: 99900,
        allocatedCentavos: 0,
        remainingBalanceCentavos: 99900,
      },
      {
        id: 'inv-aug',
        invoiceNumber: 'INV-202608-000010',
        dueDate: '2026-08-15T00:00:00.000Z',
        createdAt: '2026-08-01T00:00:00.000Z',
        totalDueCentavos: 99900,
        allocatedCentavos: 0,
        remainingBalanceCentavos: 99900,
      },
    ];

    // Payment of ₱1,200.00 (120000 centavos)
    const result = allocatePaymentFIFO(120000, invoices);

    expect(result.totalAllocatedCentavos).toBe(120000);
    expect(result.advanceCreditCentavos).toBe(0);
    expect(result.allocations).toHaveLength(2);

    // Oldest invoice (August) must be allocated first and completely paid
    const augAlloc = result.allocations[0];
    expect(augAlloc.invoiceId).toBe('inv-aug');
    expect(augAlloc.allocatedAmountCentavos).toBe(99900);
    expect(augAlloc.newRemainingBalanceCentavos).toBe(0);
    expect(augAlloc.newStatus).toBe(InvoiceStatus.PAID);

    // September invoice gets remaining 20100 centavos (₱201.00)
    // 99900 - 20100 = 79800 centavos (₱798.00 remaining)
    const sepAlloc = result.allocations[1];
    expect(sepAlloc.invoiceId).toBe('inv-sep');
    expect(sepAlloc.allocatedAmountCentavos).toBe(20100);
    expect(sepAlloc.newRemainingBalanceCentavos).toBe(79800);
    expect(sepAlloc.newStatus).toBe(InvoiceStatus.PARTIALLY_PAID);
  });

  it('strictly skips DRAFT and VOID invoices from receiving payment and reserves funds as advance credit', () => {
    const invoices: AllocatableInvoice[] = [
      {
        id: 'inv-draft',
        invoiceNumber: 'INV-DRAFT-001',
        dueDate: '2026-08-15T00:00:00.000Z',
        createdAt: '2026-08-01T00:00:00.000Z',
        totalDueCentavos: 149950,
        allocatedCentavos: 0,
        remainingBalanceCentavos: 149950,
        status: InvoiceStatus.DRAFT,
      },
      {
        id: 'inv-void',
        invoiceNumber: 'INV-VOID-002',
        dueDate: '2026-08-20T00:00:00.000Z',
        createdAt: '2026-08-05T00:00:00.000Z',
        totalDueCentavos: 50000,
        allocatedCentavos: 0,
        remainingBalanceCentavos: 50000,
        status: InvoiceStatus.VOID,
      },
      {
        id: 'inv-posted',
        invoiceNumber: 'INV-POSTED-003',
        dueDate: '2026-09-15T00:00:00.000Z',
        createdAt: '2026-09-01T00:00:00.000Z',
        totalDueCentavos: 99900,
        allocatedCentavos: 0,
        remainingBalanceCentavos: 99900,
        status: InvoiceStatus.UNPAID,
      },
    ];

    // Pay ₱1,500.00 (150000 centavos)
    const result = allocatePaymentFIFO(150000, invoices);

    // Only inv-posted should be allocated (99900 centavos). DRAFT and VOID are untouched.
    expect(result.totalAllocatedCentavos).toBe(99900);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].invoiceId).toBe('inv-posted');
    expect(result.allocations[0].newStatus).toBe(InvoiceStatus.PAID);

    // Remaining funds 150000 - 99900 = 50100 centavos go to advance credit!
    expect(result.advanceCreditCentavos).toBe(50100);
  });
});
