# BCIS Subscription Billing and Collection System — Testing Strategy & Quality Assurance Plan

## 1. Testing Philosophy & Quality Gates

The BCIS Subscription Billing and Collection System governs real-world subscriber financial obligations, municipal field remittances, and service lifecycles. Software defects can directly result in lost revenue, inaccurate customer bills, or legal compliance violations.

Therefore, testing is governed by the following strict rules:
1. **Financial Test-First Development**: All financial logic (invoice balance updates, FIFO payment allocation, proration, remittance differences) must be verified via unit tests prior to API and UI implementation.
2. **Real Database Testing for Integration**: Integration tests do not mock PostgreSQL transactions. They run against a dedicated PostgreSQL test instance to verify foreign key integrity, row-level locks, sequences, and rollback behavior.
3. **Never Weaken Tests to Pass**: Existing assertions must never be deleted or modified simply to make an altered implementation pass.
4. **Mandatory Acceptance Test Suite**: All 12 Acceptance Tests (AT-01 through AT-12) must pass cleanly in automated continuous integration before any release candidate is compiled.

---

## 2. Test Pyramid & Tooling Architecture

```text
               ┌───────────────────────┐
               │  End-to-End Tests     │  Playwright Electron
               │  (Desktop UI Flows)   │  (5% of tests)
               ├───────────────────────┤
               │   Acceptance Tests    │  Automated AT-01 to AT-12
               │  (Business Scenarios) │  (15% of tests)
               ├───────────────────────┤
               │   Integration Tests   │  Fastify Inject + PostgreSQL
               │ (API, DB, RBAC, Txns) │  (30% of tests)
               ├───────────────────────┤
               │      Unit Tests       │  Vitest
               │(Money, FIFO, Schemas) │  (50% of tests)
               └───────────────────────┘
```

### 2.1 Unit Tests (Vitest)
- **Scope**: Pure TypeScript domain logic, mathematical functions, Zod validation schemas, and state-machine transitions.
- **Key Modules Tested**:
  - `packages/domain/money`: Centavo conversions, proration rounding, currency string formatting.
  - `packages/domain/allocation`: FIFO payment allocation algorithm across multiple invoices with exact, partial, and overflow balances.
  - `packages/domain/aging`: Calculating days past due and mapping to standard aging buckets.
  - `packages/domain/reconciliation`: Calculating expected cash, variance, and shortage/overage status.
  - `packages/validation`: Form schemas, regex checks for phone numbers and GCash references.

### 2.2 Integration Tests (Fastify Test Harness)
- **Scope**: API controllers, Fastify plugins, database migrations, connection pooling, and multi-step ACID transactions.
- **Key Scenarios Tested**:
  - Payment posting rollbacks when receipt creation or audit logging fails mid-transaction.
  - Concurrent `SELECT ... FOR UPDATE` row locks preventing double-allocation race conditions.
  - Server-side RBAC permission rejections (`requirePermission`).
  - Database unique constraints triggering HTTP 409 Conflict.

### 2.3 Acceptance Tests (AT Suite)
- **Scope**: Formal end-to-end verification of the 12 core business acceptance criteria defined in the product specification.

### 2.4 Desktop E2E Tests (Playwright Electron)
- **Scope**: Electron application launch, native window rendering, preload IPC security boundary verification, and cashier keyboard workflow simulation.

---

## 3. Mandatory Acceptance Test Specifications (AT-01 through AT-12)

### AT-01: Exact Payment
- **Purpose**: Verify that an exact counter payment completely settles an outstanding invoice, zeroes the balance, sets invoice status to `PAID`, produces a balanced ledger, and generates an Official Receipt.
- **Initial State**:
  - Subscriber: `SUB-202609-0001`
  - Invoice: `INV-202609-000001` with Total Due = ₱999.00 (`99900` centavos), Status = `UNPAID`.
- **Action**:
  - Cashier posts payment of ₱999.00 (`99900` centavos) via `CASH`.
- **Expected Assertions**:
  1. `invoices.status` transitions to `PAID`.
  2. `invoices.remaining_balance_centavos` equals `0`.
  3. One `payments` record created for `99900` centavos.
  4. One `payment_allocations` record created linking payment to invoice for `99900` centavos.
  5. One `receipts` record created with sequential number `OR-2026-XXXXXX`.
  6. Subscriber ledger net balance equals `0`.

