import { db } from '../../db/client.js';
import {
  invoices,
  serviceAccounts,
  subscribers,
  subscriberAddresses,
  servicePlans,
  collectionAreas,
  payments,
  receipts,
  users,
  dunningNotices,
} from '../../db/schema.js';
import { eq, and, ne, gte, lte, sql, desc, asc, notInArray, ilike } from 'drizzle-orm';
import {
  calculateDaysOverdue,
  getAgingBucket,
  isSuspensionCandidate,
  aggregateAgingBuckets,
} from '@bcis/domain';
import {
  ArAgingQueryInput,
  DisconnectionCandidatesQueryInput,
  DailyCollectionQueryInput,
  BillingRevenueQueryInput,
} from '@bcis/validation';
import {
  AgingBucket,
  ArAgingReportDto,
  ArAgingSummaryDto,
  ArAgingItemDto,
  DisconnectionCandidateDto,
  DailyCollectionReportDto,
  BillingRevenueReportDto,
  CashierCollectionSummaryDto,
} from '@bcis/shared-types';
import { writeAuditLog } from '../../utils/audit.js';
import { toCsvString } from './reports.csv.js';

export interface ActorInfo {
  id?: string;
  name: string;
  ip?: string;
}

/**
 * 1. ACCOUNTS RECEIVABLE (AR) AGING REPORT
 */
