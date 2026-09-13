# BCIS Subscription Billing and Collection System
# Implementation Plan for Google Antigravity

## 1. Project Overview

Build a professional Windows desktop Subscription Billing and Collection System for Bukidnon Cable and Internet Services (BCIS).

The system must support three simultaneous office PCs connected through a LAN.

Target architecture:

```text
PC 1: Owner/Admin Desktop ─────┐
PC 2: Cashier Desktop ──────────┼── LAN ──> Fastify API Server ──> PostgreSQL
PC 3: Operations Desktop ───────┘                 │
                                                 ├── Attachments
                                                 ├── Backups
                                                 └── Audit / Logs
```

Important architectural rule:

- The application is a Windows desktop application.
- The desktop client is built with Electron + React + TypeScript.
- The Electron renderer must NOT connect directly to PostgreSQL.
- All business operations go through the Fastify API.
- PostgreSQL is the centralized database.
- The server is responsible for authorization, validation, financial rules, transactions, and auditing.

This project is not a static CRUD application. Financial correctness, data integrity, security, auditability, concurrent users, reporting, backup/restore, and service workflows are core requirements.

---

# 2. Technology Stack

## Desktop Application

- Electron 44.x
- electron-vite
- electron-builder
- React 19.2
- TypeScript strict
- Tailwind CSS 4
- shadcn/ui
- TanStack Table
- TanStack Query
- React Hook Form

## Backend/API

- Fastify 5
- TypeScript
- Zod 4
- Drizzle ORM
- Pino

## Database

- PostgreSQL

## Reporting

- ExcelJS
- pdfmake

## Testing

- Vitest
- Fastify/API integration tests
- Playwright Electron

---

# 3. Development Principles

1. Implement incrementally.
2. Do not build the entire system in one task.
3. Build feature-sized tasks.
4. Inspect existing code before changing it.
5. Keep financial rules in backend/domain services.
6. Keep UI components focused on presentation and user interaction.
7. Use PostgreSQL transactions for multi-step financial operations.
8. Use exact monetary calculations with integer centavos or NUMERIC/DECIMAL.
9. Never use JavaScript floating-point arithmetic for authoritative money calculations.
10. Every schema change must use a migration.
11. Never silently delete or overwrite posted financial records.
12. Correct posted transactions through reversal/adjustment workflows.
13. Use server-side authorization.
14. UI permission hiding is not authorization.
15. Validate all external inputs.
16. Use synthetic/demo data only.
17. Keep meaningful Git history.
18. Add tests together with important features.
19. Update documentation when architecture or business rules change.
20. Never claim a feature is complete without running verification.

---

# 4. Recommended Repository Structure

```text
BCIS-Subscription-Billing-System/
│
├── apps/
│   ├── desktop/
│   │   ├── electron/
│   │   ├── preload/
│   │   └── src/
│   │       ├── app/
│   │       ├── components/
│   │       ├── features/
│   │       │   ├── auth/
│   │       │   ├── dashboard/
│   │       │   ├── subscribers/
│   │       │   ├── services/
│   │       │   ├── billing/
│   │       │   ├── payments/
│   │       │   ├── collections/
│   │       │   ├── receivables/
│   │       │   ├── service-control/
│   │       │   ├── reports/
│   │       │   └── administration/
│   │       ├── hooks/
│   │       ├── lib/
│   │       └── routes/
│   │
│   └── api/
│       └── src/
│           ├── modules/
│           │   ├── auth/
│           │   ├── users/
│           │   ├── subscribers/
│           │   ├── services/
│           │   ├── billing/
│           │   ├── payments/
│           │   ├── collections/
│           │   ├── receivables/
│           │   ├── service-control/
│           │   ├── reports/
│           │   └── administration/
│           ├── db/
│           ├── plugins/
│           ├── middleware/
│           ├── utils/
│           └── server.ts
│
├── packages/
│   ├── shared-types/
│   ├── validation/
│   ├── domain/
│   └── config/
│
├── database/
│   ├── migrations/
│   ├── seeds/
│   └── schema/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   ├── security/
│   └── acceptance/
│
├── docs/
│   ├── requirements.md
│   ├── architecture.md
│   ├── business-rules.md
│   ├── rbac-matrix.md
│   ├── api-design.md
│   ├── database-design.md
│   ├── testing-strategy.md
│   ├── security-review.md
│   ├── deployment-guide.md
│   └── architecture-decisions.md
│
├── reports-samples/
├── release/
├── .agents/
│   ├── rules/
│   └── skills/
│
├── .env.example
├── .gitignore
├── README.md
└── package.json
```