---

### AT-02: Partial Payment
- **Purpose**: Verify that paying less than the total invoice due date leaves the invoice partially paid, tracks the remaining balance, and updates the ledger correctly.
- **Initial State**:
  - Subscriber: `SUB-202609-0002`
  - Invoice: `INV-202609-000002` with Total Due = ₱999.00 (`99900` centavos), Status = `UNPAID`.
- **Action**:
  - Cashier posts payment of ₱500.00 (`50000` centavos) via `CASH`.
- **Expected Assertions**:
  1. `invoices.status` transitions to `PARTIALLY_PAID`.
  2. `invoices.allocated_centavos` equals `50000`.
  3. `invoices.remaining_balance_centavos` equals `49900` (₱499.00).
  4. Subscriber ledger reflects Debit ₱999.00, Credit ₱500.00, Net Balance = ₱499.00.

---

### AT-03: Advance / Overpayment
- **Purpose**: Verify that paying more than current outstanding invoices satisfies all invoices and credits the excess funds to the subscriber's advance account.
- **Initial State**:
  - Subscriber: `SUB-202609-0003`
  - Invoice: `INV-202609-000003` with Total Due = ₱1,000.00 (`100000` centavos), Status = `UNPAID`.
- **Action**:
  - Cashier posts payment of ₱3,000.00 (`300000` centavos) via `CASH`.