export async function getArAgingReport(
  query: ArAgingQueryInput,
  actor: ActorInfo,
  ip?: string
): Promise<{ data: ArAgingReportDto | string; format: 'json' | 'csv' }> {
  const asOfDateStr = query.asOfDate || new Date().toISOString().split('T')[0];
  const asOfDate = new Date(`${asOfDateStr}T23:59:59.999Z`);

  // Build query to fetch open invoices with remaining balance > 0
  const openInvoices = await db
    .select({
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      dueDate: invoices.dueDate,
      remainingBalanceCentavos: invoices.remainingBalanceCentavos,
      serviceAccountId: serviceAccounts.id,
      serviceAccountNumber: serviceAccounts.serviceAccountNumber,
      subscriberId: subscribers.id,
      subscriberAccountNumber: subscribers.accountNumber,
      subscriberName: sql<string>`${subscribers.firstName} || ' ' || ${subscribers.lastName}`,
      barangay: subscriberAddresses.barangay,
      collectionAreaId: serviceAccounts.collectionAreaId,
      collectionAreaName: collectionAreas.name,
      planName: servicePlans.name,
    })
    .from(invoices)
    .innerJoin(serviceAccounts, eq(invoices.serviceAccountId, serviceAccounts.id))
    .innerJoin(subscribers, eq(serviceAccounts.subscriberId, subscribers.id))
    .leftJoin(subscriberAddresses, eq(serviceAccounts.installationAddressId, subscriberAddresses.id))
    .leftJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
    .leftJoin(collectionAreas, eq(serviceAccounts.collectionAreaId, collectionAreas.id))
    .where(
      and(
        sql`${invoices.remainingBalanceCentavos} > 0`,
        notInArray(invoices.status, ['VOID', 'CREDITED']),
        query.collectionAreaId ? eq(serviceAccounts.collectionAreaId, query.collectionAreaId) : undefined,
        query.barangay ? ilike(subscriberAddresses.barangay, `%${query.barangay}%`) : undefined
      )
    );

  // Global summary counters
  let totalCurrentCentavos = 0;
  let totalDays1to30Centavos = 0;
  let totalDays31to60Centavos = 0;
  let totalDays61to90Centavos = 0;
  let totalDays90PlusCentavos = 0;

  // Grouping containers
  const groupedMap = new Map<string, ArAgingItemDto>();
  const distinctAccountSet = new Set<string>();

  for (const inv of openInvoices) {
    const bal = Number(inv.remainingBalanceCentavos);
    const daysOverdue = calculateDaysOverdue(inv.dueDate, asOfDate);
    const bucket = getAgingBucket(inv.dueDate, asOfDate);

    distinctAccountSet.add(inv.serviceAccountId);

    // Accumulate into overall totals
    switch (bucket) {
      case AgingBucket.CURRENT:
        totalCurrentCentavos += bal;
        break;
      case AgingBucket.DAYS_1_30:
        totalDays1to30Centavos += bal;
        break;
      case AgingBucket.DAYS_31_60:
        totalDays31to60Centavos += bal;
        break;
      case AgingBucket.DAYS_61_90:
        totalDays61to90Centavos += bal;
        break;
      case AgingBucket.DAYS_90_PLUS:
        totalDays90PlusCentavos += bal;
        break;
    }

    // Determine group key based on query.groupBy
    let key: string;
    let baseItem: Partial<ArAgingItemDto>;

    if (query.groupBy === 'service_account') {
      key = inv.serviceAccountId;
      baseItem = {
        serviceAccountId: inv.serviceAccountId,
        serviceAccountNumber: inv.serviceAccountNumber,
        subscriberId: inv.subscriberId,
        accountNumber: inv.subscriberAccountNumber,
        subscriberName: inv.subscriberName,
        planName: inv.planName || undefined,
        barangay: inv.barangay || 'Unassigned',
        collectionAreaId: inv.collectionAreaId,
        collectionAreaName: inv.collectionAreaName,
        oldestDueDate: inv.dueDate,
        daysOverdue: daysOverdue,
      };
    } else if (query.groupBy === 'barangay') {
      key = inv.barangay || 'Unassigned';
      baseItem = {
        barangay: key,
        accountCount: 0,
      };
    } else if (query.groupBy === 'collection_area') {
      key = inv.collectionAreaId || 'Unassigned';
      baseItem = {
        collectionAreaId: inv.collectionAreaId,
        collectionAreaName: inv.collectionAreaName || 'Unassigned Area',
        barangay: inv.barangay || undefined,
        accountCount: 0,
      };
    } else {
      // Default: groupBy 'subscriber'
      key = inv.subscriberId;
      baseItem = {
        subscriberId: inv.subscriberId,
        accountNumber: inv.subscriberAccountNumber,
        subscriberName: inv.subscriberName,
        barangay: inv.barangay || 'Unassigned',
      };
    }

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        ...baseItem,
        currentCentavos: 0,
        days1to30Centavos: 0,
        days31to60Centavos: 0,
        days61to90Centavos: 0,
        days90PlusCentavos: 0,
        totalCentavos: 0,
      } as ArAgingItemDto);
    }

    const item = groupedMap.get(key)!;
    switch (bucket) {
      case AgingBucket.CURRENT:
        item.currentCentavos += bal;
        break;
      case AgingBucket.DAYS_1_30:
        item.days1to30Centavos += bal;
        break;
      case AgingBucket.DAYS_31_60:
        item.days31to60Centavos += bal;
        break;
      case AgingBucket.DAYS_61_90:
        item.days61to90Centavos += bal;
        break;
      case AgingBucket.DAYS_90_PLUS:
        item.days90PlusCentavos += bal;
        break;
    }
    item.totalCentavos += bal;

    // Track oldest due date if grouped by service_account
    if (query.groupBy === 'service_account') {
      if (!item.oldestDueDate || new Date(inv.dueDate) < new Date(item.oldestDueDate)) {
        item.oldestDueDate = inv.dueDate;
        item.daysOverdue = daysOverdue;
      }
    }
  }

  const items = Array.from(groupedMap.values());

  const summary: ArAgingSummaryDto = {
    asOfDate: asOfDateStr,
    currentCentavos: totalCurrentCentavos,
    days1to30Centavos: totalDays1to30Centavos,
    days31to60Centavos: totalDays31to60Centavos,
    days61to90Centavos: totalDays61to90Centavos,
    days90PlusCentavos: totalDays90PlusCentavos,
    totalOverdueCentavos:
      totalDays1to30Centavos + totalDays31to60Centavos + totalDays61to90Centavos + totalDays90PlusCentavos,
    totalReceivableCentavos:
      totalCurrentCentavos +
      totalDays1to30Centavos +
      totalDays31to60Centavos +
      totalDays61to90Centavos +
      totalDays90PlusCentavos,
    accountCount: distinctAccountSet.size,
  };

  // Structured audit log for report generation/export
  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'REPORT_EXPORTED',
    entityType: 'REPORT',
    entityId: 'AR_AGING',
    newValues: {
      format: query.format,
      groupBy: query.groupBy,
      asOfDate: asOfDateStr,
      rowCount: items.length,
      totalReceivableCentavos: summary.totalReceivableCentavos,
    },
    ipAddress: ip,
  });

  if (query.format === 'csv') {
    let headers: string[] = [];
    let rows: (string | number)[][] = [];

    if (query.groupBy === 'service_account') {
      headers = [
        'Service Account',
        'Subscriber Account',
        'Subscriber Name',
        'Plan',
        'Barangay',
        'Days Overdue',
        'Current (PHP)',
        '1-30 Days (PHP)',
        '31-60 Days (PHP)',
        '61-90 Days (PHP)',
        '90+ Days (PHP)',
        'Total Balance (PHP)',
      ];
      rows = items.map((i) => [
        i.serviceAccountNumber || '',
        i.accountNumber || '',
        i.subscriberName || '',
        i.planName || '',
        i.barangay || '',
        i.daysOverdue || 0,
        (i.currentCentavos / 100).toFixed(2),
        (i.days1to30Centavos / 100).toFixed(2),
        (i.days31to60Centavos / 100).toFixed(2),
        (i.days61to90Centavos / 100).toFixed(2),
        (i.days90PlusCentavos / 100).toFixed(2),
        (i.totalCentavos / 100).toFixed(2),
      ]);
    } else if (query.groupBy === 'barangay') {
      headers = [
        'Barangay',
        'Current (PHP)',
        '1-30 Days (PHP)',
        '31-60 Days (PHP)',
        '61-90 Days (PHP)',
        '90+ Days (PHP)',
        'Total Balance (PHP)',
      ];
      rows = items.map((i) => [
        i.barangay || '',
        (i.currentCentavos / 100).toFixed(2),
        (i.days1to30Centavos / 100).toFixed(2),
        (i.days31to60Centavos / 100).toFixed(2),
        (i.days61to90Centavos / 100).toFixed(2),
        (i.days90PlusCentavos / 100).toFixed(2),
        (i.totalCentavos / 100).toFixed(2),
      ]);
    } else if (query.groupBy === 'collection_area') {
      headers = [
        'Collection Area',
        'Current (PHP)',
        '1-30 Days (PHP)',
        '31-60 Days (PHP)',
        '61-90 Days (PHP)',
        '90+ Days (PHP)',
        'Total Balance (PHP)',
      ];
      rows = items.map((i) => [
        i.collectionAreaName || '',
        (i.currentCentavos / 100).toFixed(2),
        (i.days1to30Centavos / 100).toFixed(2),
        (i.days31to60Centavos / 100).toFixed(2),
        (i.days61to90Centavos / 100).toFixed(2),
        (i.days90PlusCentavos / 100).toFixed(2),
        (i.totalCentavos / 100).toFixed(2),
      ]);
    } else {
      // Subscriber
      headers = [
        'Account Number',
        'Subscriber Name',
        'Barangay',
        'Current (PHP)',
        '1-30 Days (PHP)',
        '31-60 Days (PHP)',
        '61-90 Days (PHP)',
        '90+ Days (PHP)',
        'Total Balance (PHP)',
      ];
      rows = items.map((i) => [
        i.accountNumber || '',
        i.subscriberName || '',
        i.barangay || '',
        (i.currentCentavos / 100).toFixed(2),
        (i.days1to30Centavos / 100).toFixed(2),
        (i.days31to60Centavos / 100).toFixed(2),
        (i.days61to90Centavos / 100).toFixed(2),
        (i.days90PlusCentavos / 100).toFixed(2),
        (i.totalCentavos / 100).toFixed(2),
      ]);
    }

    const csvContent = toCsvString(headers, rows);
    return { data: csvContent, format: 'csv' };
  }

  return {
    data: {
      asOfDate: asOfDateStr,
      groupBy: query.groupBy,
      summary,
      items,
    },
    format: 'json',
  };
}

