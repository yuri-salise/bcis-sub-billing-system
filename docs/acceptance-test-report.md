# Acceptance Test Report & Live Defense Verification Matrix

**System Name:** Bukidnon Cable and Internet Services (BCIS) Subscription Billing and Collection System  
**Document Version:** 1.0.0  
**Test Suite Release:** Phase 9 Release Candidate (AT-01 to AT-14, Section 32 Defense Sequence)  
**Execution Date:** September 19, 2026  
**Test Framework:** Vitest 3.2.7 (Execution Mode: `--no-file-parallelism`)  
**Overall Evaluation:** **100% PASS** (20 / 20 Suites, 370 / 370 Tests Passing across monorepo; 15 / 15 Suites, 324 / 324 Tests Passing in @bcis/api)

---

## 1. Executive Summary

This document serves as the formal **Acceptance Test Report** for the Bukidnon Cable and Internet Services (BCIS) Subscription Billing and Collection System. It provides definitive, reproducible verification evidence for all requirements specified in:
1. **PRODUCT.md Section 32: 27-Step Live Defense Demonstration Sequence**
2. **PRODUCT.md Section 33: Critical Failure Prevention Audit (14 Mandatory Checks)**
3. **Mandatory Acceptance Criteria (AT-01 through AT-14)**
4. **Multi-Workstation LAN Concurrency Verification (AT-09)**

### 1.1 Summary of Automated Test Execution

```text
Monorepo Test Suites: 20 passed (20)
Total Automated Tests: 370 passed (370)
Database Safety Mode:  --no-file-parallelism (isolated transactional sequences)
```

| Package / Workspace | Scope | Suites | Tests | Status |
| :--- | :--- | :---: | :---: | :---: |
| `@bcis/domain` | Pure Financial, Aging, FIFO & Reconciliation Logic | 4 | 31 | **PASS** |
| `@bcis/shared-types` | DTOs, Enums, State Machine Interfaces | Typecheck | N/A | **PASS** |
| `@bcis/validation` | Zod Schemas & Financial Input Sanitization | Typecheck | N/A | **PASS** |
| `@bcis/api` | Fastify 5 REST API, PostgreSQL ORM, AT-01..AT-14, Concurrency | 15 | 324 | **PASS** |
| `apps/desktop` | Electron 34 / React 19 Client API Binding & Desktop Workspaces | 1 | 15 | **PASS** |
| **Monorepo Total** | **Full System & Acceptance Integrity** | **20** | **370** | **100% PASS** |

---

## 2. Test Environment & Architecture Topology

| Component | Specification | Description |
| :--- | :--- | :--- |
| **Operating System** | Windows 11 Enterprise (x64) | Target workstation platform for BCIS local office LAN |
| **Runtime** | Node.js v22.13.1 / pnpm 10.x | Workspace monorepo execution environment |
| **Database Engine** | PostgreSQL 16.x | Client-server relational database with connection pooling (`pg.Pool`) |
| **API Server** | Fastify 5.2.1 | RFC 7807 compliant RESTful microframework |
| **ORM / Schema** | Drizzle ORM 0.39.3 | Type-safe SQL client with explicit migration and schema tracking |
| **Security Engine** | `@fastify/jwt` + Argon2id | Cryptographic password hashing (`argon2id`) & stateless JWT tokens |
| **UI Framework** | Electron 34 + React 19 | LAN-connected desktop app (no direct database access from renderer) |

---

## 3. PRODUCT.md Section 32: 27-Step Live Defense Demonstration Matrix

The following sequence details the automated execution and verification of the 27 steps required for the panel defense demonstration:

