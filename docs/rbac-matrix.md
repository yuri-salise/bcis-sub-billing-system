# BCIS Subscription Billing and Collection System — Role-Based Access Control (RBAC) Matrix

## 1. Security Philosophy & Principles
1. **Server-Side Exclusivity**: Authorization is strictly enforced on the Fastify API server. Client-side UI element hiding is purely an ergonomics feature to reduce visual clutter; it is **never** relied upon as a security boundary.
2. **Principle of Least Privilege**: Users are granted only the minimum set of permissions necessary to execute their operational duties.
3. **Immutability of Audit Trails**: No role—including Super Admin—is permitted to edit or delete records in the `audit_logs` table.

---

## 2. Defined System Roles

| Role Identifier | Role Name | Description |
| :--- | :--- | :--- |
| `ROLE_SUPER_ADMIN` | **Owner / Super Admin** | Business owner or executive with unrestricted operational, financial, and administrative authority. |
| `ROLE_ADMIN` | **Administrator** | Office manager overseeing user accounts, service plans, billing batch runs, and general reporting. |
| `ROLE_CASHIER` | **Cashier** | Counter teller receiving payments, issuing receipts, and processing the GCash verification queue. |
| `ROLE_COLLECTION_SUPV` | **Collection Supervisor**| Operations coordinator overseeing field collectors, route sheets, collection batches, and remittance reconciliation. |
| `ROLE_ACCOUNTING` | **Accounting / Auditor**| Financial controller reviewing subscriber ledgers, AR aging, payment reversals, and tax/revenue reports. |
| `ROLE_TECHNICIAN` | **Technician** | Field staff recording service installations, disconnections, and reconnections. |
| `ROLE_VIEWER` | **Read-only Viewer** | Trainee, clerk, or auditor with non-modifying view access. |

---

## 3. Granular Permissions Catalog

| Permission Code | Description | Risk Level |
| :--- | :--- | :---: |
| `subscriber.view` | View subscriber list, profiles, and basic contact information | Low |
| `subscriber.create` | Register new subscriber entity | Medium |
| `subscriber.update` | Update subscriber profile details and addresses | Medium |
| `subscriber.archive` | Deactivate/archive a subscriber (soft delete) | High |
| `service_account.view` | View service accounts and technical provisions | Low |
| `service_account.create` | Provision a new service account under a subscriber | Medium |
| `service_account.update` | Modify installation address, plan binding, or status | High |
| `service_plan.view` | View catalog of broadband and CATV plans | Low |
| `service_plan.manage` | Create or update plans, pricing, and bandwidth tiers | High |
| `billing.view` | View invoices, line items, and billing history | Low |
| `billing.generate` | Trigger monthly billing batch run | High |
| `billing.adjust` | Issue debit/credit adjustment memos | High |
| `billing.void` | Void an unpaid draft or incorrect invoice | Critical |
| `payment.view` | View counter payments, allocations, and receipts | Low |
| `payment.create` | Receive payment, allocate funds, and issue receipt | Medium |
| `payment.reverse` | Execute payment reversal and restore balances | Critical |
| `receipt.view` | View and preview issued official receipts | Low |
| `receipt.reprint` | Reprint duplicate copy of official receipt | Medium |
| `gcash.view` | View pending and historical GCash verification queue | Low |
| `gcash.submit` | Upload screenshot and log incoming GCash transaction | Low |
| `gcash.verify` | Approve GCash proof and post payment to ledger | High |
| `gcash.reject` | Reject GCash proof with documented reason | Medium |
| `collection.view` | View collection areas, routes, and batch statuses | Low |
| `collection.batch_create`| Open a new field collection batch and print route sheet | Medium |
| `collection.enter_field` | Enter collected field receipts into a batch | Medium |
| `collection.reconcile` | Verify cash count, calculate differences, record shortages | High |
| `collection.manage_staff`| Manage collectors, routes, and commission settings | Medium |
| `receivable.view` | View accounts receivable lists and delinquency summary | Low |
| `receivable.view_aging` | Access AR aging buckets (Current, 1-30, 31-60, 61-90, 90+) | Medium |
| `service_control.view` | View suspension candidates and disconnection orders | Low |
| `service_control.suspend`| Approve and execute service suspension | High |
| `service_control.reconnect`| Approve and execute service reconnection | High |
| `report.operational` | Export operational reports (Subscriber list, Route sheets)| Medium |
| `report.financial` | Export financial reports (Daily collection, SOA, Revenue) | High |
| `user.manage` | Create employees, assign roles, deactivate users | Critical |
| `user.reset_password` | Reset passwords for staff members | High |
| `audit.view` | Query and inspect immutable system audit trail | High |
| `audit.export` | Export audit trail to PDF/XLSX | High |
| `backup.create` | Trigger on-demand database backup | High |
| `backup.restore` | Restore database snapshot from archive | Critical |
| `settings.manage` | Update company info, billing cycles, late fee parameters | High |

