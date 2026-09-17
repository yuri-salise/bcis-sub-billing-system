import { AgingBucket } from '@bcis/shared-types';

/**
 * Calculates days past due relative to an as-of date (defaulting to current date).
 * Positive number = days overdue.
 * Zero or negative = current / not yet overdue.
 */
export function calculateDaysOverdue(dueDate: string | Date, asOfDate: string | Date = new Date()): number {
  const due = new Date(dueDate);
  const asOf = new Date(asOfDate);

  // Strip hours/minutes to compute purely whole calendar days
  const dueUtc = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const asOfUtc = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());

  const diffMs = asOfUtc - dueUtc;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Determines the Accounts Receivable (AR) aging bucket based on due date.
 */
export function getAgingBucket(dueDate: string | Date, asOfDate: string | Date = new Date()): AgingBucket {
  const daysOverdue = calculateDaysOverdue(dueDate, asOfDate);

  if (daysOverdue <= 0) {
    return AgingBucket.CURRENT;
  }
  if (daysOverdue <= 30) {
    return AgingBucket.DAYS_1_30;
  }
  if (daysOverdue <= 60) {
    return AgingBucket.DAYS_31_60;
  }
  if (daysOverdue <= 90) {
    return AgingBucket.DAYS_61_90;
  }
  return AgingBucket.DAYS_90_PLUS;
}

/**
 * Checks if delinquency age meets the threshold for suspension candidate (60+ days overdue).
 */
export function isSuspensionCandidate(daysOverdue: number): boolean {
  return daysOverdue > 60;
}

export interface AgingBucketSummary {
  currentCentavos: number;
  days1to30Centavos: number;
  days31to60Centavos: number;
  days61to90Centavos: number;
  days90PlusCentavos: number;
  totalOverdueCentavos: number;
  totalReceivableCentavos: number;
}

/**
 * Aggregates a list of open invoices into the 5 standard AR aging buckets.
 */
export function aggregateAgingBuckets(
  invoices: Array<{ dueDate: string | Date; remainingBalanceCentavos: number }>,
  asOfDate: string | Date = new Date()
): AgingBucketSummary {
  let currentCentavos = 0;
  let days1to30Centavos = 0;
  let days31to60Centavos = 0;
  let days61to90Centavos = 0;
  let days90PlusCentavos = 0;

  for (const inv of invoices) {
    if (inv.remainingBalanceCentavos <= 0) continue;
    const bucket = getAgingBucket(inv.dueDate, asOfDate);
    switch (bucket) {
      case AgingBucket.CURRENT:
        currentCentavos += inv.remainingBalanceCentavos;
        break;
      case AgingBucket.DAYS_1_30:
        days1to30Centavos += inv.remainingBalanceCentavos;
        break;
      case AgingBucket.DAYS_31_60:
        days31to60Centavos += inv.remainingBalanceCentavos;
        break;
      case AgingBucket.DAYS_61_90:
        days61to90Centavos += inv.remainingBalanceCentavos;
        break;
      case AgingBucket.DAYS_90_PLUS:
        days90PlusCentavos += inv.remainingBalanceCentavos;
        break;
    }
  }

  const totalOverdueCentavos = days1to30Centavos + days31to60Centavos + days61to90Centavos + days90PlusCentavos;
  const totalReceivableCentavos = currentCentavos + totalOverdueCentavos;

  return {
    currentCentavos,
    days1to30Centavos,
    days31to60Centavos,
    days61to90Centavos,
    days90PlusCentavos,
    totalOverdueCentavos,
    totalReceivableCentavos,
  };
}