| Step | Live Defense Scenario | Target Endpoint / API Action | Test Input / Parameters | Expected vs Actual Behavior | Verdict |
| :---: | :--- | :--- | :--- | :--- | :---: |
| **1** | Authenticate administrator | `POST /api/v1/auth/login` | `{ username: "admin", password: "..." }` | Issued valid JWT session token with `ROLE_SUPER_ADMIN`. | **PASS** |
| **2** | Display executive dashboard | `GET /api/v1/reports/ar-aging`, `daily-collections` | Headers: `Bearer <adminToken>` | Returned 200 OK with 5-bucket AR aging and daily cashier collections. | **PASS** |
| **3** | Register new subscriber | `POST /api/v1/subscribers` | `{ firstName: "Juan", lastName: "Dela Cruz", ... }` | Returned 201 Created with monotonic account number `SUB-YYYYMM-XXXX`. | **PASS** |
| **4** | Provision broadband service | `POST /api/v1/service-accounts` | Plan: Fiber Starter 999, Status: ACTIVE | Returned 201 Created with service account `SA-YYYYMM-XXXX`. | **PASS** |
| **5** | Generate monthly invoice | `POST /api/v1/billing/generate` | Period: 2026-08-01 to 2026-08-31 | Generated invoice `INV-YYYYMM-XXXX` for ₱999.00 (99,900 centavos). | **PASS** |
| **6** | Inspect ledger debit | Database: `subscriber_ledger` | Query where `entryType = 'INVOICE'` | Verified debit of ₱999.00, credit of ₱0, balance after of ₱999.00. | **PASS** |
| **7** | Post exact cash payment | `POST /api/v1/payments` | Amount: 99,900 centavos, Method: CASH | Generated payment record and assigned official receipt number. | **PASS** |
| **8** | Verify FIFO allocation | Database: `invoices` | Query `invoices.id = demoInvoiceId` | Invoice marked `PAID` with allocated ₱999.00 and remaining balance ₱0. | **PASS** |
| **9** | Retrieve official receipt | `GET /api/v1/receipts/:id` | Receipt ID from Step 7 | Returned receipt with formatted number `OR-YYYYMM-XXXX` and amount ₱999.00. | **PASS** |
| **10** | Submit & verify GCash | `POST /api/v1/gcash/submit`, `verify` | Ref: `9012XXXXXXXXX`, Amount: ₱999.00 | GCash intake accepted as `PENDING`, transitioned to `VERIFIED`. | **PASS** |
| **11** | Duplicate GCash protection | `POST /api/v1/gcash/submit` | Identical GCash reference number | Blocked with HTTP 409 Conflict (`DUPLICATE_GCASH_REFERENCE`). | **PASS** |
| **12** | Inspect running ledger | `GET /api/v1/subscribers/:id/ledger` | Subscriber ID from Step 3 | Returned sequential running ledger with debits, credits, and balance audit trail. | **PASS** |
| **13** | Generate Statement of Account | `GET /api/v1/subscribers/:id/soa` | Subscriber ID from Step 3 | Aggregated active services, balance, aging summary, and ledger lines. | **PASS** |
| **14** | Open overdue subscriber | `POST /api/v1/subscribers`, `service-accounts` | Delinquent Customer, past due invoice | Created overdue account with June 2026 invoice. | **PASS** |
| **15** | Filter AR aging report | `GET /api/v1/reports/ar-aging` | Query: Overdue accounts | Correctly classified delinquent receivables into 61-90+ day overdue buckets. | **PASS** |
| **16** | Open collector batch | `POST /api/v1/collections/batches` | Collector ID, Area ID, Expected: ₱20,000 | Created batch with status `OPEN` and number `BAT-YYYYMM-XXXX`. | **PASS** |
| **17** | Record field collection | `POST /api/v1/payments` | Method: CASH, Route collection | Recorded field payment and updated subscriber arrears. | **PASS** |
| **18** | Record collector remittance | `POST /api/v1/collections/shift/reconcile` | Remitted: ₱20,000.00 cash | Logged physical cash turned in at counter drawer. | **PASS** |
| **19** | Reconcile balanced batch | `POST /api/v1/collections/batches/:id/reconcile` | Remitted: ₱20,000 (Expected: ₱20,000) | Calculated difference ₱0, marked batch `RECONCILED` (AT-07). | **PASS** |
| **20** | Detect collector shortage | `POST /api/v1/collections/batches/:id/reconcile` | Remitted: ₱19,500 (Expected: ₱20,000) | Calculated shortage ₱500, marked `RECONCILED_WITH_SHORTAGE` (AT-08). | **PASS** |
| **21** | Execute payment reversal | `POST /api/v1/payments/:id/reverse` | Reason: "Bounced Check / Bank Chargeback" | Restored invoice balance, voided receipt, preserved payment history (AT-06). | **PASS** |
| **22** | Audit trail inspection | Database: `audit_logs` | Query `action = 'PAYMENT_REVERSED'` | Immutable audit log verified with actor ID, timestamp, and reversal reason. | **PASS** |
| **23** | Export report to CSV | `GET /api/v1/reports/ar-aging?format=csv` | Query: `format=csv` | Returned 200 OK with `text/csv; charset=utf-8` and sanitized headers. | **PASS** |
| **24** | Test lower-role authorization | `POST /api/v1/users` (as Cashier) | Cashier token attempting user creation | Blocked with HTTP 403 Forbidden (`FORBIDDEN`). | **PASS** |
| **25** | Database backup snapshot | `POST /api/v1/system/backup` | Admin token | Generated topological SQL dump with companion SHA-256 metadata file. | **PASS** |
| **26** | Database disaster restoration | `POST /api/v1/system/restore` | Filename from Step 25 | Cascaded truncation and transactional restore with 100% row count parity. | **PASS** |
| **27** | Simultaneous multi-PC operation | Concurrent injection across 3 tokens | PC1: Admin, PC2: Cashier, PC3: Tech | All 3 requests succeeded with 200 OK without deadlocks or sequence collisions. | **PASS** |

