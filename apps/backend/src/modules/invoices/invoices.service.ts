import { eq, and, or, ilike, gte, lte, desc, count, sql, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  invoices,
  invoiceItems,
  serviceAccounts,
  subscribers,
  servicePlans,
  subscriberLedger,
  paymentAllocations,
  payments,
} from '../../db/schema.js';
import { writeAuditLog } from '../../utils/audit.js';
import { calculateActivationProration } from '@bcis/domain';
import {
  GenerateInvoiceInput,
  InvoiceQueryInput,
  InvoiceLineItemInput,
} from '@bcis/validation';

/**
 * Extracts YYYYMM string from a date or date string in a timezone-independent manner.
 */
export function extractYearMonth(periodStartStr?: string): string {
  if (periodStartStr) {
    const clean = periodStartStr.split('T')[0].trim();
    const parts = clean.split('-');
    if (parts.length >= 2 && parts[0].length === 4 && parts[1].length === 2) {
      return `${parts[0]}${parts[1]}`;
    }
  }
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}

/**
 * Generates the next sequential invoice number in the format INV-YYYYMM-XXXX.
 * Employs PostgreSQL transaction-scoped advisory locking to ensure strict monotonicity and zero collision under concurrency.
 */
export async function generateInvoiceNumber(
  periodStartStr?: string,
  offset = 1,
  tx: any = db
): Promise<string> {
  const yearMonth = extractYearMonth(periodStartStr);
  const prefix = `INV-${yearMonth}-`;

  // Transaction-scoped advisory lock for sequential numbering
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${'invoice_numbering_' + yearMonth}))`
  );

  const existing = await tx
    .select({ invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(ilike(invoices.invoiceNumber, `${prefix}%`));

  let maxSeq = 0;
  for (const row of existing) {
    const part = row.invoiceNumber.slice(prefix.length);
    const num = parseInt(part, 10);
    if (!isNaN(num) && num > maxSeq) {
      maxSeq = num;
    }
  }

  const nextSeq = String(maxSeq + offset).padStart(4, '0');
  return `${prefix}${nextSeq}`;
}

/**
 * Calculates due date (defaults to 15 days after issue date if not explicitly provided)
 */
function resolveDueDate(issueDateStr?: string, explicitDueDate?: string): string {
  if (explicitDueDate) return explicitDueDate;
  const baseDate = issueDateStr ? new Date(issueDateStr) : new Date();
  const due = new Date(baseDate.getTime() + 15 * 24 * 60 * 60 * 1000);
  return due.toISOString().split('T')[0];
}

/**
 * Calculates net subscriber running ledger balance using exact double-entry summation.
 * Completely immune to simultaneous timestamp ordering ambiguities.
 */
async function getSubscriberCurrentLedgerBalance(
  subscriberId: string,
  tx: any
): Promise<number> {
  const [result] = await tx
    .select({
      totalDebit: sql<number>`COALESCE(SUM(${subscriberLedger.debitCentavos}), 0)::bigint`,
      totalCredit: sql<number>`COALESCE(SUM(${subscriberLedger.creditCentavos}), 0)::bigint`,
    })
    .from(subscriberLedger)
    .where(eq(subscriberLedger.subscriberId, subscriberId));

  const debit = Number(result?.totalDebit ?? 0);
  const credit = Number(result?.totalCredit ?? 0);
  return debit - credit;
}

/**
 * Generates an invoice for a single service account.
 * Supports proration, advance credit consumption, ledger debit, and duplicate detection.
 */
export async function generateSingleInvoice(
  input: GenerateInvoiceInput & { serviceAccountId: string },
  actor: { id?: string; name: string },
  ip?: string
) {
  return await db.transaction(async (tx) => {
    // 0. Transaction-scoped advisory lock on this service account and period to eliminate race conditions
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'sa_billing_' + input.serviceAccountId + '_' + input.billingPeriodStart + '_' + input.billingPeriodEnd}))`
    );

    // 1. Fetch service account, plan, and subscriber
    const [accountData] = await tx
      .select({
        account: serviceAccounts,
        subscriber: subscribers,
        plan: servicePlans,
      })
      .from(serviceAccounts)
      .innerJoin(subscribers, eq(serviceAccounts.subscriberId, subscribers.id))
      .innerJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
      .where(eq(serviceAccounts.id, input.serviceAccountId))
      .limit(1);

    if (!accountData) {
      const err = new Error(
        `Service account with ID '${input.serviceAccountId}' was not found`
      ) as Error & { statusCode: number; code: string };
      err.statusCode = 404;
      err.code = 'SERVICE_ACCOUNT_NOT_FOUND';
      throw err;
    }

    const { account, subscriber, plan } = accountData;

    if (account.status !== 'ACTIVE') {
      const err = new Error(
        `Cannot generate invoice for service account '${account.serviceAccountNumber}' with status '${account.status}'. Invoices can only be generated for ACTIVE service accounts.`
      ) as Error & { statusCode: number; code: string };
      err.statusCode = 400;
      err.code = 'ACCOUNT_NOT_ACTIVE';
      throw err;
    }

    if (subscriber.status === 'TERMINATED' || subscriber.status === 'ARCHIVED' || subscriber.status === 'INACTIVE') {
      const err = new Error(
        `Cannot generate invoice for subscriber '${subscriber.accountNumber}' with status '${subscriber.status}'`
      ) as Error & { statusCode: number; code: string };
      err.statusCode = 400;
      err.code = 'SUBSCRIBER_NOT_ACTIVE';
      throw err;
    }

    if (account.activationDate && account.activationDate > input.billingPeriodEnd) {
      const err = new Error(
        `Service account '${account.serviceAccountNumber}' was not yet activated in period ${input.billingPeriodStart} to ${input.billingPeriodEnd} (activation date: ${account.activationDate})`
      ) as Error & { statusCode: number; code: string };
      err.statusCode = 400;
      err.code = 'ACCOUNT_NOT_ACTIVATED_IN_PERIOD';
      throw err;
    }

    // 2. Enforce duplicate billing prevention constraint (AT-11)
    const [existingInvoice] = await tx
      .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(
        and(
          eq(invoices.serviceAccountId, account.id),
          eq(invoices.billingPeriodStart, input.billingPeriodStart),
          eq(invoices.billingPeriodEnd, input.billingPeriodEnd)
        )
      )
      .limit(1);

    if (existingInvoice) {
      const err = new Error(
        `Invoice '${existingInvoice.invoiceNumber}' already exists for service account '${account.serviceAccountNumber}' for period ${input.billingPeriodStart} to ${input.billingPeriodEnd}`
      ) as Error & { statusCode: number; code: string };
      err.statusCode = 409;
      err.code = 'DUPLICATE_BILLING_PERIOD';
      throw err;
    }

    // 3. Compute Plan Fee and Proration
    let planFeeCentavos = account.currentRateCentavos;
    let planFeeDescription = `${plan.name} - Monthly Subscription`;

    if (account.activationDate) {
      const prorationResult = calculateActivationProration(
        account.currentRateCentavos,
        input.billingPeriodStart,
        input.billingPeriodEnd,
        account.activationDate
      );

      if (prorationResult.isProrated) {
        planFeeCentavos = prorationResult.proratedAmountCentavos;
        planFeeDescription = `${plan.name} (Prorated ${prorationResult.activeDays}/${prorationResult.totalDays} days)`;
      }
    }

    // 4. Assemble Line Items
    const lineItemsToInsert: Array<{
      itemType: string;
      description: string;
      amountCentavos: number;
      quantity: number;
    }> = [
      {
        itemType: 'PLAN_FEE',
        description: planFeeDescription,
        amountCentavos: planFeeCentavos,
        quantity: 1,
      },
    ];

    if (input.customLineItems && input.customLineItems.length > 0) {
      for (const item of input.customLineItems) {
        lineItemsToInsert.push({
          itemType: item.itemType,
          description: item.description,
          amountCentavos: Math.abs(item.amountCentavos),
          quantity: item.quantity ?? 1,
        });
      }
    }

    // 5. Calculate Subtotal, Discounts, and Total Due
    let subtotalCentavos = 0;
    let discountCentavos = 0;

    for (const item of lineItemsToInsert) {
      const totalItemAmount = item.amountCentavos * item.quantity;
      if (item.itemType === 'DISCOUNT') {
        discountCentavos += totalItemAmount;
      } else {
        subtotalCentavos += totalItemAmount;
      }
    }

    const totalDueCentavos = Math.max(0, subtotalCentavos - discountCentavos);
    const vatCentavos = 0;

    // 6. Automatic Advance Credit Deduction
    let advanceCreditAppliedCentavos = 0;
    let remainingBalanceCentavos = totalDueCentavos;
    let invoiceStatus = 'UNPAID';

    if (input.applyAdvanceCredit !== false && subscriber.advanceCreditCentavos > 0) {
      const availableCredit = subscriber.advanceCreditCentavos;
      advanceCreditAppliedCentavos = Math.min(availableCredit, totalDueCentavos);
      remainingBalanceCentavos = totalDueCentavos - advanceCreditAppliedCentavos;

      const newSubscriberCredit = availableCredit - advanceCreditAppliedCentavos;

      // Update subscriber advance credit in this transaction
      await tx
        .update(subscribers)
        .set({
          advanceCreditCentavos: newSubscriberCredit,
          updatedAt: new Date(),
        })
        .where(eq(subscribers.id, subscriber.id));

      if (remainingBalanceCentavos === 0) {
        invoiceStatus = 'PAID';
      } else if (advanceCreditAppliedCentavos > 0) {
        invoiceStatus = 'PARTIALLY_PAID';
      }
    } else if (totalDueCentavos === 0) {
      invoiceStatus = 'PAID';
    }

    // 7. Generate Sequential Invoice Number & Dates
    const invoiceNumber = await generateInvoiceNumber(input.billingPeriodStart, 1, tx);
    const issueDate = input.issueDate || new Date().toISOString().split('T')[0];
    const dueDate = resolveDueDate(issueDate, input.dueDate);

    // 8. Insert Invoice Record
    const [insertedInvoice] = await tx
      .insert(invoices)
      .values({
        invoiceNumber,
        serviceAccountId: account.id,
        subscriberId: subscriber.id,
        billingPeriodStart: input.billingPeriodStart,
        billingPeriodEnd: input.billingPeriodEnd,
        issueDate,
        dueDate,
        subtotalCentavos,
        vatCentavos,
        totalDueCentavos,
        allocatedCentavos: advanceCreditAppliedCentavos,
        remainingBalanceCentavos,
        status: invoiceStatus,
        notes: input.notes ?? null,
      })
      .returning();

    // 9. Insert Line Items
    const createdItems = [];
    for (const item of lineItemsToInsert) {
      const [insertedItem] = await tx
        .insert(invoiceItems)
        .values({
          invoiceId: insertedInvoice.id,
          itemType: item.itemType,
          description: item.description,
          amountCentavos: item.amountCentavos,
          quantity: item.quantity,
        })
        .returning();
      createdItems.push(insertedItem);
    }

    // 10. Update Subscriber Running Ledger (Ledger Debit & Advance Credit Application)
    let currentBalance = await getSubscriberCurrentLedgerBalance(subscriber.id, tx);

    // Record invoice charge as debit
    currentBalance += totalDueCentavos;
    await tx.insert(subscriberLedger).values({
      subscriberId: subscriber.id,
      entryType: 'INVOICE',
      referenceId: insertedInvoice.invoiceNumber,
      description: `Monthly Billing Invoice ${insertedInvoice.invoiceNumber}`,
      debitCentavos: totalDueCentavos,
      creditCentavos: 0,
      balanceAfterCentavos: currentBalance,
    });

    // If advance credit was applied, record credit deduction
    if (advanceCreditAppliedCentavos > 0) {
      currentBalance -= advanceCreditAppliedCentavos;
      await tx.insert(subscriberLedger).values({
        subscriberId: subscriber.id,
        entryType: 'ADVANCE_CREDIT',
        referenceId: insertedInvoice.invoiceNumber,
        description: `Advance Credit Applied to Invoice ${insertedInvoice.invoiceNumber}`,
        debitCentavos: 0,
        creditCentavos: advanceCreditAppliedCentavos,
        balanceAfterCentavos: currentBalance,
      });
    }

    // 11. Audit Log Entry
    await writeAuditLog(
      {
        actorId: actor.id,
        actorName: actor.name,
        action: 'INVOICE_GENERATED',
        entityType: 'INVOICE',
        entityId: insertedInvoice.id,
        newValues: {
          invoiceNumber: insertedInvoice.invoiceNumber,
          serviceAccountId: account.id,
          subscriberId: subscriber.id,
          totalDueCentavos,
          allocatedCentavos: advanceCreditAppliedCentavos,
          remainingBalanceCentavos,
          status: invoiceStatus,
        },
        ipAddress: ip,
      },
      tx
    );

    return {
      ...insertedInvoice,
      subscriber: {
        id: subscriber.id,
        accountNumber: subscriber.accountNumber,
        firstName: subscriber.firstName,
        lastName: subscriber.lastName,
        businessName: subscriber.businessName,
      },
      serviceAccount: {
        id: account.id,
        serviceAccountNumber: account.serviceAccountNumber,
        status: account.status,
        planName: plan.name,
      },
      lineItems: createdItems,
      items: createdItems,
    };
  });
}