---

# 5. Google Antigravity Project Rules

Create:

```text
.agents/rules/bcis-project.md
```

The rule file should enforce:

- the required technology stack;
- Electron security requirements;
- API-only database access;
- server-side RBAC;
- transactional financial posting;
- exact money calculations;
- migration-only schema changes;
- immutable posted financial history;
- audit logging;
- synthetic demo data;
- test-first handling of important financial rules;
- meaningful Git history;
- documentation updates.

Use the following development loop for every feature:

```text
Read requirement
      ↓
Inspect architecture
      ↓
Identify domain/data/security impact
      ↓
Implement smallest coherent feature
      ↓
Migration + validation
      ↓
Tests
      ↓
Typecheck
      ↓
Lint
      ↓
Review diff
      ↓
Review financial/security impact
      ↓
Update documentation
      ↓
Commit
```

---

# 6. Core Domain Modules

## 6.1 Authentication and Security

Implement:

- users
- roles
- permissions
- role permissions
- user roles
- login
- logout
- session handling
- session lock
- failed-login handling
- active/inactive users
- password hashing

Required roles:

- Owner / Super Admin
- Administrator
- Cashier
- Collection Supervisor
- Accounting / Auditor
- Technician
- Read-only Viewer

Use granular permissions such as:

```text
subscriber.view
subscriber.create
subscriber.update

billing.view
billing.generate
billing.adjust
billing.void

payment.view
payment.create
payment.reverse

collection.view
collection.create
collection.reconcile

report.view
report.export

user.manage
audit.view
backup.restore
```

Server-side authorization is mandatory.

---

# 7. Database Design

Required business concepts:

## Security

```text
users
roles
permissions
role_permissions
user_roles
```

## Subscribers

```text
subscribers
subscriber_addresses
subscriber_contacts
```

## Services

```text
service_types
service_plans
service_accounts
service_events
```

## Billing

```text
billing_cycles
invoices
invoice_items
adjustments
```

## Payments

```text
payments
payment_allocations
payment_proofs
payment_reversals
receipts
```

## Collections

```text
collection_areas
collector_assignments
collection_batches
batch_accounts
collector_remittances
```

## Service Control

```text
suspension_records
reconnection_records
```

## System

```text
audit_logs
application_settings
backup_history
```

Minimum relationships:

```text
Subscriber
    1
    |
    | many
    v
ServiceAccount
    1
    |
    | many
    v
Invoice
    1
    |
    | many
    v
InvoiceItem
```

Payments and invoices:

```text
Invoice >──< Payment
          through
       PaymentAllocation
```

Collections:

```text
Collector
   |
   | many
   v
CollectionBatch
   |
   | many
   v
CollectionBatchAccount
```

Service history:

```text
ServiceAccount
    |
    +── ServiceEvent
    +── SuspensionRecord
    +── ReconnectionRecord
```

---

# 8. Database Rules

Implement database constraints for:

- unique subscriber account number;
- unique service account number;
- unique invoice number;
- duplicate billing protection by service account + billing period;
- unique receipt number;
- GCash duplicate detection;
- foreign keys;
- required relationships;
- indexes for common searches.

Recommended indexes:

```text
subscribers.account_number
subscribers.name
subscribers.contact_number

service_accounts.account_number
service_accounts.status
service_accounts.collector_id

invoices.invoice_number
invoices.due_date
invoices.status
invoices.service_account_id
invoices.billing_period

payments.payment_date
payments.reference_number
payments.payment_method

collection_batches.collector_id
collection_batches.status

collection_areas.name
```

---

# 9. Financial Domain Rules

## 9.1 Money

Use:

- integer centavos, or
- PostgreSQL NUMERIC/DECIMAL

Never rely on JavaScript floating-point arithmetic for authoritative financial calculations.

## 9.2 Ledger

The ledger must be reproducible.

Typical example:

```text
Date        Reference   Description          Debit    Credit   Balance
2026-09-01  INV-1001    September Internet   999.00   0.00     999.00
2026-09-05  RCPT-5001   Cash Payment           0.00 500.00     499.00
2026-09-20  RCPT-5110   GCash Payment          0.00 499.00       0.00
```

## 9.3 Billing

