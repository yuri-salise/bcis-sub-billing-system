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