---

## 4. Mandatory Acceptance Criteria Traceability (AT-01 to AT-14)

| Requirement | Test Scenario | Test Input Parameters | Expected Behavior | Actual Verification Result | Status |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **AT-01** | Exact Payment | Invoice: ₱999.00<br>Payment: ₱999.00 CASH | Invoice status -> `PAID`<br>Remaining balance -> ₱0<br>Receipt: `OR-YYYYMM-XXXX` | Invoice remaining balance: `0`<br>Status: `PAID`<br>Receipt issued: `OR-202609-0002` | **PASS** |
| **AT-02** | Partial Payment | Invoice: ₱999.00<br>Payment: ₱500.00 CASH | Invoice status -> `PARTIALLY_PAID`<br>Allocated -> ₱500.00<br>Remaining balance -> ₱499.00 | Allocated: `50000`<br>Remaining balance: `49900`<br>Status: `PARTIALLY_PAID` | **PASS** |
| **AT-03** | Advance Payment / Overpayment | Invoice balance: ₱499.00<br>Payment: ₱2,499.00 CASH | Invoice satisfied (₱499 paid)<br>Surplus ₱2,000 credited to subscriber advance account | Invoice status: `PAID`<br>Subscriber `advanceCreditCentavos`: `200000` (₱2,000.00) | **PASS** |
| **AT-04** | Oldest-First FIFO Allocation | Month 1: ₱999.00 (August)<br>Month 2: ₱999.00 (September)<br>Payment: ₱1,200.00 CASH | Month 1 balance -> ₱0 (`PAID`)<br>Month 2 balance -> ₱798.00 (`PARTIALLY_PAID`) | Month 1 remaining: `0`<br>Month 2 remaining: `79800`<br>Total paid: `120000` | **PASS** |
| **AT-05** | Duplicate GCash Reference Guard | GCash Submission 1: Ref `9012...`<br>GCash Submission 2: Reused Ref | Submission 1 -> HTTP 201 Created<br>Submission 2 -> HTTP 409 Conflict (`DUPLICATE_GCASH_REFERENCE`) | Submission 1: Status 201<br>Submission 2: Status 409 Conflict<br>Code: `DUPLICATE_GCASH_REFERENCE` | **PASS** |
| **AT-06** | Payment Reversal Audit Trail | Invoice: ₱999.00 (Paid)<br>Reverse Payment: Reason specified | Invoice balance restored -> ₱999.00<br>Invoice status -> `UNPAID`<br>Receipt -> `REVERSED` | Restored balance: `99900`<br>Status: `UNPAID`<br>Audit log: `PAYMENT_REVERSED` | **PASS** |
| **AT-07** | Balanced Collector Remittance | Expected Cash: ₱10,000.00<br>Remitted Cash: ₱10,000.00 | Difference -> ₱0<br>Reconciliation status -> `RECONCILED`<br>`isBalanced: true` | Difference: `0`<br>Status: `RECONCILED`<br>`isBalanced`: `true` | **PASS** |
| **AT-08** | Collector Cash Shortage | Expected Cash: ₱10,000.00<br>Remitted Cash: ₱9,000.00 | Shortage recorded -> ₱1,000.00<br>Batch status -> `RECONCILED_WITH_SHORTAGE`<br>Block silent closure | Difference: `100000`<br>Status: `RECONCILED_WITH_SHORTAGE`<br>Closure rejected (400 `UNRESOLVED_SHORTAGE`) | **PASS** |
| **AT-09** | 3-Workstation LAN Concurrency | PC 1: Admin Billing Generation<br>PC 2: Cashier Payment Posting<br>PC 3: Field Service Orders | Zero deadlocks<br>Sequential numbers intact<br>Concurrent responses 200/201 OK | Concurrent operations completed in 348ms with zero collisions and zero deadlocks. | **PASS** |
| **AT-10** | Server-Side RBAC Enforcement | Cashier token sent to administrative route: `POST /api/v1/users` | Blocked with HTTP 403 Forbidden (`FORBIDDEN`) | Status: `403 Forbidden`<br>Error: `Forbidden`<br>Message: `Access denied` | **PASS** |
| **AT-11** | Duplicate Billing Protection | Billing run executed twice for same service account & period (`2026-04-01` to `2026-04-30`) | First run -> 201 Created<br>Second run -> 409 Conflict (`DUPLICATE_BILLING_PERIOD`) | First run: Status 201<br>Second run: Status 409 Conflict<br>0 duplicate invoices created | **PASS** |
| **AT-12** | Database Backup & Disaster Recovery | 1. Generate snapshot archive<br>2. Mutate / wipe database<br>3. Restore snapshot archive | 100% row count parity across all 24 core PostgreSQL tables with verified SHA-256 | Backup SHA-256 verified<br>Restoration parity: `true`<br>Pre/post row counts identical | **PASS** |
| **AT-13** | Service Order Lifecycle & Dunning | Issue `DISCONNECTION` order for delinquent subscriber account | Complete order with resolution notes -> transitions service account status to `SUSPENDED` | Order completed (Status 200)<br>Service account status -> `SUSPENDED` | **PASS** |
| **AT-14** | Statement of Account (SOA) Generation | Query `GET /api/v1/subscribers/:id/soa` | Aggregates active services, open invoices, 5-bucket AR aging, and running ledger | Statement generated with `SOA-SUB-YYYYMM-XXXX-YYYYMMDD`<br>Mathematical running balance matches ledger lines | **PASS** |

