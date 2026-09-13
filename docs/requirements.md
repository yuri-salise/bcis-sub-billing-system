# BCIS Subscription Billing and Collection System — System Requirements Specification (SRS)

## 1. Document Control & Project Overview
- **System Name**: Bukidnon Cable and Internet Services (BCIS) Subscription Billing and Collection System
- **Document Version**: 1.0.0
- **Status**: Approved Foundation Specification
- **Target Platform**: Windows 10/11 Desktop Workstations connected via Local Area Network (LAN)

### 1.1 Business Context
Bukidnon Cable and Internet Services (BCIS) is a regional telecommunications and cable television provider operating in Bukidnon, Philippines. BCIS provides fixed broadband internet, cable television (CATV), and bundled (combo) connectivity to residential and commercial subscribers across multiple municipal areas and barangays.

Currently, billing and field collection operations face critical bottlenecks:
- Inefficient manual ledger reconciliation between field collectors and central cashiers.
- Risk of human error in calculating subscriber balances, prorations, and arrears.
- Lack of duplicate detection for GCash payments and screenshot submissions.
- Absence of real-time visibility into delinquent accounts and aging accounts receivable.
- Inadequate audit trails for reversed transactions or voided billings.

The BCIS Subscription Billing and Collection System provides a high-reliability, multi-workstation desktop solution that centralizes subscriber accounts, automates monthly billing cycles, enforces financial precision, streamlines payment receipting, and standardizes field collector remittances.

---

## 2. Operational Environment & Multi-User Architecture

The system operates across three simultaneous physical workstations connected via an office Local Area Network (LAN):

```text
┌─────────────────────────────────────────────────────────────┐
│                      LOCAL OFFICE LAN                       │
├─────────────────┬─────────────────────────┬─────────────────┤
│  Workstation 1  │      Workstation 2      │  Workstation 3  │
│ Owner / Admin   │         Cashier         │   Operations    │
│  (Desktop App)  │      (Desktop App)      │  (Desktop App)  │
└────────┬────────┴────────────┬────────────┴────────┬────────┘
         │                     │                     │
         └─────────────────────┼─────────────────────┘
                               ▼
        ┌──────────────────────────────────────────┐
        │        CENTRAL SERVER WORKSTATION        │
        │  ├── Fastify API Server (Port 4000)      │
        │  ├── PostgreSQL Database (Port 5432)     │
        │  ├── Attachments Repository (Disk)       │
        │  ├── Automated Daily Backups             │
        │  └── System & Audit Log Storage          │
        └──────────────────────────────────────────┘
```

### Workstation Roles:
1. **PC 1 (Owner / Super Admin)**: System configuration, employee/role management, high-level financial reporting, payment reversals, audit log inspection, backup/restore operations.
2. **PC 2 (Cashier)**: High-speed counter payment entry, official receipt issuance, GCash verification, customer balance inquiry, cash drawer closing.
3. **PC 3 (Operations / Field Coordinator)**: Subscriber onboarding, service account provisioning, field collector assignment, route sheet printing, collection batch issuance, and remittance reconciliation.

---

## 3. User Roles and Personas

| Role Name | Description | Primary Responsibilities |
| :--- | :--- | :--- |
| **Owner / Super Admin** | Business owner and executive manager | Full administrative access, system configuration, audit logs, backup/restore, reversal approval. |
| **Administrator** | Office operations manager | User account management, plan setup, billing cycle runs, report generation. |
| **Cashier** | Front-desk billing teller | Receive counter payments (Cash/GCash/Bank), issue Official Receipts, verify GCash queue. |
| **Collection Supervisor** | Field operations head | Manage collection areas, assign collectors, open/close collection batches, reconcile collector remittances. |
| **Accounting / Auditor** | Financial officer | Inspect subscriber ledgers, review AR aging, audit reversals and credit adjustments, export financial reports. |
| **Technician** | Field technician | View service installation work orders, record service suspensions and physical disconnections/reconnections. |
| **Read-only Viewer** | Trainee or external auditor | Read-only access to subscriber profiles, service catalogs, and non-sensitive dashboards. |

---

## 4. Functional Requirements

### Module 1: Authentication & Access Control (REQ-AUTH)
- **REQ-AUTH-01**: The system shall authenticate users using a unique username and password.
- **REQ-AUTH-02**: Passwords shall be cryptographically hashed using Argon2id or bcrypt (work factor >= 12) before persistence. Plaintext passwords must never be logged or stored.
- **REQ-AUTH-03**: The API server shall issue cryptographically signed, expiring session tokens (JWT or secure session tokens).
- **REQ-AUTH-04**: The desktop client shall provide a quick "Screen Lock" function allowing cashiers and operators to secure the screen when stepping away without terminating the authenticated session.
- **REQ-AUTH-05**: The system shall enforce automatic account lockout after 5 consecutive failed login attempts, requiring administrative unlock or a 15-minute exponential backoff.
- **REQ-AUTH-06**: Every API request mutating or retrieving protected resources shall enforce server-side Role-Based Access Control (RBAC).