Invoice states:

```text
DRAFT
UNPAID
PARTIALLY_PAID
PAID
OVERDUE
VOID
CREDITED
```

Rules:

- monthly invoice generation;
- historical billed rates are preserved;
- finalized invoices are immutable except controlled adjustment/void workflows;
- duplicate billing must be prevented.

## 9.4 Payment Allocation

Default:

```text
oldest unpaid invoice first
```

Support:

- exact payment;
- partial payment;
- advance payment;
- authorized manual allocation;
- payment reversal.

Payment posting should conceptually be:

```text
Validate
   ↓
Authorize
   ↓
Begin transaction
   ↓
Create payment
   ↓
Create allocations
   ↓
Update invoice statuses
   ↓
Create ledger entries
   ↓
Create receipt
   ↓
Create audit entry
   ↓
Commit
```

Any failure must roll back the complete operation.

---

# 10. GCash Workflow

Workflow:

```text
Customer submits proof
        ↓
Staff records transaction
        ↓
Check possible duplicate reference
        ↓
Staff verifies/rejects
        ↓
Verified payment is posted
        ↓
Payment is allocated
        ↓
Audit record created
```

Never automatically mark an account as paid just because a screenshot was uploaded.

Store:

- GCash reference;
- sender details;
- amount;
- submission date;
- proof attachment;
- verification status;
- verified by;
- verification timestamp;
- rejection reason if rejected.

---

# 11. Subscriber Management

Implement:

- subscriber registration;
- account number;
- name;
- contacts;
- addresses;
- collection area;
- assigned collector;
- billing day;
- due day;
- status;
- notes.

Support one subscriber owning:

- multiple service accounts;
- multiple service addresses.

Global search should support:

- account number;
- subscriber name;
- contact number;
- address;
- receipt number;
- invoice number;
- GCash reference.

Do not delete historical subscriber records.

Use statuses such as:

```text
ACTIVE
INACTIVE
TERMINATED
ARCHIVED
```

---

# 12. Plan and Service Account Management

Support:

- Internet plans;
- Cable plans;
- Combo plans.

Plan fields:

```text
code
name
price
fees
description
active
```

Optional type-specific attributes:

```text
Internet → speed
Cable   → channel count
```

Service account fields:

```text
service account number
subscriber
service type
plan
installation address
activation date
billing start date
billing day
current rate
status
collector
```

Plan price changes affect future bills only.

---

# 13. Collection Management

Implement:

- collection areas;
- routes;
- collector assignments;
- printable route sheets;
- collection batches;
- collected accounts;
- remittance;
- reconciliation;
- shortage/overage tracking;
- collector performance.

Batch states:

```text
OPEN
IN_PROGRESS
SUBMITTED
REMITTED
RECONCILED
CLOSED
```

Reconciliation:

```text
Expected Cash
      -
Remitted Cash
      =
Shortage / Overage
```

Example:

```text
Expected:   ₱20,000
Remitted:   ₱19,500
Difference:    ₱500 shortage
```

A shortage must remain visible and prevent silently closing as balanced.

---

# 14. Receivables and Aging

Dashboard metrics:

- current receivable;
- overdue receivable;
- number of overdue subscribers;
- accounts needing follow-up;
- accounts approaching suspension.

Aging buckets:

```text
Current
1–30
31–60
61–90
90+
```

Overdue list should display:

- subscriber;
- service;
- area;
- collector;
- months unpaid;
- oldest unpaid invoice;
- last payment;
- total arrears.

Filters:

- collector;
- area;
- plan;
- service type;
- delinquency age.

---

# 15. Suspension and Reconnection

Suspension requires:

- reason;
- effective date;
- approved by;
- notes.

Reconnection requires:

- qualifying payment;
- optional reconnection fee;
- technician assignment;
- request date;
- completion date.

Every service-state change must remain in service history.

---

# 16. Required Desktop Navigation

```text
Dashboard

Subscribers
├── All Subscribers
├── New Subscriber
└── Service Accounts

Billing
├── Current Billing
├── Generate Billing
└── Invoices

Payments
├── Receive Payment
├── Payment History
└── GCash Verification

Collections
├── Collectors
├── Areas & Routes
├── Collection Batches
└── Remittance

Receivables
├── Outstanding
├── Overdue
├── Aging
└── Suspension Candidates

Services

Reports

Administration
```

---

# 17. UI/UX Plan

