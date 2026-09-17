import { describe, it, expect } from 'vitest';
import { calculateDaysOverdue, getAgingBucket, isSuspensionCandidate, aggregateAgingBuckets } from '../src/aging.js';
import { AgingBucket } from '@bcis/shared-types';

describe('Accounts Receivable (AR) Aging Engine', () => {
  const asOf = new Date('2026-09-14T00:00:00.000Z');

  it('categorizes invoices with future due dates as CURRENT', () => {
    const futureDue = '2026-09-20T00:00:00.000Z';
    expect(calculateDaysOverdue(futureDue, asOf)).toBeLessThan(0);
    expect(getAgingBucket(futureDue, asOf)).toBe(AgingBucket.CURRENT);
  });

  it('categorizes invoices overdue by 1-30 days as DAYS_1_30', () => {
    const due100DaysAgo = '2026-09-04T00:00:00.000Z';
    expect(calculateDaysOverdue(due100DaysAgo, asOf)).toBe(10);
    expect(getAgingBucket(due100DaysAgo, asOf)).toBe(AgingBucket.DAYS_1_30);
  });

  it('categorizes invoices overdue by 31-60 days as DAYS_31_60', () => {
    const due45DaysAgo = '2026-07-31T00:00:00.000Z';
    expect(calculateDaysOverdue(due45DaysAgo, asOf)).toBe(45);
    expect(getAgingBucket(due45DaysAgo, asOf)).toBe(AgingBucket.DAYS_31_60);
  });

  it('categorizes invoices overdue by 61-90 days as DAYS_61_90', () => {
    const due75DaysAgo = '2026-07-01T00:00:00.000Z';
    expect(calculateDaysOverdue(due75DaysAgo, asOf)).toBe(75);
    expect(getAgingBucket(due75DaysAgo, asOf)).toBe(AgingBucket.DAYS_61_90);
  });

  it('categorizes invoices overdue by more than 90 days as DAYS_90_PLUS', () => {
    const due100DaysAgo = '2026-06-06T00:00:00.000Z';
    expect(calculateDaysOverdue(due100DaysAgo, asOf)).toBe(100);
    expect(getAgingBucket(due100DaysAgo, asOf)).toBe(AgingBucket.DAYS_90_PLUS);
  });

  it('identifies accounts exceeding 60 days overdue as suspension candidates', () => {
    expect(isSuspensionCandidate(30)).toBe(false);
    expect(isSuspensionCandidate(60)).toBe(false);
    expect(isSuspensionCandidate(61)).toBe(true);
    expect(isSuspensionCandidate(90)).toBe(true);
  });

  it('correctly aggregates invoices into the 5 standard AR aging buckets', () => {
    const sampleInvoices = [
      { dueDate: '2026-09-20', remainingBalanceCentavos: 100000 }, // CURRENT
      { dueDate: '2026-09-04', remainingBalanceCentavos: 50000 },  // 1-30
      { dueDate: '2026-07-31', remainingBalanceCentavos: 75000 },  // 31-60
      { dueDate: '2026-07-01', remainingBalanceCentavos: 60000 },  // 61-90
      { dueDate: '2026-05-15', remainingBalanceCentavos: 120000 }, // 90+
      { dueDate: '2026-09-01', remainingBalanceCentavos: 0 },      // Paid invoice (should be ignored)
    ];

    const result = aggregateAgingBuckets(sampleInvoices, asOf);

    expect(result.currentCentavos).toBe(100000);
    expect(result.days1to30Centavos).toBe(50000);
    expect(result.days31to60Centavos).toBe(75000);
    expect(result.days61to90Centavos).toBe(60000);
    expect(result.days90PlusCentavos).toBe(120000);
    expect(result.totalOverdueCentavos).toBe(305000);
    expect(result.totalReceivableCentavos).toBe(405000);
  });
});
