# BCIS Subscription Billing and Collection System — Security Review & Threat Mitigation

## 1. Security Architecture & Threat Model

The BCIS Subscription Billing and Collection System manages financial transactions, subscriber identity records, and service lifecycles across a multi-workstation office Local Area Network (LAN). The security model is designed to operate under zero-trust assumptions between the desktop client interface and the server backend.

```text
┌─────────────────────────────────────────────────────────────┐
│                 OFFICE LAN SECURITY PERIMETER               │
│                                                             │
│   Workstation 1          Workstation 2       Workstation 3  │
│   (Admin Desktop)        (Cashier Desktop)   (Ops Desktop)  │
│   [Isolated Renderer]    [Isolated Renderer] [Isolated R.]  │
│          │                      │                   │       │
│          ▼                      ▼                   ▼       │
│   [Preload Bridge]       [Preload Bridge]    [Preload B.]   │
│          │                      │                   │       │
│          └──────────────┬───────┴───────────────────┘       │
│                         │ HTTP (JWT Bearer Auth + RBAC)     │
│                         ▼                                   │
│           ┌───────────────────────────────┐                 │
│           │ Fastify 5 API Server Gateway  │                 │
│           │ ├── Rate Limiting & Helmet    │                 │
│           │ ├── Server-Side RBAC Guards   │                 │
│           │ ├── Zod Input Validation      │                 │
│           │ └── Parameterized Queries     │                 │
│           └─────────────┬─────────────────┘                 │
│                         │ Loopback / Private Auth           │
│                         ▼                                   │
│           ┌───────────────────────────────┐                 │
│           │ PostgreSQL Database Engine    │                 │
│           └───────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Electron Desktop Client Security Posture

### 2.1 Context Isolation & Node Integration
- **`contextIsolation = true`**: Strictly enforced on all `BrowserWindow` instances. The renderer execution context is completely isolated from the preload script context and the Node.js runtime.
- **`nodeIntegration = false`**: Enforced without exception. The DOM environment cannot access Node's `process`, `fs`, `child_process`, or `net` modules.
- **`sandbox: true`**: Applied to restrict browser engine capabilities.

### 2.2 Preload Script Hardening
The preload script exposes only a frozen, minimal API surface (`window.api`):
```typescript
// Electron preload hardening pattern
contextBridge.exposeInMainWorld('api', {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    lockScreen: () => ipcRenderer.invoke('app:lock-screen'),
  },
  printer: {
    printReceipt: (payload: ReceiptPrintPayload) => ipcRenderer.invoke('printer:print-receipt', payload),
  }
});
```
- **Zero Database Exposure**: Neither database connection strings, database credentials, nor direct SQL execution capabilities exist in the client build.

---

## 3. Server-Side Security & Network Hardening

1. **Server-Side Authorization**: UI component visibility is treated merely as presentation UX. All authorization checks are executed server-side via Fastify `preHandler` hooks. Direct API requests bypassing the UI are validated against the user's role and permission set.
2. **Password Cryptography**: Passwords must be hashed using `argon2id` (memory cost 64MB, iterations 3) or `bcrypt` (work factor 12). Plaintext passwords never appear in memory dumps, logs, or error outputs.
3. **Session Management**: Session tokens are cryptographically signed using HS256/RS256 with an expiration of 8 hours. Workstation screen locking requires re-authenticating the user's password without invalidating the active session state.
4. **Input Sanitization & Parameterization**: All endpoints enforce strict Zod schemas on incoming bodies, query parameters, and headers. SQL queries are parameterized via Drizzle ORM to neutralize SQL injection attacks.
5. **CORS & LAN Origin Restriction**: Fastify server binds to LAN IP and restricts CORS origins to authorized desktop client origins.

---

## 4. Audit of Critical Failure Modes (PRODUCT.md Section 33)

| # | Critical Failure Mode | Mitigation Strategy & Verification Mechanism | Status |
| :-: | :--- | :--- | :---: |
| **1** | **Destructive deletion of posted payments** | Hard deletion of `payments` rows is prevented at schema level (`ON DELETE RESTRICT`). Reversals are recorded via compensating ledger entries and status flags (`is_reversed = true`). | **PROTECTED** |
| **2** | **Incorrect ledger balances** | Running balances are calculated dynamically from immutable debits and credits using exact integer centavos. Floating point arithmetic is prohibited. | **PROTECTED** |
| **3** | **Shared database-file architecture** | Centralized PostgreSQL engine over TCP LAN; zero shared SQLite or Access files over SMB network shares. | **PROTECTED** |
| **4** | **Plaintext passwords** | Salted hashing using Argon2id/bcrypt. Default passwords forced to rotate upon initial system setup. | **PROTECTED** |
| **5** | **Direct DB access from Electron renderer** | Architectural separation: renderer connects solely via HTTP to Fastify API; zero DB drivers bundled into client. | **PROTECTED** |
| **6** | **Missing server-side authorization** | Fastify `preHandler` hook (`requirePermission`) enforces permissions on every mutating and sensitive route. | **PROTECTED** |
| **7** | **Unvalidated financial inputs** | Zod schemas validate integer centavos (`z.number().int().positive()`), rejecting negative amounts, non-integers, and malformed strings. | **PROTECTED** |
| **8** | **Unsafe proof-file handling** | GCash screenshots are renamed to their SHA-256 content hashes, validated for image MIME types, and stored in a non-executable folder. | **PROTECTED** |
| **9** | **Duplicate invoices** | Database unique constraint on `(service_account_id, billing_period_start, billing_period_end) WHERE status != 'VOID'`. | **PROTECTED** |
| **10** | **Reused receipt numbers** | Atomic PostgreSQL sequence (`rcpt_seq`) guarantees strictly monotonic, collision-free numbers even under multi-PC concurrency. | **PROTECTED** |
| **11** | **Duplicate GCash references** | Unique database constraint on `gcash_transactions(reference_number)` rejecting collisions with HTTP 409 Conflict. | **PROTECTED** |
| **12** | **Silently hidden collector shortages** | Remittance calculation explicitly checks `Expected - Remitted > 0`. Shortages must be recorded on the collector's shortage ledger. | **PROTECTED** |
| **13** | **Untested backup/restore** | Automated backup via `pg_dump` with pre-flight restoration integrity checks and automated verification scripts. | **PROTECTED** |
| **14** | **Static UI without real financial workflows** | All UI forms bind to actual API endpoints backed by transactional database operations. | **PROTECTED** |