/**
 * 2. DISCONNECTION CANDIDATES LIST
 */
export async function getDisconnectionCandidatesReport(
  query: DisconnectionCandidatesQueryInput,
  actor: ActorInfo,
  ip?: string
): Promise<{ data: { candidates: DisconnectionCandidateDto[]; total: number; page?: number; limit?: number } | string; format: 'json' | 'csv' }> {
  const asOfDate = new Date();
  const thresholdDays = query.thresholdDays || 60;
  const minOverdueCentavos = query.minOverdueCentavos || 0;

  // Query active service accounts with unpaid invoices
  const rawData = await db
    .select({
      invoiceId: invoices.id,
      invoiceDueDate: invoices.dueDate,
      remainingBalanceCentavos: invoices.remainingBalanceCentavos,
      serviceAccountId: serviceAccounts.id,
      serviceAccountNumber: serviceAccounts.serviceAccountNumber,
      serviceAccountStatus: serviceAccounts.status,
      monthlyRateCentavos: serviceAccounts.currentRateCentavos,
      subscriberId: subscribers.id,
      subscriberAccountNumber: subscribers.accountNumber,
      subscriberFirstName: subscribers.firstName,
      subscriberLastName: subscribers.lastName,
      contactNumber: subscribers.contactNumber,
      streetAddress: subscriberAddresses.streetAddress,
      barangay: subscriberAddresses.barangay,
      collectionAreaId: serviceAccounts.collectionAreaId,
      collectionAreaName: collectionAreas.name,
      planName: servicePlans.name,
    })
    .from(serviceAccounts)
    .innerJoin(invoices, eq(serviceAccounts.id, invoices.serviceAccountId))
    .innerJoin(subscribers, eq(serviceAccounts.subscriberId, subscribers.id))
    .leftJoin(subscriberAddresses, eq(serviceAccounts.installationAddressId, subscriberAddresses.id))
    .leftJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
    .leftJoin(collectionAreas, eq(serviceAccounts.collectionAreaId, collectionAreas.id))
    .where(
      and(
        eq(serviceAccounts.status, 'ACTIVE'),
        sql`${invoices.remainingBalanceCentavos} > 0`,
        notInArray(invoices.status, ['VOID', 'CREDITED']),
        query.collectionAreaId ? eq(serviceAccounts.collectionAreaId, query.collectionAreaId) : undefined,
        query.barangay ? ilike(subscriberAddresses.barangay, `%${query.barangay}%`) : undefined
      )
    );

  // Group by service account
  const accountMap = new Map<
    string,
    {
      candidate: DisconnectionCandidateDto;
      oldestDue: string;
      maxDaysOverdue: number;
    }
  >();

  for (const row of rawData) {
    const daysOverdue = calculateDaysOverdue(row.invoiceDueDate, asOfDate);
    const balance = Number(row.remainingBalanceCentavos);

    if (!accountMap.has(row.serviceAccountId)) {
      accountMap.set(row.serviceAccountId, {
        candidate: {
          serviceAccountId: row.serviceAccountId,
          serviceAccountNumber: row.serviceAccountNumber,
          subscriberId: row.subscriberId,
          subscriberAccountNumber: row.subscriberAccountNumber,
          subscriberName: `${row.subscriberFirstName} ${row.subscriberLastName}`.trim(),
          contactNumber: row.contactNumber,
          address: row.streetAddress || '',
          barangay: row.barangay || 'Unassigned',
          collectionAreaId: row.collectionAreaId,
          collectionAreaName: row.collectionAreaName,
          planName: row.planName || 'Unknown Plan',
          monthlyRateCentavos: Number(row.monthlyRateCentavos),
          oldestInvoiceDueDate: row.invoiceDueDate,
          daysOverdue: daysOverdue,
          unpaidInvoiceCount: 0,
          totalOverdueCentavos: 0,
          hasDunningNotice: false,
          latestDunningNoticeStatus: null,
          latestDunningNoticeNumber: null,
        },
        oldestDue: row.invoiceDueDate,
        maxDaysOverdue: daysOverdue,
      });
    }

    const entry = accountMap.get(row.serviceAccountId)!;
    entry.candidate.unpaidInvoiceCount += 1;
    entry.candidate.totalOverdueCentavos += balance;

    if (daysOverdue > entry.maxDaysOverdue) {
      entry.maxDaysOverdue = daysOverdue;
      entry.candidate.daysOverdue = daysOverdue;
      entry.candidate.oldestInvoiceDueDate = row.invoiceDueDate;
      entry.oldestDue = row.invoiceDueDate;
    }
  }

  // Filter accounts exceeding thresholdDays and minOverdueCentavos
  const qualifyingAccounts = Array.from(accountMap.values())
    .filter((e) => e.maxDaysOverdue >= thresholdDays && e.candidate.totalOverdueCentavos >= minOverdueCentavos)
    .map((e) => e.candidate)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  // Fetch latest dunning notice status for these accounts
  if (qualifyingAccounts.length > 0) {
    const accountIds = qualifyingAccounts.map((a) => a.serviceAccountId);
    const notices = await db
      .select({
        serviceAccountId: dunningNotices.serviceAccountId,
        noticeNumber: dunningNotices.noticeNumber,
        status: dunningNotices.status,
        issuedAt: dunningNotices.issuedAt,
      })
      .from(dunningNotices)
      .where(sql`${dunningNotices.serviceAccountId} IN ${accountIds}`)
      .orderBy(desc(dunningNotices.issuedAt));

    const noticeMap = new Map<string, { number: string; status: string }>();
    for (const n of notices) {
      if (!noticeMap.has(n.serviceAccountId)) {
        noticeMap.set(n.serviceAccountId, { number: n.noticeNumber, status: n.status });
      }
    }

    for (const acc of qualifyingAccounts) {
      const notice = noticeMap.get(acc.serviceAccountId);
      if (notice) {
        acc.hasDunningNotice = true;
        acc.latestDunningNoticeNumber = notice.number;
        acc.latestDunningNoticeStatus = notice.status;
      }
    }
  }

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'REPORT_EXPORTED',
    entityType: 'REPORT',
    entityId: 'DISCONNECTION_CANDIDATES',
    newValues: {
      format: query.format,
      thresholdDays,
      minOverdueCentavos,
      totalCandidates: qualifyingAccounts.length,
    },
    ipAddress: ip,
  });

  if (query.format === 'csv') {
    const headers = [
      'Service Account',
      'Subscriber Account',
      'Subscriber Name',
      'Contact Number',
      'Address',
      'Barangay',
      'Collection Area',
      'Plan',
      'Days Overdue',
      'Oldest Due Date',
      'Unpaid Invoices',
      'Total Overdue (PHP)',
      'Dunning Status',
      'Dunning Notice #',
    ];

    const rows = qualifyingAccounts.map((c) => [
      c.serviceAccountNumber,
      c.subscriberAccountNumber,
      c.subscriberName,
      c.contactNumber,
      c.address,
      c.barangay,
      c.collectionAreaName || 'N/A',
      c.planName,
      c.daysOverdue,
      c.oldestInvoiceDueDate,
      c.unpaidInvoiceCount,
      (c.totalOverdueCentavos / 100).toFixed(2),
      c.latestDunningNoticeStatus || 'UNNOTIFIED',
      c.latestDunningNoticeNumber || '',
    ]);

    const csvContent = toCsvString(headers, rows);
    return { data: csvContent, format: 'csv' };
  }

  const page = query.page || 1;
  const limit = query.limit || 50;
  const offset = (page - 1) * limit;
  const paginated = qualifyingAccounts.slice(offset, offset + limit);

  return {
    data: {
      candidates: paginated,
      total: qualifyingAccounts.length,
      page,
      limit,
    },
    format: 'json',
  };
}

