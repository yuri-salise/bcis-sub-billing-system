# BCIS Subscription Billing and Collection System — Architecture Decision Records (ADRs)

## Index of Decisions
- [ADR-001: Three-Tier Client-Server Architecture over Local File-Based / SQLite Database](#adr-001-three-tier-client-server-architecture-over-local-file-based--sqlite-database)
- [ADR-002: Fastify 5 as Backend API Framework over Express or NestJS](#adr-002-fastify-5-as-backend-api-framework-over-express-or-nestjs)
- [ADR-003: Drizzle ORM with PostgreSQL for Type-Safe Relational Schema and Versioned Migrations](#adr-003-drizzle-orm-with-postgresql-for-type-safe-relational-schema-and-versioned-migrations)
- [ADR-004: Strict Integer Centavos for Monetary Arithmetic](#adr-004-strict-integer-centavos-for-monetary-arithmetic)
- [ADR-005: Electron Security Architecture (Context Isolation & Preload Hardening)](#adr-005-electron-security-architecture-context-isolation--preload-hardening)
- [ADR-006: Immutable Financial Records with Reversal Workflows](#adr-006-immutable-financial-records-with-reversal-workflows)
- [ADR-007: Two-Stage GCash Verification Pipeline with Reference Deduplication](#adr-007-two-stage-gcash-verification-pipeline-with-reference-deduplication)
- [ADR-008: Batch-Based Field Collection Lifecycle & Shortage Accounting](#adr-008-batch-based-field-collection-lifecycle--shortage-accounting)
- [ADR-009: Monorepo Structure with pnpm Workspaces & Turborepo](#adr-009-monorepo-structure-with-pnpm-workspaces--turborepo)

---

### ADR-001: Three-Tier Client-Server Architecture over Local File-Based / SQLite Database
- **Status**: Accepted
- **Context**: The BCIS office requires 3 simultaneous workstations (Owner/Admin, Cashier, Operations) accessing and modifying subscriber accounts, billing batches, and payments concurrently in real time.
- **Decision**: Adopt a centralized three-tier architecture where a dedicated server workstation hosts the PostgreSQL database and Fastify API server, while office workstations run Electron desktop clients connecting over the private office LAN.
- **Consequences**:
  - *Positive*: Eliminates file-lock contention and database corruption risks inherent in shared SQLite or Access files over SMB.
  - *Positive*: Centralizes database backups, security patches, attachments, and audit trails.
  - *Positive*: Enforces API-only database access; client PCs never possess direct database credentials.
  - *Negative*: Requires one workstation or dedicated mini-PC to function as the LAN server host.
- **Alternatives Considered**:
  - *Shared SQLite database over Windows SMB share*: Rejected due to severe file-locking deadlocks and corruption risk under multi-workstation concurrency.
  - *Direct PostgreSQL connection from Electron desktop clients*: Rejected as it exposes database credentials to end-user machines and bypasses central business logic, validation, and audit logging.

---

### ADR-002: Fastify 5 as Backend API Framework over Express or NestJS
- **Status**: Accepted
- **Context**: The API server must provide high throughput for counter cashiers, low latency over LAN, first-class TypeScript integration, and modular plugin encapsulation.
- **Decision**: Adopt Fastify 5 as the core HTTP backend framework.
- **Consequences**:
  - *Positive*: 2x to 3x higher throughput compared to Express with significantly lower memory overhead.
  - *Positive*: Built-in JSON schema compilation and validation using fast-json-stringify.
  - *Positive*: Clean hook lifecycle (`preValidation`, `preHandler`) ideal for RBAC checks and transaction scoping.
  - *Negative*: Smaller ecosystem of third-party plugins compared to legacy Express, but all essential utilities (CORS, Helmet, Multipart, Static) have official Fastify support.
- **Alternatives Considered**:
  - *Express 4/5*: Rejected due to legacy architecture, lack of first-class async hook lifecycles, and slower serialization.
  - *NestJS*: Rejected due to heavy abstraction layer, extensive decorator complexity, and slow cold-start times for small office LAN servers.

---

### ADR-003: Drizzle ORM with PostgreSQL for Type-Safe Relational Schema and Versioned Migrations
- **Status**: Accepted
- **Context**: BCIS requires robust relational data modeling with foreign keys, cascading rules, unique composite indexes, and versioned migration tracking.
- **Decision**: Use Drizzle ORM paired with PostgreSQL 16+ and Drizzle Kit for migration management.
- **Consequences**:
  - *Positive*: Zero runtime overhead; queries compile directly to standard SQL strings.
  - *Positive*: Single source of truth: TypeScript schema definitions automatically generate DDL SQL migrations.
  - *Positive*: Excellent relational query API (`with: { items: true }`) without the overhead and memory leakage of heavy ORMs.
  - *Negative*: Developers must write explicit joins for complex reporting queries, which aligns with our requirement for predictable SQL performance.
- **Alternatives Considered**:
  - *Prisma*: Rejected due to heavy query engine binary, higher latency, and difficulty optimizing complex financial locking queries (`SELECT FOR UPDATE`).
  - *TypeORM*: Rejected due to maintenance instability and decorator brittleness.

---

### ADR-004: Strict Integer Centavos for Monetary Arithmetic
- **Status**: Accepted
- **Context**: Financial applications cannot tolerate floating-point calculation inaccuracies (such as `0.1 + 0.2 === 0.30000000000000004`), which can cause cumulative ledger drift and inaccurate customer billing.
- **Decision**: Represent all monetary figures in memory, validation schemas, and database columns as **integer centavos** (1 PHP = 100 Centavos).
- **Consequences**:
  - *Positive*: 100% mathematical precision with standard integer addition, subtraction, and multiplication.
  - *Positive*: Completely eliminates fractional centavo rounding bugs across the billing and payment engines.
  - *Positive*: Compatible with standard SQL `BIGINT` columns.
  - *Negative*: Requires disciplined parsing at UI input boundaries and formatting at display/printing boundaries.
- **Alternatives Considered**:
  - *Floating point numbers (`number`)*: Strictly forbidden.
  - *Arbitrary-precision strings (`bignumber.js`)*: Evaluated, but integer centavos provides superior performance, simpler serialization, and zero external dependency overhead.

---

### ADR-005: Electron Security Architecture (Context Isolation & Preload Hardening)
- **Status**: Accepted
- **Context**: The desktop client executes on office computers accessible by multiple staff members. Renderer compromises (e.g., via malicious inputs or external web assets) must not compromise the local operating system or network.
- **Decision**: Configure Electron with `contextIsolation: true`, `nodeIntegration: false`, and a hardened, typed preload script exposing only essential system actions (window controls, printer triggering).
- **Consequences**:
  - *Positive*: Complete separation between the web renderer environment and Node.js OS primitives.
  - *Positive*: Complies with standard Electron security checklists.
  - *Positive*: Client codebase cannot directly invoke shell commands or write arbitrary files.
  - *Negative*: Requires explicit IPC handlers for any native OS functionality (such as printing receipts).
- **Alternatives Considered**:
  - *Electron with nodeIntegration enabled*: Rejected due to critical security vulnerabilities.

---

### ADR-006: Immutable Financial Records with Reversal Workflows
- **Status**: Accepted
- **Context**: In financial accounting, deleting or altering historical transactions destroys audit trails and invalidates financial statements.
- **Decision**: Treat all posted financial entities (`invoices`, `payments`, `allocations`, `receipts`, `remittances`) as immutable. Errors are corrected exclusively through explicit **reversals** and **adjustments** (credit/debit memos) that preserve full historical context.
- **Consequences**:
  - *Positive*: Complete auditability and regulatory compliance.
  - *Positive*: The subscriber ledger can be recomputed from epoch with zero discrepancy.
  - *Positive*: Protects against internal fraud by counter cashiers or rogue operators.
  - *Negative*: Slightly higher database storage requirements for historical records, which is negligible for this scale.
- **Alternatives Considered**:
  - *Hard deletion or in-place modification of payment rows*: Strictly rejected.

---

### ADR-007: Two-Stage GCash Verification Pipeline with Reference Deduplication
- **Status**: Accepted
- **Context**: Digital payments via GCash are prone to fraudulent submissions, duplicate reference entries, and blurred screenshots.
- **Decision**: Implement a two-stage pipeline: incoming submissions enter a `PENDING_VERIFICATION` queue where reference uniqueness is enforced. Posting to the ledger occurs only after a cashier or supervisor inspects the screenshot and clicks "Verify & Post".
- **Consequences**:
  - *Positive*: Prevents premature balance crediting based on unverified submissions.
  - *Positive*: Automatically stops duplicate submissions using the same reference number.
  - *Positive*: Establishes dual accountability (uploader and verifier).
  - *Negative*: Requires manual cashier verification before payments reflect on customer accounts.
- **Alternatives Considered**:
  - *Direct automated posting upon screenshot upload*: Rejected due to high fraud risk.

---

### ADR-008: Batch-Based Field Collection Lifecycle & Shortage Accounting
- **Status**: Accepted
- **Context**: Field collectors collect cash from rural and urban barangays and turn in money at day's end. Discrepancies between cash collected and cash remitted must be transparently tracked.
- **Decision**: Field collections are tracked in sequential batches (`OPEN` to `CLOSED`). Remittance compares expected cash against remitted cash. Any deficit is explicitly logged as a **Collector Shortage** and cannot be bypassed.
- **Consequences**:
  - *Positive*: Total transparency regarding collector accountability.
  - *Positive*: Prevents cashiers from absorbing collector shortages into general company expenses.
  - *Positive*: Provides data for collector performance evaluations.
  - *Negative*: Requires supervisor involvement when reconciling batches with discrepancies.
- **Alternatives Considered**:
  - *Ad-hoc individual payment entry for collectors*: Rejected due to lack of route-level accountability.

---

### ADR-009: Monorepo Structure with pnpm Workspaces & Turborepo
- **Status**: Accepted
- **Context**: The desktop client and API server share core TypeScript types, Zod validation schemas, business rules, and configuration files.
- **Decision**: Structure the codebase as a monorepo using pnpm workspaces and Turborepo.
- **Consequences**:
  - *Positive*: Single repository holding client, API, shared packages, and database migrations.
  - *Positive*: Fast, cached incremental builds and typechecks across packages.
  - *Positive*: Guaranteed type synchronization between backend API routes and frontend API consumers.
  - *Negative*: Requires developers to understand workspace linking conventions (`workspace:*`).
- **Alternatives Considered**:
  - *Separate repositories for client and server*: Rejected due to version drift in shared types and redundant schema definitions.
