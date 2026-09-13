# BCIS Subscription Billing and Collection System — Architecture Specification

## 1. System Architecture Overview

The BCIS Subscription Billing and Collection System is architected as a **three-tier client-server desktop system operating over a Local Area Network (LAN)**. It is purpose-built for Bukidnon Cable and Internet Services to ensure financial rigor, sub-second transaction performance across office workstations, and data isolation between the user interface and the database tier.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                      PRESENTATION TIER (OFFICE PCS)                     │
│                                                                         │
│   PC 1: Owner / Admin          PC 2: Cashier          PC 3: Operations  │
│  ┌───────────────────────┐ ┌───────────────────────┐ ┌────────────────┐│
│  │ Electron 44.x + React │ │ Electron 44.x + React │ │Electron + React││
│  │ TypeScript Strict     │ │ TypeScript Strict     │ │TypeScript Strict│
│  │ Context Isolation     │ │ Context Isolation     │ │Context Isolation│
│  │ Typed Preload Bridge  │ │ Typed Preload Bridge  │ │Preload Bridge  ││
│  └──────────┬────────────┘ └──────────┬────────────┘ └───────┬────────┘│
└─────────────┼─────────────────────────┼──────────────────────┼──────────┘
              │                         │                      │
              │         HTTP / REST API (LAN Network)          │
              ▼                         ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    APPLICATION TIER (CENTRAL SERVER PC)                 │
│                                                                         │
│   Fastify 5 REST API Server (Node.js LTS / TypeScript)                  │
│   ├── Network Transport & CORS (Private LAN Subnet)                     │
│   ├── Security Middleware (Rate-limit, Helmet, JWT Auth)                │
│   ├── Server-Side RBAC Guard (PreHandler permission checks)             │
│   ├── Input Validation Layer (Zod Schemas)                              │
│   │                                                                     │
│   ├── Domain Services Engine                                            │
│   │   ├── BillingEngine (Invoicing, Proration, Duplicate Checks)        │
│   │   ├── PaymentAllocationEngine (FIFO, Exact, Partial, Advance)       │
│   │   ├── RemittanceReconciliationService (Cash count, Shortages)       │
│   │   ├── GCashVerificationService (Queue, Hash check, Deduplication)   │
│   │   ├── ReceivablesAgingService (Arrears, Buckets, Suspension list)   │
│   │   └── ReportExportService (ExcelJS, pdfmake)                        │
│   │                                                                     │
│   ├── Audit Logging Interceptor (Immutable state snapshots)             │
│   └── Data Access Layer (Drizzle ORM + Connection Pooling)              │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    │ Connection Pool (pg)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       DATA TIER (CENTRAL SERVER PC)                     │
│                                                                         │
│   PostgreSQL Relational Database Engine                                 │
│   ├── Normalized Schemas (Subscribers, Invoices, Payments, Ledgers)     │
│   ├── ACID Transaction Boundaries (`BEGIN ... COMMIT / ROLLBACK`)       │
│   ├── Unique Constraints & Sequences (Invoice numbers, OR numbers)      │
│   ├── B-Tree Indexes (Account no, Reference no, Status, Due date)       │
│   │                                                                     │
│   Server Filesystem Assets                                              │
│   ├── Attachments Repository (`/data/attachments/{hash}`)               │
│   └── Automated Backups Archive (`/data/backups/bcis_backup_*.sql.gz`)  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Monorepo Structure & Package Boundaries

The repository is organized as a typed monorepo using pnpm workspaces and Turborepo to enforce strict modular separation:

```text
bcis-sub-billing-system/
├── apps/
│   ├── desktop/                 # Electron 44.x Desktop Application
│   │   ├── electron/            # Main process (window management, app lifecycle, printer IPC)
│   │   ├── preload/             # Isolated Preload scripts (typed `window.api` bridge)
│   │   └── src/                 # React 19.2 Renderer application
│   │       ├── app/             # Application entry point, global providers, router
│   │       ├── components/      # Reusable design system primitives (shadcn/ui + Tailwind 4)
│   │       ├── features/        # Domain-aligned feature modules (auth, billing, cashier, etc.)
│   │       ├── hooks/           # Custom React hooks & TanStack Query hooks
│   │       └── lib/             # API client, formatters, currency helpers
│   │
│   └── api/                     # Fastify 5 REST API Server
│       └── src/
│           ├── db/              # Drizzle schema definitions, database client, connection pool
│           ├── middleware/      # JWT authentication, session handling, RBAC permission guards
│           ├── modules/         # Feature modules (controllers, domain services, schemas)
│           │   ├── auth/
│           │   ├── subscribers/
│           │   ├── service-accounts/
│           │   ├── billing/
│           │   ├── payments/
│           │   ├── gcash/
│           │   ├── collections/
│           │   ├── receivables/
│           │   ├── reports/
│           │   └── admin/
│           ├── plugins/         # Fastify ecosystem plugins (sensible, cors, multipart)
│           ├── utils/           # Money math (centavos), PDF/Excel generators
│           └── server.ts        # Fastify server startup & LAN listener
│
├── packages/
│   ├── shared-types/            # Shared TypeScript DTOs, Enums, and Interfaces
│   ├── validation/              # Shared Zod 4 validation schemas (isomorphic)
│   ├── domain/                  # Pure domain logic (money calculation, FIFO allocation rules)
│   └── config/                  # Shared ESLint, Prettier, and TypeScript configurations
│
├── database/
│   ├── migrations/              # Versioned SQL migrations generated by Drizzle Kit
│   ├── schema/                  # Raw table definitions and relational mappings
│   └── seeds/                   # Synthetic development and acceptance test datasets
│
├── tests/
│   ├── unit/                    # Vitest unit tests for domain services & money calculations
│   ├── integration/             # Fastify API endpoint tests with real PostgreSQL transactions
│   ├── e2e/                     # Playwright Electron end-to-end user workflows
│   └── acceptance/              # Mandatory Acceptance Test suite (AT-01 through AT-12)
│
├── docs/                        # Complete technical specifications and operational runbooks
└── .agents/                     # Antigravity agent configuration and project rules
```

