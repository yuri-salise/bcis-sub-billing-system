# BCIS Subscription Billing and Collection System

[![Target: Windows](https://img.shields.io/badge/Target-Windows_10%2B-blue.svg)](https://www.microsoft.com/windows)
[![Electron](https://img.shields.io/badge/Electron-44.x-47848F.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19.2-61DAFB.svg)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-5.x-000000.svg)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%2B-336791.svg)](https://www.postgresql.org/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-Latest-C5F74F.svg)](https://orm.drizzle.team/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6.svg)](https://www.typescriptlang.org/)

A mission-critical Windows desktop Subscription Billing and Collection System engineered for **Bukidnon Cable and Internet Services (BCIS)**, supporting three simultaneous office workstations operating over a private Local Area Network (LAN).

---

## 1. System Architecture & Workstation Roles

The system uses a **three-tier client-server desktop architecture**:

```text
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│ Workstation 1   │       │ Workstation 2   │       │ Workstation 3   │
│ Owner / Admin   │       │ Cashier Counter │       │ Operations      │
│ (Electron App)  │       │ (Electron App)  │       │ (Electron App)  │
└────────┬────────┘       └────────┬────────┘       └────────┬────────┘
         │                         │                         │
         └─────────────────────────┼─────────────────────────┘
                                   │
                           Office Private LAN
                                   │
                                   ▼
                   ┌───────────────────────────────┐
                   │ Central Server Workstation    │
                   │ ├── Fastify 5 REST API Server │
                   │ ├── PostgreSQL Relational DB  │
                   │ ├── Attachments Storage       │
                   │ └── Automated Daily Backups   │
                   └───────────────────────────────┘
```

- **Electron Security**: Strict Context Isolation (`contextIsolation: true`) and disabled Node.js integration (`nodeIntegration: false`). The desktop client never connects directly to PostgreSQL; all actions flow through the Fastify API.
- **Financial Exactness**: Zero floating-point arithmetic. All currency amounts are handled in integer centavos (₱1.00 = 100 centavos) or PostgreSQL `NUMERIC(12, 2)`.
- **Immutable Financial Records**: Invoices, payments, receipts, and remittances are strictly immutable. Corrections are made via authorized reversals and adjustments.

---

## 2. Technical Documentation Index

Detailed engineering specifications are located in the [`docs/`](./docs) directory:

- [**System Requirements Specification (SRS)**](./docs/requirements.md): Complete functional and non-functional requirements, user personas, and acceptance traceability.
- [**System Architecture Specification**](./docs/architecture.md): Network topology, tiered architecture, component interactions, data flows, and concurrency handling.
- [**Business & Financial Rules**](./docs/business-rules.md): Monetary mathematics, invoice lifecycles, FIFO payment allocations, GCash queue logic, and remittance reconciliation.
- [**Role-Based Access Control (RBAC) Matrix**](./docs/rbac-matrix.md): Master permissions matrix across the 7 user roles and server-side hook enforcement.
- [**API Design Specification**](./docs/api-design.md): REST endpoint catalog, Zod request/response schemas, error envelopes, and HTTP status codes.
- [**Database Design Specification**](./docs/database-design.md): Normalized relational schemas, DDL, table constraints, composite indexes, and centavo types.
- [**Testing Strategy & QA Plan**](./docs/testing-strategy.md): Unit, integration, and E2E test pyramids, continuous verification protocol, and detailed AT-01 through AT-12 acceptance test specifications.
- [**Security Review & Failure Mode Audits**](./docs/security-review.md): Electron desktop isolation, LAN threat mitigation, and audit against the 14 critical failure modes.
- [**Deployment & LAN Setup Guide**](./docs/deployment-guide.md): Central server setup, Windows Firewall rules, multi-client installation, and disaster recovery.
- [**Architecture Decision Records (ADRs)**](./docs/architecture-decisions.md): Formal rationale for technology selections, monetary standards, and security boundaries.
- [**Project Rules & Development Loop**](./.agents/rules/bcis-project.md): Mandatory agent coding rules, definition of done, and development loop.

---

## 3. Mandatory Acceptance Criteria (AT-01 to AT-12)

The system is validated against 12 core acceptance tests:
- **AT-01: Exact Payment**: Full invoice settlement, zero remaining balance, `PAID` status, balanced ledger.
- **AT-02: Partial Payment**: Partial allocation, remaining balance tracking, `PARTIALLY_PAID` status.
- **AT-03: Advance Payment**: Unallocated overpayments credited to subscriber advance account.
- **AT-04: FIFO Allocation**: Payments automatically clear oldest outstanding invoices first.
- **AT-05: Duplicate GCash Reference**: Rejection with HTTP 409 Conflict when submitting already-used references.
- **AT-06: Payment Reversal**: Restores invoice balances, voids receipt, logs reason, preserves audit trail.
- **AT-07: Balanced Remittance**: Collection batch reconciles and closes when expected matches remitted.
- **AT-08: Collector Shortage**: Remittance deficit recorded as formal shortage; cannot silently close as balanced.
- **AT-09: Concurrent Multi-PC**: Simultaneous operations across 3 workstations without deadlock or collisions.
- **AT-10: Server-Side Authorization**: API enforces RBAC even if client UI controls are bypassed.
- **AT-11: Duplicate Billing Protection**: Idempotent billing generator prevents duplicate period invoices.
- **AT-12: Backup & Restore Integrity**: Full database dump, corruption simulation, and bit-for-bit restore verification.

---

## 4. Development Phases Roadmap

- [x] **Phase 0: Discovery, Architecture & Planning** *(Complete)*
- [x] **Phase 1: Project Foundation & Monorepo Initialization** *(Complete)*
- [x] **Phase 2: Authentication & RBAC Engine** *(Complete)*
- [x] **Phase 3: Subscribers, Plans & Service Accounts** *(Complete)*
- [x] **Phase 4: Billing Engine & Subscriber Ledger** *(Complete)*
- [x] **Phase 5: Payments, Allocations & Official Receipts** *(Complete)*
- [x] **Phase 6: Field Collection Batches & Remittance Reconciliation** *(Complete)*
- [x] **Phase 7: Receivables Aging & Service Control (Suspension/Reconnection)** *(Complete)*
- [x] **Phase 8: Desktop Application UI & Role-Based Workspaces (Apple Design)** *(Complete)*
- [x] **Phase 9: Backup/Restore, 3-Client LAN Concurrency & Full Acceptance Suite (AT-01 to AT-14)** *(Complete — 370/370 tests passing)*


---

## 5. Development Principles

1. Implement incrementally; never build the entire system in a single unverified leap.
2. Server-side authorization is mandatory; UI hiding is not security.
3. Every database schema change must be version-controlled via Drizzle migrations.
4. Never delete posted financial records; use reversal/adjustment workflows.
5. All external inputs must be validated with Zod.
6. Synthetic and mock demo data only; never commit real subscriber PII.