---

## 5. PRODUCT.md Section 33: Critical Failure Prevention Audit

Before release sign-off, all 14 failure risks itemized in **PRODUCT.md Section 33** were subjected to rigorous programmatic auditing:

| # | Critical Failure Risk | Architectural Defense & Implementation | Automated Verification Result |
| :---: | :--- | :--- | :--- |
| **1** | **Destructive deletion of posted payments** | Hard deletes (`DELETE FROM payments`) are strictly prohibited in code and API routes. Soft reversal (`is_reversed = true`) preserves the physical payment record, links a `payment_reversals` entity, and logs audit reasons. | **VERIFIED:** Database audit confirmed zero dropped payment records; 100% of reversed payments retained. |
| **2** | **Incorrect ledger balances** | Floating-point math is banned. All monetary fields use integer centavos (`bigint`). Every credit/debit transaction calculates and stores `balance_after_centavos` using pure domain double-entry accounting. | **VERIFIED:** All subscriber ledger entries checked; all debit, credit, and balance values are exact integers. |
| **3** | **Shared database-file architecture** | SQLite, MS Access, and shared `.db` files are strictly banned. BCIS employs a multi-connection PostgreSQL client-server architecture with connection pooling (`pg.Pool`). | **VERIFIED:** Verified active PostgreSQL connection pool with client-server isolation over TCP. |
| **4** | **Plaintext passwords** | All user credentials are encrypted using memory-hard Argon2id (`$argon2id$v=19$m=65536,t=3,p=4$`). Plaintext storage is impossible. | **VERIFIED:** 100% of user password hashes verified to match Argon2id cryptographic format. |
| **5** | **Direct PostgreSQL access from Electron** | Electron renderer process is sandboxed without Node.js integration. All database interactions are mediated via Fastify 5 REST API using authenticated HTTP calls. | **VERIFIED:** Renderer codebase audited; zero database credentials or SQL query modules present in frontend. |
| **6** | **Missing server-side authorization** | Every API route is protected by `fastify.authenticate` and `requirePermission()` preHandlers. Client-side role checks are strictly UX-level; server enforces security boundaries. | **VERIFIED:** Unauthenticated and under-privileged requests consistently rejected with HTTP 401 and 403. |
| **7** | **Unvalidated financial inputs** | Zod schemas enforce integer values (`z.number().int().nonnegative()`) on all monetary inputs, rejecting floating points (e.g. `999.50`) and negative values. | **VERIFIED:** Submitting `amountCentavos: 999.5` immediately rejected with HTTP 400 Validation Error. |
| **8** | **Unsafe proof-file handling** | GCash proof attachments are validated for MIME type, sanitized to prevent directory traversal, stored in isolated upload directories, and served via controlled API routes. | **VERIFIED:** Traversal paths (`../../`) rejected; file paths stored as relative safe paths. |
| **9** | **Duplicate invoices** | PostgreSQL unique partial index `unique_active_invoice_per_period` on `(service_account_id, billing_period_start, billing_period_end)` prevents duplicate invoices per cycle. | **VERIFIED:** Database index presence confirmed; duplicate billing attempts trigger HTTP 409 Conflict. |
| **10** | **Reused receipt numbers** | Official Receipt numbers follow monotonic format `OR-YYYYMM-XXXX` governed by PostgreSQL advisory locks and unique database constraints. | **VERIFIED:** Unique constraint checked; zero duplicate receipt numbers allowed across all tests. |
| **11** | **Duplicate GCash references** | `reference_number` has a unique constraint in `gcash_transactions`. The API checks for existing references and returns HTTP 409 Conflict before file ingestion. | **VERIFIED:** Tested with re-submitted GCash reference; second submission blocked with 409 Conflict. |
| **12** | **Silently hidden collector shortages** | Collector remittance reconciliation engine calculates variance (`expected - remitted`). Shortages transition batch to `RECONCILED_WITH_SHORTAGE` and block closure without supervisor override. | **VERIFIED:** Batches with shortages cannot be closed normally; explicit audit log `REMITTANCE_SHORTAGE_DETECTED` created. |
| **13** | **Untested backup and restore** | Complete system backup creates topological SQL dump with SHA-256 integrity hash. Restore script truncates and repopulates all 24 tables with 100% row count parity. | **VERIFIED:** Full backup and restore executed cleanly; pre/post row count verification yielded 100% parity. |
| **14** | **Static UI without real financial workflows** | Electron UI binds to reactive hooks querying live Fastify REST endpoints. Financial events (payments, reversals, dunning) trigger real-time state synchronization. | **VERIFIED:** End-to-end simulation confirms desktop client API client integrates with live backend workflows. |

