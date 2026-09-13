import { CollectionBatchStatus } from '@bcis/shared-types';

export interface ReconciliationResult {
  expectedCashCentavos: number;
  remittedCashCentavos: number;
  differenceCentavos: number;
  isBalanced: boolean;
  isShortage: boolean;
  isOverage: boolean;
  recommendedStatus: CollectionBatchStatus;
  statusMessage: string;
}

/**
 * Reconciles a field collector's remittance against expected cash collections.
 * Satisfies Acceptance Tests:
 * - AT-07: Balanced Remittance
 * - AT-08: Collector Shortage Handling
 *
 * @param expectedCashCentavos Sum of all cash receipts recorded in the batch
 * @param remittedCashCentavos Actual physical currency counted by the cashier
 */
export function calculateRemittanceReconciliation(
  expectedCashCentavos: number,
  remittedCashCentavos: number
): ReconciliationResult {
  if (expectedCashCentavos < 0 || remittedCashCentavos < 0) {
    throw new Error('Cash amounts cannot be negative');
  }

  const differenceCentavos = expectedCashCentavos - remittedCashCentavos;
  const isBalanced = differenceCentavos === 0;
  const isShortage = differenceCentavos > 0;
  const isOverage = differenceCentavos < 0;

  let recommendedStatus: CollectionBatchStatus;
  let statusMessage: string;

  if (isBalanced) {
    recommendedStatus = CollectionBatchStatus.RECONCILED;
    statusMessage = 'Batch balanced. Physical cash matches expected collection exactly.';
  } else if (isShortage) {
    recommendedStatus = CollectionBatchStatus.RECONCILED_WITH_SHORTAGE;
    statusMessage = `Cash shortage detected: ₱${(differenceCentavos / 100).toFixed(2)}. Recorded on collector shortage ledger.`;
  } else {
    // Overage: Remitted > Expected
    recommendedStatus = CollectionBatchStatus.RECONCILED;
    statusMessage = `Cash overage detected: ₱${(Math.abs(differenceCentavos) / 100).toFixed(2)}. Transferred to holding account.`;
  }

  return {
    expectedCashCentavos,
    remittedCashCentavos,
    differenceCentavos,
    isBalanced,
    isShortage,
    isOverage,
    recommendedStatus,
    statusMessage,
  };
}