/**
 * 3. DAILY COLLECTION SUMMARY REPORT
 */
export async function getDailyCollectionReport(
  query: DailyCollectionQueryInput,
  actor: ActorInfo,
  ip?: string
): Promise<{ data: DailyCollectionReportDto | string; format: 'json' | 'csv' }> {
  let startTimestamp: Date;
  let endTimestamp: Date;

  if (query.startDate && query.endDate) {
    startTimestamp = new Date(`${query.startDate}T00:00:00.000Z`);
    endTimestamp = new Date(`${query.endDate}T23:59:59.999Z`);
  } else {
    const dateStr = query.date || new Date().toISOString().split('T')[0];
    startTimestamp = new Date(`${dateStr}T00:00:00.000Z`);
    endTimestamp = new Date(`${dateStr}T23:59:59.999Z`);
  }

  // Fetch payments in period
  const paymentRows = await db
    .select({
      paymentId: payments.id,
      amountCentavos: payments.amountCentavos,
      paymentMethod: payments.paymentMethod,
      cashierId: payments.cashierId,
      cashierUsername: users.username,
      cashierFullName: users.fullName,
      receiptId: receipts.id,
      receiptNumber: receipts.receiptNumber,
    })
    .from(payments)
    .leftJoin(users, eq(payments.cashierId, users.id))
    .leftJoin(receipts, eq(payments.id, receipts.paymentId))
    .where(
      and(
        gte(payments.paymentDate, startTimestamp),
        lte(payments.paymentDate, endTimestamp),
        eq(payments.isReversed, false),
        query.cashierId ? eq(payments.cashierId, query.cashierId) : undefined
      )
    );

  let totalCollectedCentavos = 0;
  let totalReceiptsCount = 0;
  const byMethod: Record<string, { count: number; totalCentavos: number }> = {
    CASH: { count: 0, totalCentavos: 0 },
    GCASH: { count: 0, totalCentavos: 0 },
    CHECK: { count: 0, totalCentavos: 0 },
    BANK_TRANSFER: { count: 0, totalCentavos: 0 },
  };

  const cashierMap = new Map<string, CashierCollectionSummaryDto>();

  for (const row of paymentRows) {
    const amount = Number(row.amountCentavos);
    totalCollectedCentavos += amount;

    if (row.receiptId) {
      totalReceiptsCount += 1;
    }

    const method = row.paymentMethod || 'CASH';
    if (!byMethod[method]) {
      byMethod[method] = { count: 0, totalCentavos: 0 };
    }
    byMethod[method].count += 1;
    byMethod[method].totalCentavos += amount;

    const cId = row.cashierId || 'unassigned';
    if (!cashierMap.has(cId)) {
      cashierMap.set(cId, {
        cashierId: cId,
        cashierName: row.cashierFullName || 'System / Auto',
        cashierUsername: row.cashierUsername || 'system',
        totalReceipts: 0,
        cashCentavos: 0,
        gcashCentavos: 0,
        checkCentavos: 0,
        bankTransferCentavos: 0,
        totalCentavos: 0,
      });
    }

    const cEntry = cashierMap.get(cId)!;
    if (row.receiptId) {
      cEntry.totalReceipts += 1;
    }
    cEntry.totalCentavos += amount;

    if (method === 'CASH') cEntry.cashCentavos += amount;
    else if (method === 'GCASH') cEntry.gcashCentavos += amount;
    else if (method === 'CHECK') cEntry.checkCentavos += amount;
    else if (method === 'BANK_TRANSFER') cEntry.bankTransferCentavos += amount;
  }

  const byCashier = Array.from(cashierMap.values());

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'REPORT_EXPORTED',
    entityType: 'REPORT',
    entityId: 'DAILY_COLLECTION',
    newValues: {
      format: query.format,
      startDate: startTimestamp.toISOString(),
      endDate: endTimestamp.toISOString(),
      totalPayments: paymentRows.length,
      totalCollectedCentavos,
    },
    ipAddress: ip,
  });

  if (query.format === 'csv') {
    const headers = [
      'Cashier Username',
      'Cashier Name',
      'Receipts Issued',
      'Cash (PHP)',
      'GCash (PHP)',
      'Check (PHP)',
      'Bank Transfer (PHP)',
      'Total Collected (PHP)',
    ];

    const rows = byCashier.map((c) => [
      c.cashierUsername,
      c.cashierName,
      c.totalReceipts,
      (c.cashCentavos / 100).toFixed(2),
      (c.gcashCentavos / 100).toFixed(2),
      (c.checkCentavos / 100).toFixed(2),
      (c.bankTransferCentavos / 100).toFixed(2),
      (c.totalCentavos / 100).toFixed(2),
    ]);

    // Add summary row
    rows.push([
      'TOTAL',
      'ALL CASHIERS',
      totalReceiptsCount,
      (byMethod.CASH.totalCentavos / 100).toFixed(2),
      (byMethod.GCASH.totalCentavos / 100).toFixed(2),
      (byMethod.CHECK.totalCentavos / 100).toFixed(2),
      (byMethod.BANK_TRANSFER.totalCentavos / 100).toFixed(2),
      (totalCollectedCentavos / 100).toFixed(2),
    ]);

    const csvContent = toCsvString(headers, rows);
    return { data: csvContent, format: 'csv' };
  }

  return {
    data: {
      reportDate: query.date || new Date().toISOString().split('T')[0],
      startDate: query.startDate,
      endDate: query.endDate,
      totalPayments: paymentRows.length,
      totalReceipts: totalReceiptsCount,
      totalCollectedCentavos,
      byMethod,
      byCashier,
    },
    format: 'json',
  };
}