---

## 6. Multi-Workstation LAN Concurrency Verification (AT-09 Evidence)

To prove reliability in a 3-PC local office environment, `apps/api/test/concurrency.test.ts` simulated concurrent load across three distinct workstations:
1. **Workstation 1 (Admin Office):** Bulk billing generation for multiple service accounts.
2. **Workstation 2 (Cashier Counter):** High-frequency payment posting and official receipt generation.
3. **Workstation 3 (Operations Desk):** Creation, assignment, and completion of field service orders.

### 6.1 Test Results

```text
 ✓ test/concurrency.test.ts (5 tests) 1148ms
   ✓ AT-09: Simultaneous Multi-PC LAN Operation (3 Workstations) > simultaneously processes Billing Generation (PC1), Payment Posting (PC2), and Service Orders (PC3) without deadlocks or sequence collisions (348ms)
   ✓ AT-09: Simultaneous Multi-PC LAN Operation (3 Workstations) > handles 10 concurrent payments on the same subscriber with strict FIFO allocation and monotonic OR sequencing (274ms)
   ✓ AT-09: Simultaneous Multi-PC LAN Operation (3 Workstations) > handles concurrent GCash submissions with duplicate reference collision prevention (188ms)
   ✓ AT-09: Simultaneous Multi-PC LAN Operation (3 Workstations) > handles concurrent billing generation for identical period with duplicate guard (152ms)
   ✓ AT-09: Simultaneous Multi-PC LAN Operation (3 Workstations) > maintains double-entry ledger balance integrity under concurrent transactions (186ms)
```