---

## 3. Tiered Layer Architecture & Responsibilities

### 3.1 Presentation Tier (Desktop Client)
- **Electron Shell**: Manages the Windows desktop window, system tray, native print dialogs, local cache, and secure IPC communication.
- **Preload Script (`preload.ts`)**:
  - Exposes a minimal, hardened `window.api` surface using `contextBridge.exposeInMainWorld`.
  - Strictly operates under `contextIsolation = true` and `nodeIntegration = false`.
  - **Zero Database Exposure**: Contains zero database connection credentials, database drivers, or filesystem write primitives.
- **React 19 Renderer**:
  - Consumes the Fastify API via a standard HTTP client (`fetch` / Axios wrapped in TanStack Query).
  - Handles client-side state caching, optimistic UI updates, form validation via Zod, and accessible UI components.
  - UI permission checking is implemented solely for visual feedback (e.g., hiding action buttons a cashier cannot use); actual enforcement occurs on the API.

### 3.2 Application Tier (Fastify API Server)
- **Fastify 5 Framework**: Selected for its low overhead, asynchronous throughput, schema-based serialization, and modular plugin architecture.
- **Security & Authorization Pipeline**:
  1. `onRequest`: Request logging via Pino, CORS enforcement for LAN workstations.
  2. `preValidation`: Parsing of incoming JSON/multipart payloads.
  3. `preHandler` (Authentication): Extraction and cryptographic verification of the Bearer Session Token.
  4. `preHandler` (RBAC Guard): Verification of user's active permissions against the route requirement (e.g., `payment.reverse`).
  5. `Handler` (Domain Service Execution): Delegation of business logic to domain services wrapped in ACID transactions.
- **Domain Services**: Encapsulate all business rules. Handlers never execute direct database writes; they call domain services (e.g., `PaymentService.postPayment()`).

### 3.3 Data Tier (PostgreSQL Relational Storage)
- **PostgreSQL 16+**: Provides transactional safety (Serializable / Read Committed isolation), atomic sequences for invoice and receipt numbers, foreign key constraints, and relational integrity.
- **Drizzle ORM**: Provides compile-time type safety from TypeScript schemas, zero runtime translation overhead, and migration generation.
- **Integer Centavos**: All monetary columns are typed as `BIGINT` or `INTEGER` representing centavos (PHP 1,000.00 = `100000`), or `NUMERIC(12, 2)` mapped through high-precision conversion helpers.

---

## 4. Key Data Flows & Sequence Diagrams

### 4.1 Cashier Payment Posting Flow (AT-01, AT-02, AT-04)

```text
Cashier (UI)         Fastify API Gateway        PaymentService        PostgreSQL Database
     │                        │                       │                        │
     │ 1. POST /payments      │                       │                        │
     │    (amount, method,    │                       │                        │
     │     subscriber_id)     │                       │                        │
     ├───────────────────────>│                       │                        │
     │                        │ 2. Validate Token     │                        │
     │                        │    & RBAC Permission  │                        │
     │                        │ 3. Validate Zod Schema│                        │
     │                        ├──────────────────────>│                        │
     │                        │                       │ 4. BEGIN TRANSACTION   │
     │                        │                       ├───────────────────────>│
     │                        │                       │ 5. Lock unpaid invoices│
     │                        │                       │    SELECT FOR UPDATE   │
     │                        │                       ├───────────────────────>│
     │                        │                       │ 6. Run FIFO allocation │
     │                        │                       │    (Oldest invoice 1st)│
     │                        │                       │ 7. INSERT into payments│
     │                        │                       │ 8. INSERT allocations  │
     │                        │                       │ 9. UPDATE invoice stats│
     │                        │                       │ 10. INSERT ledger cred │
     │                        │                       │ 11. NEXTVAL(receipt_seq│
     │                        │                       │ 12. INSERT receipt     │
     │                        │                       │ 13. INSERT audit log   │
     │                        │                       ├───────────────────────>│
     │                        │                       │ 14. COMMIT             │
     │                        │                       ├───────────────────────>│
     │                        │ 15. Return HTTP 201   │                        │
     │                        │     { receipt, ... }  │                        │
     │<───────────────────────┴───────────────────────┤                        │
     │                                                                         │
     │ 16. Trigger Native Print Receipt Dialog                                 │
     ▼                                                                         ▼
```