/**
 * Bulk batch generation for active service accounts.
 * Skips already billed accounts and applies proration & advance credits where appropriate.
 */
export async function generateBatchInvoices(
  input: GenerateInvoiceInput,
  actor: { id?: string; name: string },
  ip?: string
) {
  return await db.transaction(async (tx) => {
    // 0. Acquire transaction-scoped advisory locks for batch generation & numbering
    const yearMonth = extractYearMonth(input.billingPeriodStart);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'batch_billing_' + input.billingPeriodStart + '_' + input.billingPeriodEnd}))`
    );
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'invoice_numbering_' + yearMonth}))`
    );

    // 1. Fetch all ACTIVE service accounts whose subscriber is also ACTIVE
    const activeAccounts = await tx
      .select({
        account: serviceAccounts,
        subscriber: subscribers,
        plan: servicePlans,
      })
      .from(serviceAccounts)
      .innerJoin(subscribers, eq(serviceAccounts.subscriberId, subscribers.id))
      .innerJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
      .where(
        and(
          eq(serviceAccounts.status, 'ACTIVE'),
          eq(subscribers.status, 'ACTIVE')
        )
      )
      .orderBy(serviceAccounts.serviceAccountNumber);

    const totalProcessed = activeAccounts.length;
    if (totalProcessed === 0) {
      return {
        totalProcessed: 0,
        generatedCount: 0,
        skippedCount: 0,
        invoices: [],
        skippedAccounts: [],
      };
    }

    // 2. Query accounts already billed for this period (Duplicate Billing Prevention AT-11)
    const existingInvoices = await tx
      .select({
        serviceAccountId: invoices.serviceAccountId,
        invoiceNumber: invoices.invoiceNumber,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.billingPeriodStart, input.billingPeriodStart),
          eq(invoices.billingPeriodEnd, input.billingPeriodEnd)
        )
      );

    const billedAccountIds = new Set(existingInvoices.map((inv) => inv.serviceAccountId));

    const generatedInvoices = [];
    const skippedAccounts = [];

    // Query starting sequence for this period to maintain contiguous sequential numbers
    const prefix = `INV-${yearMonth}-`;

    const allInPeriod = await tx
      .select({ invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .where(ilike(invoices.invoiceNumber, `${prefix}%`));

    let maxSeq = 0;
    for (const row of allInPeriod) {
      const part = row.invoiceNumber.slice(prefix.length);
      const num = parseInt(part, 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }

    const issueDate = input.issueDate || new Date().toISOString().split('T')[0];
    const dueDate = resolveDueDate(issueDate, input.dueDate);

    // Track subscriber advance credits in-memory during batch to properly decrement multi-account credits
    const subscriberCreditMap = new Map<string, number>();

    for (const item of activeAccounts) {
      const { account, subscriber, plan } = item;

      if (billedAccountIds.has(account.id)) {
        skippedAccounts.push({
          serviceAccountId: account.id,
          serviceAccountNumber: account.serviceAccountNumber,
          reason: 'Already billed for this billing period',
        });
        continue;
      }

      if (account.activationDate && account.activationDate > input.billingPeriodEnd) {
        skippedAccounts.push({
          serviceAccountId: account.id,
          serviceAccountNumber: account.serviceAccountNumber,
          reason: `Activation date (${account.activationDate}) is after billing period end (${input.billingPeriodEnd})`,
        });
        continue;
      }

      // Determine available advance credit
      let currentSubscriberCredit = subscriberCreditMap.has(subscriber.id)
        ? subscriberCreditMap.get(subscriber.id)!
        : subscriber.advanceCreditCentavos;

      // 3. Compute Plan Fee & Proration
      let planFeeCentavos = account.currentRateCentavos;
      let planFeeDescription = `${plan.name} - Monthly Subscription`;

      if (account.activationDate) {
        const prorationResult = calculateActivationProration(
          account.currentRateCentavos,
          input.billingPeriodStart,
          input.billingPeriodEnd,
          account.activationDate
        );

        if (prorationResult.isProrated) {
          planFeeCentavos = prorationResult.proratedAmountCentavos;
          planFeeDescription = `${plan.name} (Prorated ${prorationResult.activeDays}/${prorationResult.totalDays} days)`;
        }
      }

      // Line items
      const lineItems = [
        {
          itemType: 'PLAN_FEE',
          description: planFeeDescription,
          amountCentavos: planFeeCentavos,
          quantity: 1,
        },
      ];

      if (input.customLineItems && input.customLineItems.length > 0) {
        for (const customItem of input.customLineItems) {
          lineItems.push({
            itemType: customItem.itemType,
            description: customItem.description,
            amountCentavos: Math.abs(customItem.amountCentavos),
            quantity: customItem.quantity ?? 1,
          });
        }
      }

      let subtotalCentavos = 0;
      let discountCentavos = 0;

      for (const line of lineItems) {
        const itemTotal = line.amountCentavos * line.quantity;
        if (line.itemType === 'DISCOUNT') {
          discountCentavos += itemTotal;
        } else {
          subtotalCentavos += itemTotal;
        }
      }

      const totalDueCentavos = Math.max(0, subtotalCentavos - discountCentavos);

      // Advance Credit Consumption
      let creditAppliedCentavos = 0;
      let remainingBalanceCentavos = totalDueCentavos;
      let invoiceStatus = 'UNPAID';

      if (input.applyAdvanceCredit !== false && currentSubscriberCredit > 0) {
        creditAppliedCentavos = Math.min(currentSubscriberCredit, totalDueCentavos);
        remainingBalanceCentavos = totalDueCentavos - creditAppliedCentavos;
        currentSubscriberCredit -= creditAppliedCentavos;
        subscriberCreditMap.set(subscriber.id, currentSubscriberCredit);

        await tx
          .update(subscribers)
          .set({
            advanceCreditCentavos: currentSubscriberCredit,
            updatedAt: new Date(),
          })
          .where(eq(subscribers.id, subscriber.id));

        if (remainingBalanceCentavos === 0) {
          invoiceStatus = 'PAID';
        } else if (creditAppliedCentavos > 0) {
          invoiceStatus = 'PARTIALLY_PAID';
        }
      } else if (totalDueCentavos === 0) {
        invoiceStatus = 'PAID';
      }

      // Numbering
      maxSeq++;
      const invoiceNumber = `${prefix}${String(maxSeq).padStart(4, '0')}`;

      // Insert invoice
      const [newInvoice] = await tx
        .insert(invoices)
        .values({
          invoiceNumber,
          serviceAccountId: account.id,
          subscriberId: subscriber.id,
          billingPeriodStart: input.billingPeriodStart,
          billingPeriodEnd: input.billingPeriodEnd,
          issueDate,
          dueDate,
          subtotalCentavos,
          vatCentavos: 0,
          totalDueCentavos,
          allocatedCentavos: creditAppliedCentavos,
          remainingBalanceCentavos,
          status: invoiceStatus,
          notes: input.notes ?? null,
        })
        .returning();

      // Insert items
      const createdItems = [];
      for (const line of lineItems) {
        const [insertedItem] = await tx
          .insert(invoiceItems)
          .values({
            invoiceId: newInvoice.id,
            itemType: line.itemType,
            description: line.description,
            amountCentavos: line.amountCentavos,
            quantity: line.quantity,
          })
          .returning();
        createdItems.push(insertedItem);
      }

      // Ledger Debit & Credit Application with exact summation
      let runningBal = await getSubscriberCurrentLedgerBalance(subscriber.id, tx);
      runningBal += totalDueCentavos;

      await tx.insert(subscriberLedger).values({
        subscriberId: subscriber.id,
        entryType: 'INVOICE',
        referenceId: newInvoice.invoiceNumber,
        description: `Monthly Billing Invoice ${newInvoice.invoiceNumber}`,
        debitCentavos: totalDueCentavos,
        creditCentavos: 0,
        balanceAfterCentavos: runningBal,
      });

      if (creditAppliedCentavos > 0) {
        runningBal -= creditAppliedCentavos;
        await tx.insert(subscriberLedger).values({
          subscriberId: subscriber.id,
          entryType: 'ADVANCE_CREDIT',
          referenceId: newInvoice.invoiceNumber,
          description: `Advance Credit Applied to Invoice ${newInvoice.invoiceNumber}`,
          debitCentavos: 0,
          creditCentavos: creditAppliedCentavos,
          balanceAfterCentavos: runningBal,
        });
      }

      generatedInvoices.push({
        ...newInvoice,
        subscriber: {
          id: subscriber.id,
          accountNumber: subscriber.accountNumber,
          firstName: subscriber.firstName,
          lastName: subscriber.lastName,
          businessName: subscriber.businessName,
        },
        serviceAccount: {
          id: account.id,
          serviceAccountNumber: account.serviceAccountNumber,
          status: account.status,
          planName: plan.name,
        },
        lineItems: createdItems,
        items: createdItems,
      });
    }

    // Audit Batch Run
    await writeAuditLog(
      {
        actorId: actor.id,
        actorName: actor.name,
        action: 'INVOICE_BATCH_GENERATED',
        entityType: 'INVOICE_BATCH',
        entityId: `${input.billingPeriodStart}_${input.billingPeriodEnd}`,
        newValues: {
          billingPeriodStart: input.billingPeriodStart,
          billingPeriodEnd: input.billingPeriodEnd,
          totalProcessed,
          generatedCount: generatedInvoices.length,
          skippedCount: skippedAccounts.length,
        },
        ipAddress: ip,
      },
      tx
    );

    return {
      totalProcessed,
      generatedCount: generatedInvoices.length,
      skippedCount: skippedAccounts.length,
      invoices: generatedInvoices,
      skippedAccounts,
    };
  });
}