### 6.2 Key Concurrency Safeguards

- **Advisory Transaction Locks (`pg_advisory_xact_lock`):** Prevents sequence number collision during simultaneous receipt (`OR-YYYYMM-XXXX`), invoice (`INV-YYYYMM-XXXX`), and payment (`PAY-YYYYMM-XXXX`) generation.
- **Row-Level Locking (`FOR UPDATE`):** Locks open invoices during FIFO allocation so concurrent cashier payments on the same subscriber account cannot double-allocate funds.
- **Database Transactions (`BEGIN ... COMMIT`):** Every mutation wraps payment, receipt, allocation, and ledger updates in an atomic transaction; failures trigger automatic rollback.

---

## 7. Statement of Account (SOA) Specification & Proof

The Statement of Account endpoint (`GET /api/v1/subscribers/:id/soa`) provides a legally defensible summary aggregating:
1. **Subscriber & Contact Details:** Account number, subscriber name, billing address.
2. **Active Services & Plan Rates:** Service accounts, bundled plans, monthly recurring rates.
3. **5-Bucket AR Aging Breakdown:**
   - Current (Not yet due)
   - 1 – 30 Days Overdue
   - 31 – 60 Days Overdue
   - 61 – 90 Days Overdue
   - Over 90 Days Overdue
4. **Open Invoices:** List of unpaid or partially paid invoices with issue date, due date, total due, allocated amount, and remaining balance.
5. **Chronological Transaction Ledger:** Running debits, credits, and post-transaction balances.

### 7.1 Mathematical Balance Proof

In `AT-14`, the SOA running balance was verified against every individual ledger transaction:

$$\text{Current Balance} = \sum (\text{Debit Centavos} - \text{Credit Centavos}) = \text{Balance After Centavos of Last Entry}$$

The test verified that the computed `soa.currentBalanceCentavos` matched the running ledger balance with zero centavo discrepancy.

---

## 8. Backup & Disaster Recovery Specification (AT-12)

### 8.1 Topological Table Hierarchy

To guarantee zero foreign key violations during restore, tables are exported in topological dependency order and restored in reverse order:

```text
 1. roles                        13. invoices
 2. permissions                  14. invoice_items
 3. role_permissions             15. payments
 4. users                        16. payment_allocations
 5. user_roles                   17. receipts
 6. service_types                18. payment_reversals
 7. service_plans                19. gcash_transactions
 8. collection_areas             20. subscriber_ledger
 9. collection_routes            21. collection_batches
10. subscribers                  22. service_orders
11. subscriber_addresses         23. dunning_notices
12. service_accounts             24. audit_logs
```

### 8.2 Cryptographic Verification

- **Snapshot File:** `./data/backups/bcis_backup_YYYYMMDD_HHMMSS.sql`
- **Metadata File:** `./data/backups/bcis_backup_YYYYMMDD_HHMMSS.meta.json`
- **Checksum:** Cryptographic SHA-256 digest computed across the entire SQL dump content.
- **Integrity Gate:** `POST /api/v1/system/restore` recomputes the SHA-256 hash before executing SQL statements; corrupted files are rejected with HTTP 422 Unprocessable Entity.

---

## 9. Verification Sign-Off & Release Recommendation

All 14 Acceptance Criteria (AT-01 through AT-14) have been implemented, verified with automated end-to-end tests, and audited against the 14 Critical Failure Prevention standards of PRODUCT.md Section 33.

The system is certified **READY FOR LIVE DEFENSE** and meets all requirements for a defensible, production-grade business system.
