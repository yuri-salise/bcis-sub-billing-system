import { describe, it, expect } from 'vitest';
import { calculateRemittanceReconciliation } from '../src/reconciliation.js';
import { CollectionBatchStatus } from '@bcis/shared-types';

describe('Collection Remittance Reconciliation Engine (AT-07, AT-08)', () => {
  // Scenario: AT-07 Balanced Remittance
  it('AT-07 Balanced Remittance: reconciles and allows closing when expected matches remitted', () => {
    // ₱20,000 expected (2,000,000 centavos) vs ₱20,000 remitted
    const result = calculateRemittanceReconciliation(2000000, 2000000);

    expect(result.expectedCashCentavos).toBe(2000000);
    expect(result.remittedCashCentavos).toBe(2000000);
    expect(result.differenceCentavos).toBe(0);
    expect(result.isBalanced).toBe(true);
    expect(result.isShortage).toBe(false);
    expect(result.isOverage).toBe(false);
    expect(result.recommendedStatus).toBe(CollectionBatchStatus.RECONCILED);
  });

  // Scenario: AT-08 Collector Shortage
  it('AT-08 Collector Shortage: detects deficit and marks batch RECONCILED_WITH_SHORTAGE', () => {
    // ₱20,000 expected (2,000,000 centavos) vs ₱19,500 remitted (1,950,000 centavos)
    const result = calculateRemittanceReconciliation(2000000, 1950000);

    expect(result.expectedCashCentavos).toBe(2000000);
    expect(result.remittedCashCentavos).toBe(1950000);
    expect(result.differenceCentavos).toBe(50000); // ₱500.00 shortage
    expect(result.isBalanced).toBe(false);
    expect(result.isShortage).toBe(true);
    expect(result.isOverage).toBe(false);
    expect(result.recommendedStatus).toBe(CollectionBatchStatus.RECONCILED_WITH_SHORTAGE);
    expect(result.statusMessage).toContain('shortage detected');
  });

  // Scenario: Collector Overage
  it('detects cash overage when physical cash turned in exceeds expected receipts', () => {
    // ₱20,000 expected vs ₱20,500 remitted
    const result = calculateRemittanceReconciliation(2000000, 2050000);

    expect(result.differenceCentavos).toBe(-50000); // -₱500.00 overage
    expect(result.isBalanced).toBe(false);
    expect(result.isShortage).toBe(false);
    expect(result.isOverage).toBe(true);
  });

  it('rejects negative cash figures', () => {
    expect(() => calculateRemittanceReconciliation(-100, 500)).toThrowError(/cannot be negative/);
  });
});