/**
 * Lists invoices with pagination and filters (service account, subscriber, status, date range, due date, search).
 */
export async function listInvoices(query?: InvoiceQueryInput) {
  const page = query?.page ?? 1;
  const limit = query?.limit ?? 20;
  const offset = (page - 1) * limit;

  const conditions = [];

  if (query?.serviceAccountId) {
    conditions.push(eq(invoices.serviceAccountId, query.serviceAccountId));
  }

  if (query?.subscriberId) {
    conditions.push(eq(invoices.subscriberId, query.subscriberId));
  }

  if (query?.status) {
    const statusVal = query.status === 'VOIDED' ? 'VOID' : query.status;
    conditions.push(eq(invoices.status, statusVal));
  }

  if (query?.dueDate) {
    conditions.push(eq(invoices.dueDate, query.dueDate));
  }

  if (query?.startDate) {
    conditions.push(
      or(
        gte(invoices.issueDate, query.startDate),
        gte(invoices.billingPeriodStart, query.startDate)
      )
    );
  }

  if (query?.endDate) {
    conditions.push(
      or(
        lte(invoices.issueDate, query.endDate),
        lte(invoices.billingPeriodEnd, query.endDate)
      )
    );
  }

  if (query?.search) {
    const s = `%${query.search}%`;
    conditions.push(
      or(
        ilike(invoices.invoiceNumber, s),
        ilike(subscribers.firstName, s),
        ilike(subscribers.lastName, s),
        ilike(subscribers.businessName, s),
        ilike(subscribers.accountNumber, s),
        ilike(serviceAccounts.serviceAccountNumber, s)
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Total count
  const [totalRes] = await db
    .select({ count: count() })
    .from(invoices)
    .innerJoin(subscribers, eq(invoices.subscriberId, subscribers.id))
    .innerJoin(serviceAccounts, eq(invoices.serviceAccountId, serviceAccounts.id))
    .where(whereClause);

  const total = Number(totalRes?.count ?? 0);

  // Sorting
  let orderColumn = invoices.createdAt;
  if (query?.sortBy === 'invoiceNumber') orderColumn = invoices.invoiceNumber as any;
  if (query?.sortBy === 'dueDate') orderColumn = invoices.dueDate as any;
  if (query?.sortBy === 'issueDate') orderColumn = invoices.issueDate as any;
  if (query?.sortBy === 'totalDueCentavos') orderColumn = invoices.totalDueCentavos as any;

  const orderDirection = query?.sortOrder === 'asc' ? sql`${orderColumn} ASC` : sql`${orderColumn} DESC`;

  const rows = await db
    .select({
      invoice: invoices,
      subscriber: {
        id: subscribers.id,
        accountNumber: subscribers.accountNumber,
        firstName: subscribers.firstName,
        lastName: subscribers.lastName,
        businessName: subscribers.businessName,
      },
      serviceAccount: {
        id: serviceAccounts.id,
        serviceAccountNumber: serviceAccounts.serviceAccountNumber,
        status: serviceAccounts.status,
      },
    })
    .from(invoices)
    .innerJoin(subscribers, eq(invoices.subscriberId, subscribers.id))
    .innerJoin(serviceAccounts, eq(invoices.serviceAccountId, serviceAccounts.id))
    .where(whereClause)
    .orderBy(orderDirection)
    .limit(limit)
    .offset(offset);

  const invoiceIds = rows.map((r) => r.invoice.id);
  let itemsByInvoiceId: Record<string, typeof invoiceItems.$inferSelect[]> = {};

  if (invoiceIds.length > 0) {
    const allItems = await db
      .select()
      .from(invoiceItems)
      .where(inArray(invoiceItems.invoiceId, invoiceIds))
      .orderBy(invoiceItems.itemType, invoiceItems.amountCentavos);

    for (const item of allItems) {
      if (!itemsByInvoiceId[item.invoiceId]) {
        itemsByInvoiceId[item.invoiceId] = [];
      }
      itemsByInvoiceId[item.invoiceId].push(item);
    }
  }

  const data = rows.map(({ invoice, subscriber, serviceAccount }) => ({
    ...invoice,
    subscriber,
    serviceAccount,
    lineItems: itemsByInvoiceId[invoice.id] || [],
    items: itemsByInvoiceId[invoice.id] || [],
  }));

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Retrieves invoice detail by ID or invoiceNumber, including line items and payment allocations.
 */
export async function getInvoiceById(idOrNumber: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    idOrNumber
  );

  const condition = isUuid
    ? or(eq(invoices.id, idOrNumber), eq(invoices.invoiceNumber, idOrNumber))
    : eq(invoices.invoiceNumber, idOrNumber);

  const rows = await db
    .select({
      invoice: invoices,
      subscriber: subscribers,
      serviceAccount: serviceAccounts,
      plan: servicePlans,
    })
    .from(invoices)
    .innerJoin(subscribers, eq(invoices.subscriberId, subscribers.id))
    .innerJoin(serviceAccounts, eq(invoices.serviceAccountId, serviceAccounts.id))
    .innerJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
    .where(condition)
    .limit(1);

  if (rows.length === 0) return null;

  const { invoice, subscriber, serviceAccount, plan } = rows[0];

  // Fetch line items with deterministic ordering
  const items = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoice.id))
    .orderBy(invoiceItems.itemType, invoiceItems.amountCentavos);

  // Fetch payment allocations
  const allocations = await db
    .select({
      id: paymentAllocations.id,
      paymentId: paymentAllocations.paymentId,
      allocatedCentavos: paymentAllocations.allocatedCentavos,
      paymentNumber: payments.paymentNumber,
      paymentDate: payments.paymentDate,
      paymentMethod: payments.paymentMethod,
    })
    .from(paymentAllocations)
    .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
    .where(eq(paymentAllocations.invoiceId, invoice.id))
    .orderBy(desc(paymentAllocations.createdAt));

  return {
    ...invoice,
    subscriber,
    serviceAccount: {
      ...serviceAccount,
      plan,
    },
    lineItems: items,
    items,
    paymentAllocations: allocations,
  };
}

/**
 * Voids an unpaid invoice with a mandatory audit reason.
 * Reverses any ledger debit and records an immutable audit log entry.
 */
export async function voidInvoice(
  idOrNumber: string,
  reason: string,
  actor: { id?: string; name: string },
  ip?: string
) {
  return await db.transaction(async (tx) => {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      idOrNumber
    );

    const condition = isUuid
      ? or(eq(invoices.id, idOrNumber), eq(invoices.invoiceNumber, idOrNumber))
      : eq(invoices.invoiceNumber, idOrNumber);

    const [invoice] = await tx.select().from(invoices).where(condition).limit(1);

    if (!invoice) {
      const err = new Error(`Invoice '${idOrNumber}' was not found`) as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 404;
      err.code = 'INVOICE_NOT_FOUND';
      throw err;
    }

    if (invoice.status === 'VOID' || invoice.status === 'VOIDED') {
      const err = new Error(`Invoice '${invoice.invoiceNumber}' is already voided`) as Error & {
        statusCode: number;
        code: string;
      };
      err.statusCode = 400;
      err.code = 'INVOICE_ALREADY_VOID';
      throw err;
    }

    // Check if payments or advance credits have been applied/allocated
    const [existingAllocation] = await tx
      .select({ id: paymentAllocations.id })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.invoiceId, invoice.id))
      .limit(1);

    if (
      existingAllocation ||
      invoice.status === 'PAID' ||
      invoice.status === 'PARTIALLY_PAID' ||
      invoice.allocatedCentavos > 0
    ) {
      const err = new Error(
        `Cannot void invoice '${invoice.invoiceNumber}' because it has allocated payments or applied credits`
      ) as Error & { statusCode: number; code: string };
      err.statusCode = 400;
      err.code = 'CANNOT_VOID_PAID_INVOICE';
      throw err;
    }

    // 1. Update invoice status to VOID
    const [updatedInvoice] = await tx
      .update(invoices)
      .set({
        status: 'VOID',
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoice.id))
      .returning();

    // 2. Reverse ledger debit
    const currentBalance = await getSubscriberCurrentLedgerBalance(invoice.subscriberId, tx);
    const newBalance = currentBalance - invoice.totalDueCentavos;

    await tx.insert(subscriberLedger).values({
      subscriberId: invoice.subscriberId,
      entryType: 'INVOICE_VOIDED',
      referenceId: invoice.invoiceNumber,
      description: `Reversal: Voided Invoice ${invoice.invoiceNumber}`,
      debitCentavos: 0,
      creditCentavos: invoice.totalDueCentavos,
      balanceAfterCentavos: newBalance,
    });

    // 3. Write audit log
    await writeAuditLog(
      {
        actorId: actor.id,
        actorName: actor.name,
        action: 'INVOICE_VOIDED',
        entityType: 'INVOICE',
        entityId: invoice.id,
        reason,
        oldValues: { status: invoice.status },
        newValues: { status: 'VOID' },
        ipAddress: ip,
      },
      tx
    );

    return updatedInvoice;
  });
}