/**
 * 4. BILLING & REVENUE SUMMARY REPORT
 */
export async function getBillingRevenueReport(
  query: BillingRevenueQueryInput,
  actor: ActorInfo,
  ip?: string
): Promise<{ data: BillingRevenueReportDto | string; format: 'json' | 'csv' }> {
  // Default to current month if dates not provided
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const defaultStart = new Date(Date.UTC(year, month, 1)).toISOString().split('T')[0];
  const defaultEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().split('T')[0];

  const startDateStr = query.startDate || defaultStart;
  const endDateStr = query.endDate || defaultEnd;

  // 1. Fetch invoices generated within date range
  const invoicesInPeriod = await db
    .select({
      id: invoices.id,
      totalDueCentavos: invoices.totalDueCentavos,
      vatCentavos: invoices.vatCentavos,
      subtotalCentavos: invoices.subtotalCentavos,
      remainingBalanceCentavos: invoices.remainingBalanceCentavos,
      status: invoices.status,
    })
    .from(invoices)
    .where(
      and(
        gte(invoices.issueDate, startDateStr),
        lte(invoices.issueDate, endDateStr),
        ne(invoices.status, 'VOID')
      )
    );

  let totalCentavosBilled = 0;
  let totalVatCentavos = 0;
  let totalSubtotalCentavos = 0;
  let periodOutstandingCentavos = 0;

  const statusMap = new Map<string, { count: number; totalCentavos: number }>();

  for (const inv of invoicesInPeriod) {
    const total = Number(inv.totalDueCentavos);
    const vat = Number(inv.vatCentavos || 0);
    const sub = Number(inv.subtotalCentavos || total);
    const remaining = Number(inv.remainingBalanceCentavos);

    totalCentavosBilled += total;
    totalVatCentavos += vat;
    totalSubtotalCentavos += sub;
    periodOutstandingCentavos += remaining;

    const st = inv.status;
    if (!statusMap.has(st)) {
      statusMap.set(st, { count: 0, totalCentavos: 0 });
    }
    const entry = statusMap.get(st)!;
    entry.count += 1;
    entry.totalCentavos += total;
  }

  // 2. Fetch payments received within date range
  const startTs = new Date(`${startDateStr}T00:00:00.000Z`);
  const endTs = new Date(`${endDateStr}T23:59:59.999Z`);

  const paymentRows = await db
    .select({
      id: payments.id,
      amountCentavos: payments.amountCentavos,
    })
    .from(payments)
    .where(
      and(
        gte(payments.paymentDate, startTs),
        lte(payments.paymentDate, endTs),
        eq(payments.isReversed, false)
      )
    );

  let totalCentavosCollected = 0;
  for (const p of paymentRows) {
    totalCentavosCollected += Number(p.amountCentavos);
  }

  // 3. System-wide overall balance outstanding
  const [overallResult] = await db
    .select({
      totalOutstanding: sql<string>`COALESCE(SUM(${invoices.remainingBalanceCentavos}), 0)`,
    })
    .from(invoices)
    .where(
      and(
        sql`${invoices.remainingBalanceCentavos} > 0`,
        notInArray(invoices.status, ['VOID', 'CREDITED'])
      )
    );

  const overallBalanceOutstandingCentavos = Number(overallResult?.totalOutstanding || 0);

  const collectionEfficiencyPercent =
    totalCentavosBilled > 0
      ? Math.round((totalCentavosCollected / totalCentavosBilled) * 10000) / 100
      : 0;

  const statusBreakdown = Array.from(statusMap.entries()).map(([status, val]) => ({
    status,
    count: val.count,
    totalCentavos: val.totalCentavos,
  }));

  await writeAuditLog({
    actorId: actor.id,
    actorName: actor.name,
    action: 'REPORT_EXPORTED',
    entityType: 'REPORT',
    entityId: 'BILLING_REVENUE',
    newValues: {
      format: query.format,
      startDate: startDateStr,
      endDate: endDateStr,
      totalInvoicesGenerated: invoicesInPeriod.length,
      totalCentavosBilled,
      totalCentavosCollected,
      overallBalanceOutstandingCentavos,
    },
    ipAddress: ip,
  });

  if (query.format === 'csv') {
    const headers = ['Metric', 'Value'];
    const rows = [
      ['Start Date', startDateStr],
      ['End Date', endDateStr],
      ['Total Invoices Generated', invoicesInPeriod.length],
      ['Total Billed (PHP)', (totalCentavosBilled / 100).toFixed(2)],
      ['Total Subtotal (PHP)', (totalSubtotalCentavos / 100).toFixed(2)],
      ['Total VAT (PHP)', (totalVatCentavos / 100).toFixed(2)],
      ['Period Invoices Outstanding (PHP)', (periodOutstandingCentavos / 100).toFixed(2)],
      ['Total Payments Count', paymentRows.length],
      ['Total Collected (PHP)', (totalCentavosCollected / 100).toFixed(2)],
      ['Collection Efficiency (%)', `${collectionEfficiencyPercent}%`],
      ['System Overall AR Outstanding (PHP)', (overallBalanceOutstandingCentavos / 100).toFixed(2)],
    ];

    const csvContent = toCsvString(headers, rows);
    return { data: csvContent, format: 'csv' };
  }

  return {
    data: {
      startDate: startDateStr,
      endDate: endDateStr,
      totalInvoicesGenerated: invoicesInPeriod.length,
      totalCentavosBilled,
      totalVatCentavos,
      totalSubtotalCentavos,
      periodOutstandingCentavos,
      totalPaymentsCollected: paymentRows.length,
      totalCentavosCollected,
      overallBalanceOutstandingCentavos,
      collectionEfficiencyPercent,
      statusBreakdown,
    },
    format: 'json',
  };
}