### 4.2 GCash Verification & Posting Flow (AT-05)

```text
Customer / Staff          GCash Service             Database Queue          Cashier Reviewer
       │                         │                         │                        │
       │ 1. Submit Reference,    │                         │                        │
       │    Amount, Proof Img    │                         │                        │
       ├────────────────────────>│                         │                        │
       │                         │ 2. Check Duplicate Ref  │                        │
       │                         │    SELECT count(*)      │                        │
       │                         ├────────────────────────>│                        │
       │                         │ 3. If exists: REJECT 409│                        │
       │                         │    If new: save image to│                        │
       │                         │    disk & INSERT row    │                        │
       │                         ├────────────────────────>│                        │
       │                         │    (Status = PENDING)   │                        │
       │                         │                         │ 4. Fetch Pending Queue │
       │                         │                         │<───────────────────────┤
       │                         │                         │ 5. Review Proof & Info │
       │                         │                         │    Click "Verify & Post│
       │                         │                         │───────────────────────>│
       │                         │ 6. Run Payment Post Txn │                        │
       │                         │    (Status = VERIFIED)  │                        │
       │                         ├────────────────────────>│                        │
       ▼                         ▼                         ▼                        ▼
```

### 4.3 Collection Batch Remittance Reconciliation Flow (AT-07, AT-08)

```text
Operations / Supervisor            Reconciliation Service           PostgreSQL Database
          │                                  │                              │
          │ 1. Submit Remitted Cash Count    │                              │
          │    (e.g., ₱19,500 for Batch 101) │                              │
          ├─────────────────────────────────>│                              │
          │                                  │ 2. Calculate Expected Cash   │
          │                                  │    SUM(payments WHERE cash)  │
          │                                  ├─────────────────────────────>│
          │                                  │    Returns: ₱20,000          │
          │                                  │ 3. Compute Difference:       │
          │                                  │    Expected - Remitted       │
          │                                  │    ₱20,000 - ₱19,500 = ₱500  │
          │                                  │ 4. Difference > 0:           │
          │                                  │    Record Shortage Entry     │
          │                                  │    Batch -> RECONCILED_SHORT │
          │                                  │ 5. INSERT Audit Log          │
          │                                  ├─────────────────────────────>│
          │ 6. Return Batch Status & Summary │                              │
          │    (Flagged with ₱500 Shortage)  │                              │
          │<─────────────────────────────────┤                              │
          ▼                                  ▼                              ▼
```

---

## 5. Concurrency, Data Integrity & Numbering Strategy

### 5.1 Concurrency Across Office Workstations
To prevent race conditions when multiple cashiers or operators work simultaneously over the LAN:
- **Pessimistic Row Locking (`SELECT ... FOR UPDATE`)**: Used when querying subscriber invoices during payment posting. This prevents another workstation from applying a concurrent payment or adjustment to the same invoice mid-flight.
- **Optimistic Locking (`version` column)**: Maintained on subscriber records and service accounts. Updates verify that `version = current_version`; conflicting concurrent updates trigger HTTP 409 Conflict prompting the user to refresh.
- **PostgreSQL Database Sequences**:
  - Invoice numbers: `inv_seq` mapped to `INV-YYYYMM-XXXXXX`.
  - Official Receipt numbers: `rcpt_seq` mapped to `OR-YYYY-XXXXXX`.
  - Subscriber accounts: `sub_seq` mapped to `SUB-YYYYMM-XXXX`.
  - Database sequences guarantee monotonic, gap-free, atomic number generation completely immune to multi-process race conditions.

---

## 6. Backup, Storage & Disaster Recovery

### 6.1 Server Storage Layout
On the designated server PC, the filesystem is partitioned into dedicated directories:
- `/data/db/`: PostgreSQL database cluster.
- `/data/attachments/`: Uploaded payment proofs, signed service contracts, and KYC IDs. Files are named by their SHA-256 content hash to eliminate path traversal vulnerabilities and eliminate duplicate storage.
- `/data/backups/`: Target destination for automated daily database dumps (`bcis_backup_YYYYMMDD_HHMMSS.sql.gz`).

### 6.2 Backup & Restoration Workflow (AT-12)
1. **Automated Scheduled Backup**: Executed daily at 23:00 via a server-side cron service invoking `pg_dump -Fc` (custom archive format with internal checksums).
2. **On-Demand Manual Backup**: Triggerable via Admin UI; streams backup progress and records entry in `backup_history`.
3. **Restoration Protocol**:
   - Requires Super Admin credentials and confirmation.
   - Terminates active client sessions by terminating open database connections.
   - Restores the archive using `pg_restore --clean --if-exists`.
   - Executes database schema integrity validation post-restore before releasing client connections.