---

## 4. Master Role-to-Permission Matrix

Legend:
- ✅ **Granted**: Unrestricted access within role scope
- ⚠️ **Conditional**: Requires dual-authorization or supervisor approval
- ❌ **Denied**: Explicitly blocked with HTTP 403 Forbidden

| Permission Code | Super Admin | Admin | Cashier | Collection Supv | Accounting | Technician | Viewer |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `subscriber.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `subscriber.create` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `subscriber.update` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `subscriber.archive` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `service_account.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `service_account.create` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `service_account.update` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `service_plan.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `service_plan.manage` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `billing.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `billing.generate` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `billing.adjust` | ✅ | ⚠️ | ❌ | ❌ | ⚠️ | ❌ | ❌ |
| `billing.void` | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `payment.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `payment.create` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `payment.reverse` | ✅ | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ |
| `receipt.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `receipt.reprint` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `gcash.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `gcash.submit` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `gcash.verify` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `gcash.reject` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `collection.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `collection.batch_create` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `collection.enter_field` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `collection.reconcile` | ✅ | ✅ | ❌ | ✅ | ⚠️ | ❌ | ❌ |
| `collection.manage_staff`| ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `receivable.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `receivable.view_aging` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| `service_control.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `service_control.suspend` | ✅ | ✅ | ❌ | ⚠️ | ❌ | ✅ | ❌ |
| `service_control.reconnect`| ✅ | ✅ | ❌ | ⚠️ | ❌ | ✅ | ❌ |
| `report.operational` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| `report.financial` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `user.manage` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `user.reset_password` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `audit.view` | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `audit.export` | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `backup.create` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `backup.restore` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `settings.manage` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 5. Technical Enforcement Implementation

### 5.1 Server-Side Hook Pipeline
Fastify enforces permissions via a reusable `preHandler` factory:

```typescript
// Example: src/middleware/rbac.ts
export function requirePermission(permission: PermissionCode) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!user) {
      return reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Authentication required"
      });
    }

    const hasPermission = user.permissions.includes(permission) ||
                          user.roles.includes("ROLE_SUPER_ADMIN");

    if (!hasPermission) {
      request.log.warn({
        userId: user.id,
        requiredPermission: permission,
        userRoles: user.roles
      }, "RBAC Access Denied");

      return reply.status(403).send({
        statusCode: 403,
        error: "Forbidden",
        message: `Insufficient permissions: missing ${permission}`
      });
    }
  };
}
```

### 5.2 Acceptance Test AT-10 Verification
Acceptance Test **AT-10** explicitly validates that when an authenticated user with role `ROLE_CASHIER` attempts to invoke an endpoint requiring `user.manage` (e.g., `POST /api/v1/users`), the server rejects the request with HTTP 403 Forbidden, even if client-side validation is completely bypassed.