Use a professional commercial ISP billing/operations style.

Recommended design tokens:

```text
Primary:       #0F2747
Accent Blue:   #2563EB
Canvas:        #F6F8FB
Surface:       #FFFFFF
Text Primary:  #0F172A
Text Secondary:#64748B
Success:       #059669
Warning:       #D97706
Danger:        #DC2626
```

Typography:

- Inter, Geist, or comparable professional sans-serif.

UI rules:

- financial values right-aligned;
- use tabular numerals;
- never communicate status using color alone;
- use text + color badges;
- visible form labels;
- required-field indicators;
- inline validation;
- sticky table headers;
- search/filter/sort/pagination;
- clean printing layouts.

Avoid:

- excessive gradients;
- oversized decorative cards;
- animated counters;
- unnecessary animations;
- generic dashboard-template styling.

---

# 18. Key Screens

## Dashboard

Show:

- 4–6 compact KPIs;
- billing vs collection;
- payment method summary;
- AR aging;
- collector performance;
- overdue alerts;
- recent payments.

## Subscriber Profile

Tabs:

```text
Overview
Services
Billing
Payments
Ledger
Collection
Service History
Documents
Audit
```

## Receive Payment

Optimize for cashier speed:

```text
Search subscriber
      ↓
Show current balance
      ↓
Enter payment amount
      ↓
Select payment method
      ↓
Preview allocation
      ↓
Post payment
      ↓
Print/preview receipt
```

## GCash Verification

Two-pane layout:

```text
┌────────────────────┬────────────────────────┐
│ Verification Queue │ Proof + Details        │
│                    │                        │
│ Reference          │ Proof image            │
│ Subscriber         │ Amount                 │
│ Amount             │ Sender                 │
│ Date               │ Reference              │
│ Status              │ Verify / Reject       │
└────────────────────┴────────────────────────┘
```

## Collector Reconciliation

Show:

```text
Expected Cash
Collected Cash
Remitted Cash
Non-Cash
Difference
Shortage / Overage
Accounts Collected
Exceptions
```

---

# 19. API Design

Organize API by domain.

Example:

```text
/api/v1/auth
/api/v1/users
/api/v1/roles
/api/v1/subscribers
/api/v1/service-plans
/api/v1/service-accounts
/api/v1/billing
/api/v1/invoices
/api/v1/payments
/api/v1/gcash
/api/v1/collections
/api/v1/receivables
/api/v1/suspensions
/api/v1/reconnections
/api/v1/reports
/api/v1/audit
/api/v1/backup
```

Use:

- clear request/response types;
- Zod schemas;
- consistent error format;
- pagination;
- filtering;
- sorting;
- permission checks;
- transaction handling.

Do not place business-critical rules inside route handlers if they belong in services/domain logic.

---

# 20. Electron Security

Required:

```text
contextIsolation = true
nodeIntegration = false
```

Use a narrow typed preload bridge.

Renderer should not receive:

- database credentials;
- server secrets;
- filesystem access beyond required controlled operations.

The renderer communicates with the API through a controlled client/service layer.

---

# 21. Audit Logging

For important mutations record:

```text
actor
action
date/time
entity
entity ID
reason
old values where appropriate
new values where appropriate
```

Audit examples:

```text
PAYMENT_POSTED
PAYMENT_REVERSED
INVOICE_VOIDED
INVOICE_ADJUSTED
GCASH_VERIFIED
GCASH_REJECTED
COLLECTION_RECONCILED
USER_PERMISSION_CHANGED
SERVICE_SUSPENDED
SERVICE_RECONNECTED
BACKUP_CREATED
BACKUP_RESTORED
```

Audit logs must not be editable through normal UI.

---

# 22. Reports

Implement at least:

1. Daily collection report
2. Weekly collection report
3. Monthly collection report
4. Annual collection report
5. Billing vs collection
6. AR aging
7. Subscriber Statement of Account
8. Subscriber master list
9. Collector remittance report
10. Collector performance report
11. Payment adjustment/reversal report
12. Audit/user activity report

Export:

- PDF
- XLSX

CSV can be included when useful.

---

# 23. Testing Strategy

## Unit Tests

Test financial/domain functions independently.

Examples:

- calculate invoice total;
- calculate remaining balance;
- determine invoice status;
- allocate payment;
- determine aging bucket;
- calculate collector difference.

## Integration Tests

Test:

