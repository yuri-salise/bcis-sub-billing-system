import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  bigint,
  timestamp,
  date,
  numeric,
  jsonb,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ==============================================================================
// 1. Users, Roles & Permissions
// ==============================================================================

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 64 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 128 }).notNull(),
  email: varchar('email', { length: 128 }),
  isActive: boolean('is_active').notNull().default(true),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 32 }).notNull().unique(), // e.g. ROLE_CASHIER
  name: varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 64 }).notNull().unique(),
  module: varchar('module', { length: 32 }).notNull(),
  description: text('description'),
  riskLevel: varchar('risk_level', { length: 16 }).notNull().default('Medium'),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
  ]
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
  ]
);

// ==============================================================================
// 2. Subscribers & Addresses
// ==============================================================================

export const subscribers = pgTable('subscribers', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountNumber: varchar('account_number', { length: 32 }).notNull().unique(),
  firstName: varchar('first_name', { length: 64 }).notNull(),
  middleName: varchar('middle_name', { length: 64 }),
  lastName: varchar('last_name', { length: 64 }).notNull(),
  businessName: varchar('business_name', { length: 128 }),
  contactNumber: varchar('contact_number', { length: 32 }).notNull(),
  alternateContact: varchar('alternate_contact', { length: 32 }),
  email: varchar('email', { length: 128 }),
  idType: varchar('id_type', { length: 32 }),
  idNumber: varchar('id_number', { length: 64 }),
  advanceCreditCentavos: bigint('advance_credit_centavos', { mode: 'number' }).notNull().default(0),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'), // ACTIVE, INACTIVE, TERMINATED, ARCHIVED
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriberAddresses = pgTable('subscriber_addresses', {
  id: uuid('id').primaryKey().defaultRandom(),
  subscriberId: uuid('subscriber_id').notNull().references(() => subscribers.id, { onDelete: 'cascade' }),
  addressType: varchar('address_type', { length: 20 }).notNull().default('BILLING'),
  streetAddress: text('street_address').notNull(),
  barangay: varchar('barangay', { length: 64 }).notNull(),
  municipality: varchar('municipality', { length: 64 }).notNull().default('Malaybalay'),
  province: varchar('province', { length: 64 }).notNull().default('Bukidnon'),
  postalCode: varchar('postal_code', { length: 10 }).default('8700'),
  latitude: numeric('latitude', { precision: 10, scale: 8 }),
  longitude: numeric('longitude', { precision: 11, scale: 8 }),
  isPrimary: boolean('is_primary').notNull().default(true),
});

// ==============================================================================
// 3. Service Plans & Accounts
// ==============================================================================

export const serviceTypes = pgTable('service_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 20 }).notNull().unique(), // INTERNET, CABLE_TV, COMBO
  name: varchar('name', { length: 64 }).notNull(),
});

