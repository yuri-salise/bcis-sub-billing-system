# BCIS Subscription Billing and Collection System — API Design Specification

## 1. Overview & Architectural Standards

The BCIS backend is exposed via a **Fastify 5 RESTful API** running on the office central server workstation, listening across the private office LAN (`0.0.0.0:4000`). All interactions from the three office workstations (Owner/Admin, Cashier, Operations) communicate exclusively through this API.

### 1.1 Core API Principles
1. **REST Resource Conventions**: Standard HTTP verbs (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) with plural noun endpoints (e.g., `/api/v1/subscribers`, `/api/v1/payments`).
2. **Standard API Prefix**: All application endpoints are versioned under `/api/v1/*`.
3. **Health Check Probes**: Unauthenticated `/health` and `/api/v1/health` return system status, database connectivity, uptime, and server timestamp.
4. **Content Negotiation**: Request and response payloads default to `application/json` (UTF-8). Multipart file uploads (`multipart/form-data`) are supported for GCash proof screenshots and KYC document uploads.
5. **Exact Financial Units**: Monetary query parameters and JSON response fields represent currency as **integer centavos** (e.g., `amount_centavos: 99900` for ₱999.00). Floating-point figures are strictly prohibited in API contracts.
6. **Unified Error Envelope**: All 4xx and 5xx responses conform to a strict RFC 7807-compatible structure:
   ```json
   {
     "statusCode": 400,
     "error": "Bad Request",
     "code": "INVALID_INPUT",
     "message": "Validation failed",
     "details": [
       { "field": "amount_centavos", "issue": "Must be greater than zero" }
     ],
     "timestamp": "2026-09-14T07:00:00.000Z"
   }
   ```
7. **Pagination and Filtering Standard**:
   - `GET` endpoints listing collections support `page` (default `1`), `limit` (default `25`, max `100`), `sort_by`, and `sort_dir` (`asc` | `desc`).
   - Standard paginated response envelope:
     ```json
     {
       "data": [ ... ],
       "meta": {
         "page": 1,
         "limit": 25,
         "total": 142,
         "total_pages": 6
       }
     }
     ```

---

## 2. Authentication & Session Management

All protected endpoints require an HTTP `Authorization: Bearer <token>` header containing a cryptographically signed JWT or secure session token.

### Endpoints:
- `POST /api/v1/auth/login`: Authenticate username and password. Returns JWT token, user profile, assigned roles, and granular permissions list.
- `POST /api/v1/auth/logout`: Revoke active session token.
- `GET /api/v1/auth/me`: Fetch authenticated user profile, permissions, and active workstation session.
- `POST /api/v1/auth/lock`: Trigger desktop session screen lock state.
- `POST /api/v1/auth/unlock`: Verify password to restore locked workstation screen without destroying state.

---

## 3. Detailed Endpoint Catalog by Domain

### 3.1 Subscribers (`/api/v1/subscribers`)
- `GET /api/v1/subscribers`: Search and list subscribers. Filters: `q` (name, account number, phone), `status`, `area_id`, `collector_id`.
- `POST /api/v1/subscribers`: Register a new subscriber entity with contact details and billing address. (Required permission: `subscriber.create`).
- `GET /api/v1/subscribers/:id`: Retrieve subscriber master record with service accounts summary, advance credit balance, and ledger balance.
- `PUT /api/v1/subscribers/:id`: Update subscriber demographic details. (Required permission: `subscriber.update`).
- `PATCH /api/v1/subscribers/:id/archive`: Transition subscriber to `ARCHIVED`. Rejects if outstanding balance exists. (Required permission: `subscriber.archive`).
- `GET /api/v1/subscribers/:id/ledger`: Fetch running subscriber ledger with debits, credits, and historical balance trail.
- `GET /api/v1/subscribers/:id/statement`: Generate printable Statement of Account (SOA) data.

### 3.2 Service Plans & Accounts (`/api/v1/service-plans`, `/api/v1/service-accounts`)
- `GET /api/v1/service-plans`: List broadband, CATV, and combo plans.
- `POST /api/v1/service-plans`: Create a new service plan. (Required permission: `service_plan.manage`).
- `PUT /api/v1/service-plans/:id`: Update plan terms/price (affects future billing only).
- `GET /api/v1/service-accounts`: Query service accounts with filters (`status`, `area_id`, `plan_id`).
- `POST /api/v1/service-accounts`: Provision a new service account under a subscriber. (Required permission: `service_account.create`).
- `GET /api/v1/service-accounts/:id`: Get detailed service account profile, hardware serial numbers, and event history.
- `PATCH /api/v1/service-accounts/:id/collector`: Assign/reassign collection route or collector.

