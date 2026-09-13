import { describe, it, expect } from 'vitest';
import { calculateDaysOverdue, getAgingBucket, isSuspensionCandidate } from '../src/aging.js';
import { AgingBucket } from '@bcis/shared-types';

describe('Accounts Receivable (AR) Aging Engine', () => {
  const asOf = new Date('2026-09-14T00:00:00.000Z');

  it('categorizes invoices with future due dates as CURRENT', () => {
    const futureDue = '2026-09-20T00:00:00.000Z';
    expect(calculateDaysOverdue(futureDue, asOf)).toBeLessThan(0);
    expect(getAgingBucket(futureDue, asOf)).toBe(AgingBucket.CURRENT);
  });

  it('categorizes invoices overdue by 1-30 days as DAYS_1_30', () => {
    const due10DaysAgo = '2026-09-04T00:00:00.000Z';
    expect(calculateDaysOverdue(due10DaysAgo, asOf)).toBe(10);
    expect(getAgingBucket(due10DaysAgo, asOf)).toBe(AgingBucket.DAYS_1_30);
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
});