export const servicePlans = pgTable('service_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceTypeId: uuid('service_type_id').notNull().references(() => serviceTypes.id),
  planCode: varchar('plan_code', { length: 32 }).notNull().unique(),
  name: varchar('name', { length: 128 }).notNull(),
  monthlyRecurringCentavos: bigint('monthly_recurring_centavos', { mode: 'number' }).notNull(),
  installationFeeCentavos: bigint('installation_fee_centavos', { mode: 'number' }).notNull().default(0),
  bandwidthMbps: integer('bandwidth_mbps'),
  channelCount: integer('channel_count'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const serviceAccounts = pgTable('service_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceAccountNumber: varchar('service_account_number', { length: 32 }).notNull().unique(),
  subscriberId: uuid('subscriber_id').notNull().references(() => subscribers.id, { onDelete: 'restrict' }),
  servicePlanId: uuid('service_plan_id').notNull().references(() => servicePlans.id, { onDelete: 'restrict' }),
  installationAddressId: uuid('installation_address_id').references(() => subscriberAddresses.id),
  collectorId: uuid('collector_id').references(() => users.id),
  billingDayOfMonth: integer('billing_day_of_month').notNull().default(1),
  currentRateCentavos: bigint('current_rate_centavos', { mode: 'number' }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('ACTIVE'), // PENDING_INSTALL, ACTIVE, SUSPENDED, TERMINATED
  activationDate: date('activation_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==============================================================================
// 4. Invoices & Items
// ==============================================================================

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceNumber: varchar('invoice_number', { length: 32 }).notNull().unique(),
    serviceAccountId: uuid('service_account_id').notNull().references(() => serviceAccounts.id, { onDelete: 'restrict' }),
    subscriberId: uuid('subscriber_id').notNull().references(() => subscribers.id, { onDelete: 'restrict' }),
    billingPeriodStart: date('billing_period_start').notNull(),
    billingPeriodEnd: date('billing_period_end').notNull(),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date').notNull(),
    subtotalCentavos: bigint('subtotal_centavos', { mode: 'number' }).notNull(),
    vatCentavos: bigint('vat_centavos', { mode: 'number' }).notNull().default(0),
    totalDueCentavos: bigint('total_due_centavos', { mode: 'number' }).notNull(),
    allocatedCentavos: bigint('allocated_centavos', { mode: 'number' }).notNull().default(0),
    remainingBalanceCentavos: bigint('remaining_balance_centavos', { mode: 'number' }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('UNPAID'), // DRAFT, UNPAID, PARTIALLY_PAID, PAID, OVERDUE, VOID, CREDITED
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Duplicate billing prevention constraint (AT-11)
    uniqueIndex('unique_active_invoice_per_period').on(
      table.serviceAccountId,
      table.billingPeriodStart,
      table.billingPeriodEnd
    ),
  ]
);

export const invoiceItems = pgTable('invoice_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  itemType: varchar('item_type', { length: 32 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),
  quantity: integer('quantity').notNull().default(1),
});

// ==============================================================================
// 5. Payments, Allocations, Receipts & GCash
// ==============================================================================

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentNumber: varchar('payment_number', { length: 32 }).notNull().unique(),
  subscriberId: uuid('subscriber_id').notNull().references(() => subscribers.id, { onDelete: 'restrict' }),
  cashierId: uuid('cashier_id').notNull().references(() => users.id),
  paymentDate: timestamp('payment_date', { withTimezone: true }).notNull().defaultNow(),
  paymentMethod: varchar('payment_method', { length: 20 }).notNull(), // CASH, GCASH, BANK_TRANSFER, CHECK
  referenceNumber: varchar('reference_number', { length: 64 }),
  amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),
  isReversed: boolean('is_reversed').notNull().default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const paymentAllocations = pgTable('payment_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id').notNull().references(() => payments.id, { onDelete: 'restrict' }),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'restrict' }),
  allocatedCentavos: bigint('allocated_centavos', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const receipts = pgTable('receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  receiptNumber: varchar('receipt_number', { length: 32 }).notNull().unique(),
  paymentId: uuid('payment_id').notNull().unique().references(() => payments.id, { onDelete: 'restrict' }),
  cashierId: uuid('cashier_id').notNull().references(() => users.id),
  totalAmountCentavos: bigint('total_amount_centavos', { mode: 'number' }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('ISSUED'), // ISSUED, REVERSED
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
});

export const paymentReversals = pgTable('payment_reversals', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id').notNull().unique().references(() => payments.id, { onDelete: 'restrict' }),
  reversedBy: uuid('reversed_by').notNull().references(() => users.id),
  reason: text('reason').notNull(),
  reversalDate: timestamp('reversal_date', { withTimezone: true }).notNull().defaultNow(),
});

export const gcashTransactions = pgTable('gcash_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  referenceNumber: varchar('reference_number', { length: 64 }).notNull().unique(),
  subscriberId: uuid('subscriber_id').references(() => subscribers.id),
  senderName: varchar('sender_name', { length: 128 }).notNull(),
  senderPhone: varchar('sender_phone', { length: 32 }).notNull(),
  amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),
  proofImagePath: text('proof_image_path').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('PENDING_VERIFICATION'),
  verifiedBy: uuid('verified_by').references(() => users.id),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==============================================================================
// 6. Subscriber Running Ledger
// ==============================================================================

export const subscriberLedger = pgTable('subscriber_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  subscriberId: uuid('subscriber_id').notNull().references(() => subscribers.id, { onDelete: 'restrict' }),
  entryDate: timestamp('entry_date', { withTimezone: true }).notNull().defaultNow(),
  entryType: varchar('entry_type', { length: 32 }).notNull(),
  referenceId: varchar('reference_id', { length: 64 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  debitCentavos: bigint('debit_centavos', { mode: 'number' }).notNull().default(0),
  creditCentavos: bigint('credit_centavos', { mode: 'number' }).notNull().default(0),
  balanceAfterCentavos: bigint('balance_after_centavos', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ==============================================================================
// 7. Field Collections & Batches
// ==============================================================================

export const collectionAreas = pgTable('collection_areas', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 128 }).notNull().unique(),
  description: text('description'),
});

export const collectionBatches = pgTable('collection_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  batchNumber: varchar('batch_number', { length: 32 }).notNull().unique(),
  collectorId: uuid('collector_id').notNull().references(() => users.id),
  collectionAreaId: uuid('collection_area_id').notNull().references(() => collectionAreas.id),
  status: varchar('status', { length: 32 }).notNull().default('OPEN'),
  expectedCashCentavos: bigint('expected_cash_centavos', { mode: 'number' }).notNull().default(0),
  remittedCashCentavos: bigint('remitted_cash_centavos', { mode: 'number' }).notNull().default(0),
  differenceCentavos: bigint('difference_centavos', { mode: 'number' }).notNull().default(0),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

// ==============================================================================
// 8. Audit Logs
// ==============================================================================

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id').references(() => users.id),
  actorName: varchar('actor_name', { length: 128 }).notNull(),
  action: varchar('action', { length: 64 }).notNull(),
  entityType: varchar('entity_type', { length: 64 }).notNull(),
  entityId: varchar('entity_id', { length: 64 }).notNull(),
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),
  reason: text('reason'),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