### Module 2: Subscriber Profile Management (REQ-SUB)
- **REQ-SUB-01**: The system shall assign each subscriber an immutable, auto-generated account number following the format `SUB-YYYYMM-XXXX`.
- **REQ-SUB-02**: The subscriber record shall capture full legal name, trade name/business name (if commercial), contact telephone numbers, email address, national ID/tax ID (optional), and billing address.
- **REQ-SUB-03**: The system shall support one subscriber entity owning multiple service accounts (e.g., home internet + business cable + secondary rental property).
- **REQ-SUB-04**: Subscriber records shall support statuses: `ACTIVE`, `INACTIVE`, `TERMINATED`, `ARCHIVED`.
- **REQ-SUB-05**: Deletion of subscriber records with historical billing or payment history shall be prohibited. Historical subscribers may only be transitioned to `ARCHIVED`.
- **REQ-SUB-06**: Global search shall locate subscribers within <300ms using subscriber name, account number, phone number, installation address, invoice number, or receipt number.

### Module 3: Service Catalog & Service Accounts (REQ-SRV)
- **REQ-SRV-01**: The system shall manage service plans across three primary categories: `INTERNET`, `CABLE_TV`, and `COMBO`.
- **REQ-SRV-02**: Service plans shall define code, display name, monthly recurring charge (MRC in integer centavos), installation fees, bandwidth speed (Mbps for internet), channel count (for CATV), and active status.
- **REQ-SRV-03**: Changing a plan's price shall version the plan or affect future billings only. Existing historical invoices must never be retroactively modified.
- **REQ-SRV-04**: Each service account shall record installation physical address, GPS coordinates (optional), activation date, billing cycle anchor day (e.g., 1st, 15th), assigned collection area, and assigned collector.
- **REQ-SRV-05**: Service account statuses shall support: `PENDING_INSTALL`, `ACTIVE`, `TEMPORARILY_DISCONNECTED`, `SUSPENDED`, `TERMINATED`.

### Module 4: Billing Engine & Invoicing (REQ-BILL)
- **REQ-BILL-01**: The billing engine shall generate monthly invoices either in automated batches per billing cycle or on-demand for individual service accounts.
- **REQ-BILL-02**: Invoice numbering shall follow a unique, sequential pattern: `INV-YYYYMM-XXXXXX`.
- **REQ-BILL-03**: Each invoice shall record service account ID, billing period start and end dates, issue date, due date, itemized charges (plan recurring fee, prorated fee, installation balance, penalties), subtotal, VAT (if applicable), and total due.
- **REQ-BILL-04**: **Duplicate Billing Prevention**: The system shall enforce a database-level unique constraint preventing the creation of more than one non-void invoice for the same `(service_account_id, billing_period_start, billing_period_end)`.
- **REQ-BILL-05**: Invoices shall transition through strict lifecycle states: `DRAFT`, `UNPAID`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `VOID`, `CREDITED`.
- **REQ-BILL-06**: Finalized invoices are strictly immutable. Adjustments or cancellations require an authorized credit/debit adjustment or void workflow with mandatory reason documentation.

### Module 5: Payments, Allocations & Official Receipts (REQ-PAY)
- **REQ-PAY-01**: The system shall support payment methods: `CASH`, `GCASH`, `BANK_TRANSFER`, `CHECK`.
- **REQ-PAY-02**: **FIFO Payment Allocation**: Payments shall automatically allocate against the oldest outstanding unpaid or partially paid invoice first, covering overdue balances before current charges.
- **REQ-PAY-03**: **Partial & Advance Payments**:
  - If payment < total outstanding balance: apply to oldest invoices sequentially; mark final allocated invoice as `PARTIALLY_PAID`; record remaining balance.
  - If payment > total outstanding balance: satisfy all unpaid invoices (marking them `PAID`); credit the remaining excess amount to the subscriber's advance balance / unallocated credit account.
- **REQ-PAY-04**: **Official Receipt Generation**: Every successfully posted payment shall immediately generate an Official Receipt with sequential number `OR-YYYY-XXXXXX`, detailing payer name, payment date, line items paid, cashier name, payment method, and amount in words and figures.
- **REQ-PAY-05**: **ACID Posting Transaction**: The entire payment posting sequence (payment creation, allocation creation, invoice status update, ledger credit entry, advance balance update, receipt creation, audit entry) must execute atomically within a single PostgreSQL transaction.
- **REQ-PAY-06**: **Payment Reversals**: An authorized supervisor or administrator may reverse an erroneous payment. The reversal must restore all affected invoice balances to their prior state, zero out the receipt status (`REVERSED`), record compensatory ledger entries, and require a mandatory audit reason. The original payment record must never be deleted.