### 3.3 Billing & Invoices (`/api/v1/billing`, `/api/v1/invoices`)
- `POST /api/v1/billing/generate`: Execute batch monthly invoice generation for a specific billing cycle. Idempotent; duplicate billing requests for identical cycles are rejected. (Required permission: `billing.generate`).
- `GET /api/v1/invoices`: List and filter invoices by date range, status (`UNPAID`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`), subscriber, and due date.
- `GET /api/v1/invoices/:id`: Fetch invoice details including line items, allocations, and remaining balance.
- `POST /api/v1/invoices/:id/adjust`: Create a debit or credit adjustment memo with mandatory audit reason. (Required permission: `billing.adjust`).
- `POST /api/v1/invoices/:id/void`: Void an unpaid invoice. Rejects if payments have been allocated. (Required permission: `billing.void`).

### 3.4 Payments & Receipts (`/api/v1/payments`, `/api/v1/receipts`)
- `POST /api/v1/payments`: Post counter payment (Cash, GCash, Bank, Check). Executes atomic FIFO allocation, ledger update, and receipt generation. (Required permission: `payment.create`).
- `GET /api/v1/payments`: Query payment history. Filters: `date_from`, `date_to`, `method`, `cashier_id`, `subscriber_id`.
- `GET /api/v1/payments/:id`: Get payment details, allocated invoices, and receipt reference.
- `POST /api/v1/payments/:id/reverse`: Reverse payment, unlinking allocations, restoring invoice arrears, and marking receipt `REVERSED`. (Required permission: `payment.reverse`).
- `GET /api/v1/receipts/:id`: Fetch printable official receipt data by receipt number or ID.
- `POST /api/v1/receipts/:id/reprint`: Log reprint event and return official receipt formatted for thermal or dot-matrix printing.

### 3.5 GCash Intake & Verification (`/api/v1/gcash`)
- `GET /api/v1/gcash/queue`: Fetch pending GCash submissions for review.
- `POST /api/v1/gcash/submit`: Intake transaction with reference number, amount, sender details, and uploaded screenshot. Blocks duplicate references with HTTP 409. (Required permission: `gcash.submit`).
- `POST /api/v1/gcash/:id/verify`: Approve transaction and trigger atomic payment posting to subscriber ledger. (Required permission: `gcash.verify`).
- `POST /api/v1/gcash/:id/reject`: Reject transaction with documented reason. (Required permission: `gcash.reject`).

### 3.6 Collections & Remittance (`/api/v1/collections`)
- `GET /api/v1/collections/areas`: List municipal collection areas and routes.
- `POST /api/v1/collections/batches`: Open a new collection batch for a designated collector.
- `GET /api/v1/collections/batches/:id/route-sheet`: Generate printable route sheet data with assigned accounts and arrears.
- `POST /api/v1/collections/batches/:id/entries`: Batch log field payments collected on the route.
- `POST /api/v1/collections/batches/:id/submit`: Mark batch submitted by collector.
- `POST /api/v1/collections/batches/:id/reconcile`: Record physical cash remitted, calculate expected cash vs remitted cash, flag shortages/overages, and update collector accountability ledger. (Required permission: `collection.reconcile`).
- `POST /api/v1/collections/batches/:id/close`: Finalize and close balanced or supervisor-approved batch.

### 3.7 Receivables & Service Control (`/api/v1/receivables`, `/api/v1/suspensions`)
- `GET /api/v1/receivables/aging`: Calculate AR aging buckets (`Current`, `1-30`, `31-60`, `61-90`, `90+`) across the subscriber base.
- `GET /api/v1/receivables/delinquent`: List overdue accounts sorted by delinquency age.
- `GET /api/v1/receivables/suspension-candidates`: Query accounts meeting suspension threshold (60+ days overdue).
- `POST /api/v1/suspensions`: Issue service suspension order with notice date and technician assignment. (Required permission: `service_control.suspend`).
- `POST /api/v1/reconnections`: Issue service reconnection order following delinquent balance settlement and reconnection fee payment. (Required permission: `service_control.reconnect`).

### 3.8 Reports & Analytics (`/api/v1/reports`)
- `GET /api/v1/reports/daily-collection`: Daily collection report by cashier and payment method.
- `GET /api/v1/reports/monthly-revenue`: Monthly billed revenue vs. collected cash.
- `GET /api/v1/reports/ar-aging`: Detailed aging schedule.
- `GET /api/v1/reports/collector-remittance`: Collector cash turned in vs. shortages.
- `GET /api/v1/reports/reversals`: Audit list of payment reversals and voided invoices.
- Query parameter `format=pdf` or `format=xlsx` triggers file streaming with proper MIME types (`application/pdf`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).

### 3.9 System Administration & Backups (`/api/v1/admin`, `/api/v1/audit`, `/api/v1/backup`)
- `GET /api/v1/users`: List office staff user accounts.
- `POST /api/v1/users`: Create user account and assign roles. (Required permission: `user.manage`).
- `PUT /api/v1/users/:id/roles`: Update user role assignments.
- `GET /api/v1/audit`: Query append-only audit trail with entity and date filters. (Required permission: `audit.view`).
- `POST /api/v1/backup/create`: Trigger immediate `pg_dump` database backup. (Required permission: `backup.create`).
- `GET /api/v1/backup/history`: List available backup archives and file sizes.
- `POST /api/v1/backup/restore`: Execute database restore from selected archive after safety checks. (Required permission: `backup.restore`).