- **Expected Assertions**:
  1. `INV-202609-000003` is marked `PAID` with remaining balance `0`.
  2. `subscribers.advance_credit_centavos` equals `200000` (₱2,000.00 credit).
  3. Subscriber ledger reflects total payments of ₱3,000.00 and net account balance of -₱2,000.00 (credit in customer's favor).
  4. Next generated invoice automatically consumes available advance credit.

---

### AT-04: Oldest-First FIFO Allocation
- **Purpose**: Verify that payments are automatically allocated across multiple outstanding invoices starting with the oldest unpaid invoice.
- **Initial State**:
  - Subscriber: `SUB-202609-0004`
  - Invoice 1 (August): `INV-202608-000010`, Total Due = ₱999.00 (`99900` centavos), Due = Aug 15.
  - Invoice 2 (September): `INV-202609-000025`, Total Due = ₱999.00 (`99900` centavos), Due = Sep 15.
- **Action**:
  - Cashier posts payment of ₱1,200.00 (`120000` centavos).
- **Expected Assertions**:
  1. August invoice (`INV-202608-000010`) is allocated `99900` centavos; Status = `PAID`, Remaining = `0`.
  2. September invoice (`INV-202609-000025`) is allocated `20100` centavos; Status = `PARTIALLY_PAID`, Remaining = `79800` centavos (₱798.00).
  3. Total payment of ₱1,200.00 is fully exhausted across the two allocations.

---

### AT-05: Duplicate GCash Reference Protection
- **Purpose**: Verify that the system blocks attempts to post a GCash transaction with an already-used reference number.
- **Initial State**:
  - Payment posted previously with GCash Reference: `9012345678901`.
- **Action**:
  - Submit new GCash payment attempt with Reference: `9012345678901`.
- **Expected Assertions**:
  1. Request is rejected with HTTP 409 Conflict.
  2. Error response payload explicitly cites `DUPLICATE_GCASH_REFERENCE`.
  3. No secondary payment, allocation, or receipt is created in the database.

---

### AT-06: Payment Reversal
- **Purpose**: Verify that an authorized payment reversal restores affected invoice balances, voids the receipt, preserves historical records, and writes an immutable audit trail.
- **Initial State**:
  - Payment of ₱500.00 posted against invoice `INV-202609-000050` (leaving balance ₱499.00, status `PARTIALLY_PAID`).
- **Action**:
  - Admin/Accounting issues reversal for the payment with reason "Bounced Check / Bank Chargeback".
- **Expected Assertions**:
  1. Original payment record has `is_reversed = true` (not deleted).
  2. Invoice `INV-202609-000050` balance restored to ₱999.00; status reverts to `UNPAID` (or `OVERDUE` if past due).
  3. Associated Official Receipt status set to `REVERSED`.
  4. Subscriber ledger records compensatory debit of ₱500.00.
  5. Audit log entry created with action `PAYMENT_REVERSED` and specified reason.

---

### AT-07: Balanced Collector Remittance
- **Purpose**: Verify that a field collection batch where physical cash turned in matches recorded field collections exactly reconciles and closes cleanly.
- **Initial State**:
  - Collection Batch #101 containing field collections totaling ₱20,000.00 in cash payments.
- **Action**:
  - Supervisor records remitted cash count of ₱20,000.00.
- **Expected Assertions**:
  1. `Expected Cash` = ₱20,000.00.
  2. `Remitted Cash` = ₱20,000.00.
  3. `Difference` = ₱0.00.
  4. Batch status transitions to `RECONCILED` and is eligible to transition to `CLOSED`.

---

### AT-08: Collector Shortage Handling
- **Purpose**: Verify that a field collection batch with a cash deficit records a shortage and cannot be closed as balanced.
- **Initial State**:
  - Collection Batch #102 containing field collections totaling ₱20,000.00 in cash payments.
- **Action**:
  - Supervisor records remitted cash count of ₱19,500.00.
- **Expected Assertions**:
  1. `Expected Cash` = ₱20,000.00.
  2. `Remitted Cash` = ₱19,500.00.
  3. `Difference` = +₱500.00 (Shortage).
  4. Attempting to mark batch as "Balanced" fails with validation error.
  5. Batch transitions to `RECONCILED_WITH_SHORTAGE`.
  6. A shortage debit of ₱500.00 is logged against the collector's accountability account.

---

### AT-09: Concurrent Multi-PC Operation
- **Purpose**: Verify that multiple workstations operating simultaneously over the LAN do not cause race conditions, deadlocks, or duplicate sequential numbers.
- **Action**:
  - Concurrently execute:
    - Thread A (Admin): Executes monthly billing generation for 50 service accounts.
    - Thread B (Cashier): Posts 20 counter payments with receipt generation.
    - Thread C (Operations): Reconciles a collection batch.
- **Expected Assertions**:
  1. All 71 transactions complete successfully without PostgreSQL deadlock errors (`40P01`).
  2. All generated invoice numbers and receipt numbers are unique, monotonically increasing, and without gaps.
  3. Database balances match expected mathematical totals.

---

### AT-10: Server-Side RBAC Enforcement
- **Purpose**: Verify that API endpoints enforce permissions strictly on the server regardless of client state.
- **Action**:
  - Issue HTTP `POST /api/v1/users` with an authorization Bearer token possessing only `ROLE_CASHIER`.
- **Expected Assertions**:
  1. Server returns HTTP 403 Forbidden.
  2. Response payload: `{ "error": "Forbidden", "message": "Missing required permission: user.manage" }`.
  3. No user record is inserted.

---

### AT-11: Duplicate Billing Protection
- **Purpose**: Verify that running the billing generator twice for the same billing period does not create duplicate invoices.
- **Initial State**:
  - 10 active service accounts billed for Period `2026-09-01` to `2026-09-30`.
- **Action**:
  - Trigger billing generation for the exact same period again.
- **Expected Assertions**:
  1. Billing run reports: `0 invoices created, 10 accounts skipped (already billed)`.
  2. Database total invoice count for the period remains exactly 10.

---

### AT-12: Backup and Disaster Recovery Integrity
- **Purpose**: Verify that the database can be backed up and restored without data loss or integrity violations.
- **Action**:
  1. Generate on-demand database backup archive via API.
  2. Compute row count hashes across all core tables (`subscribers`, `invoices`, `payments`, `receipts`, `audit_logs`).
  3. Simulate catastrophic data drop or corruption.
  4. Restore database from generated backup archive.
- **Expected Assertions**:
  1. Restoration completes without foreign key or schema errors.
  2. Post-restore row counts and table hashes match pre-backup values with 100% parity.

---

## 4. Continuous Verification Protocol

Before claiming any task or feature complete, the following commands must be executed and confirmed passing:

```bash
# 1. Typecheck entire monorepo
pnpm run typecheck

# 2. Lint and code standards
pnpm run lint

# 3. Unit test suite
pnpm run test:unit

# 4. API and Integration test suite
pnpm run test:integration

# 5. Acceptance test suite (AT-01 to AT-12)
pnpm run test:acceptance
```