### Module 6: GCash Verification Workflow (REQ-GCASH)
- **REQ-GCASH-01**: The system shall provide a dedicated GCash transaction intake queue for payments submitted via customer screenshot or digital SMS notification.
- **REQ-GCASH-02**: Captures GCash reference number (e.g., 13-digit reference), sender mobile number, sender name, payment amount, transfer timestamp, and uploaded image proof.
- **REQ-GCASH-03**: **Deduplication Enforcement**: The system shall strictly reject or flag any GCash transaction whose reference number already exists in the database.
- **REQ-GCASH-04**: GCash queue records shall support states: `PENDING_VERIFICATION`, `VERIFIED`, `REJECTED`.
- **REQ-GCASH-05**: Verification shall be performed via a dual-pane UI where the cashier inspects the screenshot side-by-side with subscriber billing history before clicking "Verify & Post Payment".

### Module 7: Field Collection & Remittance Management (REQ-COL)
- **REQ-COL-01**: The system shall organize subscribers into geographic Collection Areas and Routes (e.g., Barangay Poblacion Zone 1, Manolo Fortich Route A).
- **REQ-COL-02**: Field collectors shall be assigned to designated collection areas and accounts.
- **REQ-COL-03**: The system shall generate printable Route Sheets / Field Collection Lists containing subscriber names, addresses, account numbers, and current arrears.
- **REQ-COL-04**: Collection activities shall be managed in **Collection Batches** with states: `OPEN`, `IN_PROGRESS`, `SUBMITTED`, `REMITTED`, `RECONCILED`, `CLOSED`.
- **REQ-COL-05**: **Remittance Reconciliation**:
  - `Expected Cash` = Sum of all cash payments logged in the batch.
  - `Remitted Cash` = Actual physical currency handed in by the collector.
  - `Difference` = `Expected Cash` - `Remitted Cash`.
  - Positive difference represents a **Cash Shortage**; negative difference represents an **Overage**.
- **REQ-COL-06**: Batches with a cash shortage cannot be closed as "Balanced". The shortage must be logged against the collector's shortage ledger and signed off by the Collection Supervisor.

### Module 8: Receivables, Arrears & Service Control (REQ-REC)
- **REQ-REC-01**: The system shall automatically categorize all unpaid balances into standard Accounts Receivable (AR) aging buckets:
  - `Current` (not yet due)
  - `1–30 Days Past Due`
  - `31–60 Days Past Due`
  - `61–90 Days Past Due`
  - `Over 90 Days Past Due`
- **REQ-REC-02**: Accounts reaching 60+ days overdue (or two consecutive unpaid billing cycles) shall be automatically flagged as `Suspension Candidates`.
- **REQ-REC-03**: The system shall support creating formal `Suspension Work Orders` detailing delinquent balance, notice date, technician assignment, and suspension status.
- **REQ-REC-04**: When a suspended subscriber settles their overdue balance (or enters an approved installment plan) and pays the configured `Reconnection Fee`, the system shall generate a `Reconnection Work Order`.
- **REQ-REC-05**: All service suspensions, restorations, and rate adjustments shall be preserved permanently in the subscriber's Service History log.

### Module 9: Reporting & Management Analytics (REQ-REP)
- **REQ-REP-01**: The system shall generate 12 mandatory core reports:
  1. Daily Collection Report (itemized by cashier and payment method).
  2. Weekly Collection Summary.
  3. Monthly Collection & Revenue Report.
  4. Annual Revenue & Collection Performance.
  5. Billing vs. Collection Efficiency Report.
  6. Accounts Receivable (AR) Aging Summary and Detailed Breakdown.
  7. Subscriber Statement of Account (SOA) for printing/billing delivery.
  8. Master Subscriber List (filtered by status, area, and plan).
  9. Collector Remittance & Shortage/Overage Report.
  10. Collector Performance & Commission Report.
  11. Payment Reversals and Adjustments Log.
  12. System Audit & User Activity Log.
- **REQ-REP-02**: All financial and tabular reports shall be exportable to both **PDF** (ready for print) and **Excel XLSX** formats.

