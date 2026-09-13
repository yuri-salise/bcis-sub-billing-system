# BCIS Subscription Billing and Collection System — Project Rules

## 1. Scope and Authority
This document defines the architectural, security, financial, and development rules for the **Bukidnon Cable and Internet Services (BCIS) Subscription Billing and Collection System**. All code, schema modifications, and agent activities must strictly adhere to these rules.

---

## 2. Technology Stack Constraints

### Desktop Application
- **Runtime & Shell**: Electron 44.x
- **Build System**: electron-vite, electron-builder
- **UI Framework**: React 19.2, TypeScript (Strict Mode)
- **Styling**: Tailwind CSS 4, shadcn/ui component patterns
- **Data & Tables**: TanStack Table, TanStack Query
- **Forms**: React Hook Form with Zod resolvers

### Backend & API
- **Framework**: Fastify 5
- **Language**: TypeScript (Strict Mode)
- **Validation**: Zod 4
- **Data Access**: Drizzle ORM
- **Logging**: Pino structured logger

### Database & Storage
- **Database**: PostgreSQL (Centralized on LAN server host)
- **Migrations**: Drizzle Kit versioned SQL migrations
- **Attachments**: Server-managed filesystem storage with hash-based deduplication
- **Backups**: `pg_dump` and `pg_restore` managed via Fastify API server

### Reporting
- **Spreadsheets**: ExcelJS
- **Documents**: pdfmake
- **Printing**: Clean printable HTML/CSS rendered via Electron print dialog

### Testing
- **Unit & Domain Tests**: Vitest
- **API Integration Tests**: Fastify test harness (`fastify.inject`) with PostgreSQL
- **Desktop E2E**: Playwright Electron

---

## 3. Core Architectural Rules

1. **Client-Server Separation over LAN**:
   - The system is deployed across three simultaneous office PCs (Owner/Admin, Cashier, Operations) connected via Local Area Network.
   - The Electron client is strictly a presentation and IPC layer.
   - **CRITICAL**: The Electron renderer must **NEVER** connect directly to PostgreSQL. Direct database connection strings, database drivers (`pg`, `mysql`), and master database credentials must never exist inside the desktop client package.

2. **API as the Single Source of Truth**:
   - Every business action, financial posting, query, authentication request, and reporting query must route through the Fastify API.
   - The API is solely responsible for authentication, authorization, business logic, ACID transactions, and auditing.

3. **Electron Security Baseline**:
   - `contextIsolation = true` is strictly enforced.
   - `nodeIntegration = false` is strictly enforced.
   - All IPC communication must pass through a minimal, strongly typed preload script bridge (`window.api`).
   - Renderer code must not have arbitrary filesystem, shell, or process execution privileges.

---

## 4. Financial and Domain Rules

1. **Exact Monetary Calculations**:
   - Never use JavaScript floating-point numbers (`number` with decimals) for authoritative financial arithmetic.
   - All monetary values stored and calculated in domain logic must use **integer centavos** (e.g., ₱999.00 = `99900`) or PostgreSQL `NUMERIC(12, 2)` mapped through high-precision decimal math.
   - Rounding rules must follow commercial half-up rounding only when explicitly prorating services.

2. **Immutable Posted Financial History**:
   - Never silently update, delete, or overwrite posted financial records (invoices, payments, allocations, receipts, remittances).
   - Financial errors must be resolved exclusively through authorized **reversals** or **adjustments** (credit/debit memos).
   - The subscriber ledger must be reproducible from historical debits and credits at any point in time.

3. **ACID Transaction Guarantees**:
   - Multi-step financial postings (such as payment processing: validating -> inserting payment -> allocating across invoices -> updating invoice balances -> updating ledger -> generating receipt -> auditing) must execute within a single PostgreSQL transaction (`db.transaction(...)`).
   - Any failure or validation error during posting must trigger an automatic rollback.

4. **Duplicate Protection**:
   - Duplicate billing must be prevented at the database and application levels: a service account cannot have more than one non-void invoice for the same billing cycle/period.
   - GCash reference numbers must be unique across all payments. Duplicate submissions must be detected, flagged, or rejected.
   - Receipt numbers and invoice numbers must follow strictly monotonic, gapless or audit-traceable numbering formats.

5. **GCash Workflow Discipline**:
   - Uploading a payment screenshot never automatically marks an account as paid.
   - Payments from digital channels must enter a verification queue (`PENDING`), requiring cashier/supervisor review before posting to ledger and allocation.

6. **Collector Remittance & Reconciliation**:
   - Expected cash vs. remitted cash must be calculated for every collection batch.
   - Shortages must be visibly recorded against the collector's account and cannot be silently written off.

---

## 5. Security and RBAC Rules

1. **Server-Side Authorization**:
   - UI element hiding is a convenience for user experience, **NOT** a security boundary.
   - Every API endpoint mutating or reading sensitive resources must enforce server-side RBAC checks via Fastify hooks (`preHandler`).
   - Requests from a Cashier attempting administrator operations must be rejected with HTTP 403 Forbidden by the server.

2. **Credential Safety**:
   - Passwords must be hashed using `argon2id` or `bcrypt` (work factor >= 12).
   - No plaintext passwords in code, logs, seeds, or database backups.
   - Default administrative credentials must be forced to change upon initial setup.

3. **Comprehensive Audit Trail**:
   - Every state-altering action (payment posted, payment reversed, invoice voided, GCash verified/rejected, service suspended/reconnected, role changed, backup triggered) must log an immutable audit record containing:
     - `actor_id` & `actor_name`
     - `action` (e.g., `PAYMENT_POSTED`, `PAYMENT_REVERSED`)
     - `timestamp`
     - `entity_type` & `entity_id`
     - `reason` (mandatory for reversals, voids, and manual adjustments)
     - `old_state` & `new_state` JSON snapshots

4. **Synthetic Data Policy**:
   - Only synthetic, realistic mock data is permitted in seeds, tests, screenshots, and documentation.
   - Under no circumstances should real personal data, actual subscriber phone numbers, real GCash references, or live financial records be committed or used in development.

---

## 6. Development Loop & Engineering Workflow

For every feature or task, follow this exact cycle:

```text
1. Read requirement thoroughly
      ↓
2. Inspect existing codebase & schema
      ↓
3. Assess domain, data integrity, and security impact
      ↓
4. Write failing tests (TDD for financial & domain logic)
      ↓
5. Implement smallest coherent change
      ↓
6. Apply schema migration & validation schemas
      ↓
7. Run tests (unit, integration)
      ↓
8. Typecheck (tsc --noEmit) & Lint
      ↓
9. Inspect diff and verify no regressions
      ↓
10. Update documentation
      ↓
11. Commit with meaningful Conventional Commit message
```

---

## 7. Definition of Done (DoD)

A task or feature is considered complete **ONLY** when:
1. Production code is written in the correct architectural layer (domain services vs. routes vs. components).
2. Input validation is implemented via Zod schemas.
3. Server-side RBAC checks protect all associated API endpoints.
4. Database migrations are checked in and successfully executed.
5. Unit and integration tests cover happy paths and edge cases (zero values, duplicate detection, boundary dates).
6. Financial calculations are proven with balance verification tests.
7. Audit log records are created for all state mutations.
8. TypeScript compilation passes without errors (`tsc --noEmit`).
9. Linters pass without warnings or errors.
10. Relevant documentation files in `/docs` are updated to reflect the new implementation.
