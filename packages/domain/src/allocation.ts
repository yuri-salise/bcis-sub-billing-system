import { InvoiceStatus } from '@bcis/shared-types';

export interface AllocatableInvoice {
  id: string;
  invoiceNumber: string;
  dueDate: string; // ISO string
  createdAt: string;
  totalDueCentavos: number;
  allocatedCentavos: number;
  remainingBalanceCentavos: number;
  status?: InvoiceStatus | string;
}

export interface InvoiceAllocationResult {
  invoiceId: string;
  invoiceNumber: string;
  previousBalanceCentavos: number;
  allocatedAmountCentavos: number;
  newRemainingBalanceCentavos: number;
  newStatus: InvoiceStatus;
}

export interface PaymentAllocationPlan {
  totalPaymentCentavos: number;
  totalAllocatedCentavos: number;
  advanceCreditCentavos: number;
  allocations: InvoiceAllocationResult[];
}

/**
 * Allocates a payment across outstanding invoices following the FIFO (Oldest-First) rule.
 * Satisfies Acceptance Tests:
 * - AT-01: Exact Payment
 * - AT-02: Partial Payment
 * - AT-03: Advance Payment
 * - AT-04: FIFO Allocation
 *
 * @param paymentAmountCentavos Amount paid in integer centavos
 * @param invoices List of unpaid/partially paid invoices for the subscriber
 */
export function allocatePaymentFIFO(
  paymentAmountCentavos: number,
  invoices: AllocatableInvoice[]
): PaymentAllocationPlan {
  if (paymentAmountCentavos <= 0) {
    throw new Error('Payment amount must be greater than zero centavos');
  }

  // Sort invoices strictly by Due Date ASC, then CreatedAt ASC (Oldest unpaid first)
  const sorted = [...invoices].sort((a, b) => {
    const dueComp = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    if (dueComp !== 0) return dueComp;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  let unallocated = paymentAmountCentavos;
  const allocations: InvoiceAllocationResult[] = [];
  let totalAllocated = 0;

  for (const inv of sorted) {
    if (unallocated <= 0) break;

    // Invoices in DRAFT or VOID status cannot receive payments (unposted or invalidated)
    if (
      inv.status === InvoiceStatus.DRAFT ||
      (inv.status as string) === 'DRAFT' ||
      inv.status === InvoiceStatus.VOID ||
      (inv.status as string) === 'VOID'
    ) {
      continue;
    }

    const remainingToPay = inv.remainingBalanceCentavos;
    if (remainingToPay <= 0) continue;

    const allocationAmount = Math.min(unallocated, remainingToPay);
    const newRemaining = remainingToPay - allocationAmount;

    let newStatus: InvoiceStatus;
    if (newRemaining === 0) {
      newStatus = InvoiceStatus.PAID;
    } else {
      newStatus = InvoiceStatus.PARTIALLY_PAID;
    }

    allocations.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      previousBalanceCentavos: remainingToPay,
      allocatedAmountCentavos: allocationAmount,
      newRemainingBalanceCentavos: newRemaining,
      newStatus,
    });

    unallocated -= allocationAmount;
    totalAllocated += allocationAmount;
  }

  // Any leftover funds after all outstanding invoices are cleared are credited to advance balance
  const advanceCreditCentavos = unallocated;

  return {
    totalPaymentCentavos: paymentAmountCentavos,
    totalAllocatedCentavos: totalAllocated,
    advanceCreditCentavos,
    allocations,
  };
}