- billing transaction;
- payment transaction;
- allocation;
- reversal;
- GCash verification;
- collector reconciliation;
- authorization;
- database constraints.

## E2E Tests

Use Playwright Electron for:

- login;
- subscriber creation;
- billing;
- payment;
- receipt;
- GCash verification;
- overdue workflow;
- collection reconciliation;
- reports.

---

# 24. Mandatory Acceptance Tests

## AT-01 Exact Payment

```text
Invoice: ₱999
Payment: ₱999

Expected:
Remaining = ₱0
Invoice = PAID
Ledger balanced
Receipt created
```

## AT-02 Partial Payment

```text
Invoice: ₱999
Payment: ₱500

Expected:
Remaining = ₱499
Invoice = PARTIALLY_PAID
Allocation correct
Ledger correct
```

## AT-03 Advance Payment

```text
Monthly bill: ₱1,000
Payment: ₱3,000

Expected:
Value is not lost
Advance/credit behavior follows documented policy
```

## AT-04 Oldest-First

```text
August: ₱999
September: ₱999
Payment: ₱1,200

Expected:
August = ₱0
September remaining = ₱798
```

## AT-05 Duplicate GCash

Attempt to post an already-used GCash reference.

Expected:

- blocked or explicitly warned according to documented policy.

## AT-06 Payment Reversal

Reverse an incorrectly posted payment.

Expected:

- original payment remains visible;
- reversal record exists;
- balances restore correctly;
- actor and reason are audited.

## AT-07 Balanced Collector Remittance

```text
Collected: ₱20,000
Remitted:  ₱20,000

Difference = ₱0
Batch may reconcile and close
```

## AT-08 Collector Shortage

```text
Collected: ₱20,000
Remitted:  ₱19,500

Expected shortage = ₱500
```

Do not silently close as balanced.

## AT-09 Concurrent Users

Two or three PCs perform valid operations simultaneously.

Expected:

- no corruption;
- no duplicate numbering;
- no unauthorized cross-session effect.

## AT-10 Authorization

A Cashier attempts an admin-only operation.

Expected:

- server rejects the request even if the API is called directly.

## AT-11 Duplicate Billing

Run billing generation twice for the same period.

Expected:

- no duplicate finalized invoice.

## AT-12 Backup/Restore

Create backup, modify data, restore approved backup.

Expected:

- database integrity passes;
- expected records return.

---

# 25. Demo Dataset

Seed synthetic data.

Minimum recommended:

```text
Users:              5+
Plans:              7+
Subscribers:        50+
Service Accounts:   60+
Collectors:         2+
Areas:              3
Billing Months:     3+
Overdue Accounts:   10+
Reversal/Void:      1+
Suspension cases:   2+
Reconnection cases: 2+
```

Include payment scenarios:

- cash;
- GCash;
- exact payment;
- partial payment;
- advance payment;
- overdue payment;
- reversed payment.

Never use real customer names, numbers, GCash information, passwords, or production data.

---

# 26. Development Phases

## Phase 0 — Discovery and Planning

Deliver:

```text
docs/requirements.md
docs/architecture.md
docs/business-rules.md
docs/rbac-matrix.md
docs/testing-strategy.md
docs/architecture-decisions.md
```

Do not build business features yet.

Checkpoint:

- architecture approved;
- module boundaries clear;
- financial rules documented.

---

## Phase 1 — Project Foundation

Build:

- monorepo;
- Electron shell;
- React;
- TypeScript strict;
- Fastify;
- PostgreSQL connection;
- Drizzle;
- migrations;
- environment handling;
- logging;
- lint;
- testing;
- health endpoint.

Checkpoint:

```text
Electron application launches.
API starts.
Database connects.
Health endpoint works.
```

---

## Phase 2 — Authentication and RBAC

Build:

- users;
- roles;
- permissions;
- login;
- logout;
- session handling;
- protected routes;
- server authorization;
- permission-aware navigation.

Checkpoint:

- seeded admin;
- working login;
- role matrix;
- authorization tests.

---

## Phase 3 — Subscribers, Plans, and Services

Build:

- plans;
- subscribers;
- contacts;
- addresses;
- service accounts;
- service statuses;
- service history;
- collector/area assignment;
- global search.

Checkpoint:

- full subscriber CRUD with validation;
- service account management;
- profile screen.

---

## Phase 4 — Billing and Ledger Engine

Build:

- billing cycles;
- invoice generation;
- invoice numbering;
- invoice items;
- due dates;
- statuses;
- ledger debit;
- duplicate billing protection.

Checkpoint:

- billing generator;
- invoice detail page;
- ledger;
- billing unit/integration tests.

---

## Phase 5 — Payments, Allocation, Receipts

Build:

- payment methods;
- payment creation;
- allocation engine;
- exact payments;
- partial payments;
- advance payments;
- oldest-first allocation;
- receipts;
- proof attachments;
- reversals;
- audit trail.

Checkpoint:

- payment screen;
- allocation preview;
- receipt;
- reversal workflow;
- AT-01 through AT-06 passing.

---

## Phase 6 — Collections

Build:

- collectors;
- collection areas;
- routes;
- assignments;
- collection batches;
- route sheets;
- collection records;
- remittance;
- reconciliation;
- shortage/overage.

Checkpoint:

- complete batch lifecycle;
- collector report;
- AT-07 and AT-08 passing.

---

## Phase 7 — Receivables and Service Control

Build:

- outstanding accounts;
- overdue accounts;
- AR aging;
- filters;
- suspension candidates;
- suspension records;
- reconnection workflow.

Checkpoint:

- aging report;
- overdue dashboard;
- service history.

---

## Phase 8 — Dashboard and Reports

Build:

- KPIs;
- billing vs collection;
- payment method summary;
- AR aging;
- collector performance;
- overdue alerts;
- reports;
- PDF;
- XLSX;
- print layouts.

Checkpoint:

- dashboard;
- at least 6 useful reports;
- PDF/XLSX evidence.

---

## Phase 9 — Backup, Security, Deployment

Build:

- database backup workflow;
- attachment backup;
- backup history;
- restore workflow;
- integrity checks;
- security hardening;
- error handling;
- LAN deployment.

Checkpoint:

- successful restore test;
- installer;
- deployment guide;
- three-PC test.

---

## Phase 10 — QA, Documentation, Defense

Complete:

- full acceptance tests;
- regression tests;
- bug fixes;
- technical documentation;
- user manual;
- deployment guide;
- test report;
- screenshots;
- demo dataset;
- release build;
- presentation/defense preparation.

Checkpoint:

- complete final submission package.

---

# 27. Git Strategy

Use meaningful commits.

Examples:

```text
feat: initialize bcis monorepo
feat: configure electron desktop shell
feat: add fastify api foundation
feat: add postgres drizzle schema
feat: implement authentication
feat: implement rbac permissions
feat: add subscriber management
feat: add service account management
feat: implement billing engine
feat: implement subscriber ledger
feat: implement payment allocation
feat: implement receipt generation
feat: implement gcash verification
feat: implement collector batches
feat: implement remittance reconciliation
feat: implement ar aging
feat: implement suspension workflow
feat: implement reconnection workflow
feat: add management reports
feat: add backup restore
test: add financial acceptance suite
fix: correct oldest-first allocation
fix: prevent duplicate billing
fix: correct payment reversal balance
```

Do not make one huge commit containing the entire application.

---

# 28. Agent Task Template

Use this template for Antigravity tasks:

```text
TASK

Implement: [FEATURE NAME]

Before coding:
1. Inspect the existing architecture.
2. Identify affected modules.
3. Identify affected database tables.
4. Identify business rules.
5. Identify security/authorization requirements.
6. Identify affected tests.

Implementation:
1. Implement the smallest coherent change.
2. Add/update migrations if required.
3. Add Zod validation.
4. Add service/domain logic.
5. Add API routes.
6. Add UI only after backend behavior is correct.
7. Add tests.

Verification:
- run typecheck
- run lint
- run relevant unit tests
- run relevant integration tests
- run E2E when applicable

Review:
- inspect diff
- check security
- check financial correctness
- check database integrity
- ensure no unrelated changes

Documentation:
Update affected documentation.

Report:
- files changed
- database changes
- APIs changed
- business rules
- tests added
- commands executed
- test results
- limitations
```

---

# 29. Antigravity Prompt Sequence

Do not ask the agent to build everything at once.

Use this sequence:

```text
1. Analyze project requirements and create foundation documentation.

2. Initialize the monorepo and development environment.

3. Build the PostgreSQL/Drizzle schema and migrations.

4. Build authentication and RBAC.

5. Build subscriber management.

6. Build plans and service accounts.

7. Build billing and invoice generation.

8. Build the ledger engine.

9. Build payments and allocation.

10. Build receipts and payment reversal.

11. Build GCash verification.

12. Build collector management.

13. Build collection batches and remittance reconciliation.

14. Build receivables and AR aging.

15. Build suspension and reconnection.

16. Build dashboard.

17. Build reports and printing.

18. Build audit and administration.

19. Build backup/restore.

20. Perform security review.

21. Perform full acceptance testing.

22. Perform three-PC concurrency testing.

23. Prepare documentation and release.
```

---

# 30. Definition of Done

A feature is NOT complete until:

- code exists;
- correct architectural layer is used;
- validation exists;
- authorization exists where required;
- migrations exist where required;
- tests exist;
- tests pass;
- error handling exists;
- audit requirements are satisfied;
- documentation is updated;
- typecheck passes;
- lint passes.

For financial functionality, also prove the resulting balances.

---

# 31. Final Deployment Architecture

## Server

One machine on the LAN should host:

```text
Fastify API Server
PostgreSQL
Attachments Storage
Backup Storage
Application Logs
Audit Logs
```

## Client PCs

Each office PC installs:

```text
BCIS Desktop Client
```

The three clients communicate with the API server over the LAN.

```text
                 LOCAL LAN
                     │
       ┌─────────────┼─────────────┐
       │             │             │
       ▼             ▼             ▼
    PC 1           PC 2          PC 3
   Electron       Electron      Electron
   Owner/Admin    Cashier       Operations
       │             │             │
       └─────────────┼─────────────┘
                     │
                     ▼
              Fastify API Server
                     │
                     ▼
                 PostgreSQL
```

The Electron client must never bypass the API to access the database.

---

# 32. Final Demonstration Sequence

The live defense should demonstrate:

1. Login as administrator.
2. Show dashboard.
3. Open/create subscriber.
4. Open Internet/Cable service account.
5. Generate/display monthly invoice.
6. Show ledger debit.
7. Post exact or partial Cash payment.
8. Show allocation.
9. Print/preview receipt.
10. Submit/verify GCash.
11. Demonstrate duplicate GCash protection.
12. Show subscriber ledger.
13. Show Statement of Account.
14. Open overdue subscriber.
15. Show AR aging/filtering.
16. Open collector batch.
17. Record collection.
18. Record remittance.
19. Demonstrate reconciliation.
20. Demonstrate shortage/overage.
21. Reverse a payment.
22. Show audit trail.
23. Export a report to PDF/XLSX.
24. Demonstrate lower-role authorization.
25. Demonstrate backup creation.
26. Explain restore procedure.
27. Demonstrate simultaneous multi-PC operation.

---

# 33. Critical Failure Prevention

Before final submission, explicitly verify that none of these exist:

- destructive deletion of posted payments;
- incorrect ledger balances;
- shared database-file architecture;
- plaintext passwords;
- direct PostgreSQL access from Electron renderer;
- missing server-side authorization;
- unvalidated financial inputs;
- unsafe proof-file handling;
- duplicate invoices;
- reused receipt numbers;
- duplicate GCash references;
- silently hidden collector shortages;
- untested backup/restore;
- static UI without real financial workflows.

---

# 34. Final Submission Structure

```text
BCIS-Subscription-Billing-System/
├── source/
├── database/
│   ├── migrations/
│   └── seeds/
├── docs/
│   ├── technical-documentation.pdf
│   ├── user-manual.pdf
│   ├── erd.png
│   └── deployment-guide.md
├── tests/
│   ├── acceptance-test-report.pdf
│   └── screenshots/
├── reports-samples/
├── release/
└── README.md
```

---

# 35. Final Success Criteria

The project is successful when it behaves like a small production business system.

It must:

- preserve financial history;
- calculate balances correctly;
- support partial, exact, and advance payments;
- allocate payments correctly;
- prevent duplicate billing;
- prevent duplicate receipts;
- verify GCash before posting;
- reconcile collectors;
- expose overdue accounts;
- calculate AR aging;
- support suspension/reconnection;
- enforce server-side RBAC;
- maintain audit history;
- support three concurrent office clients;
- generate trustworthy PDF/XLSX reports;
- support tested backup and restore;
- have unit, integration, and E2E/acceptance evidence;
- be installable and explainable during the defense.

The goal is not just to make the application look complete.

The goal is to make its data, financial calculations, security behavior, and workflows correct and defensible.