### Module 10: Audit Trail, Backup & System Administration (REQ-SYS)
- **REQ-SYS-01**: The system shall maintain an immutable, append-only `audit_logs` table recording all create, update, delete, void, reversal, and authentication events.
- **REQ-SYS-02**: Audit records shall capture timestamp, user ID, user display name, IP address/workstation name, action type, entity name, entity ID, previous state snapshot (JSON), new state snapshot (JSON), and explicit reason description.
- **REQ-SYS-03**: The system shall provide an automated daily database backup utility using PostgreSQL native `pg_dump`, as well as manual on-demand backup triggers.
- **REQ-SYS-04**: The system shall support safe backup restoration with pre-flight database integrity validation and connection dropping.

---

## 5. Non-Functional Requirements (NFR)

### 5.1 Performance & Scalability
- **NFR-PERF-01**: Standard queries (subscriber search, invoice lookup, payment history) shall return results in less than 500 milliseconds across the office LAN.
- **NFR-PERF-02**: Batch billing generation for up to 5,000 active subscribers shall complete in under 60 seconds without locking the database against cashier counter queries.
- **NFR-PERF-03**: The system must sustain concurrent operations from all 3 office workstations (e.g., Cashier posting a payment while Operations reconciles a batch and Admin runs an AR report) without deadlock or data inconsistency.

### 5.2 Financial Precision & Calculation Integrity
- **NFR-FIN-01**: All monetary calculations in code and database schemas must use integer centavos (PHP 1.00 = 100 centavos) or PostgreSQL `NUMERIC(12, 2)`.
- **NFR-FIN-02**: Standard JavaScript floating-point arithmetic (`0.1 + 0.2 === 0.30000000000000004`) is strictly forbidden in financial services.
- **NFR-FIN-03**: Total debits must equal total credits across the subscriber ledger at all times.

### 5.3 Security & Hardening
- **NFR-SEC-01**: Electron security architecture must enforce `contextIsolation: true` and `nodeIntegration: false`. No Node.js native bindings or direct PostgreSQL drivers shall be bundled into the renderer.
- **NFR-SEC-02**: Server-side authorization must protect all API endpoints. Client-side UI element hiding is purely for user experience and does not constitute a security boundary.
- **NFR-SEC-03**: All SQL operations must utilize parameterized queries via Drizzle ORM to eliminate SQL injection vulnerabilities.

### 5.4 Usability & Presentation
- **NFR-UI-01**: The desktop interface shall adhere to the BCIS visual design system: Deep Navy primary (`#0F2747`), Royal Blue accent (`#2563EB`), Light Neutral background (`#F6F8FB`), with crisp typography and tabular numerals for financial figures.
- **NFR-UI-02**: High-frequency cashier operations (payment entry and receipt printing) must be fully keyboard-navigable for rapid processing.

---

## 6. Acceptance Criteria Traceability (AT-01 through AT-12)

| Code | Test Scenario | Acceptance Criteria |
| :--- | :--- | :--- |
| **AT-01** | Exact Payment | ₱999 invoice paid with ₱999 cash -> remaining balance ₱0, invoice `PAID`, receipt created, ledger balanced. |
| **AT-02** | Partial Payment | ₱999 invoice paid with ₱500 cash -> remaining balance ₱499, invoice `PARTIALLY_PAID`, ledger updated. |
| **AT-03** | Advance Payment | ₱1,000 monthly bill paid with ₱3,000 -> invoices satisfied, excess ₱2,000 credited to subscriber advance account. |
| **AT-04** | Oldest-First FIFO Allocation | August bill ₱999, September bill ₱999. Payment of ₱1,200 -> August balance ₱0 (`PAID`), September balance ₱798. |
| **AT-05** | Duplicate GCash Reference | Submitting an existing GCash reference number is blocked with HTTP 409 Conflict. |
| **AT-06** | Payment Reversal | Reversing a ₱500 payment restores invoice balance, voids receipt, logs audit reason, preserves historical record. |
| **AT-07** | Balanced Remittance | Expected cash ₱20,000, remitted cash ₱20,000 -> difference ₱0, batch transitions to `RECONCILED` and `CLOSED`. |
| **AT-08** | Collector Shortage | Expected cash ₱20,000, remitted cash ₱19,500 -> shortage ₱500 recorded, cannot silently close as balanced. |
| **AT-09** | Concurrent Multi-PC Operation | Admin runs billing while Cashier posts payments -> zero deadlocks, sequential numbering intact. |
| **AT-10** | Server-Side RBAC Enforcement | Direct API call with Cashier token to `/api/v1/users` returns HTTP 403 Forbidden. |
| **AT-11** | Duplicate Billing Protection | Triggering monthly billing run twice for the same period results in 0 duplicate invoices created. |
| **AT-12** | Backup & Recovery Integrity | Database dump created, corrupted, restored from dump -> table row counts and hash integrity verified. |
