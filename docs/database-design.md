# BCIS Subscription Billing and Collection System — Database Design Specification

## 1. Database Architecture & Engine Settings

- **RDBMS Engine**: PostgreSQL 16+ / 17
- **Collation / Encoding**: `UTF-8`
- **Isolation Level**: `READ COMMITTED` default; `SERIALIZABLE` or pessimistic locking (`SELECT ... FOR UPDATE`) during concurrent financial transactions
- **Time Zone**: `Asia/Manila` (UTC+08:00) stored as `TIMESTAMPTZ`
- **Monetary Types**: All monetary columns are typed as `BIGINT` representing integer centavos (1 PHP = 100 Centavos) or `NUMERIC(12, 2)` to eliminate floating-point representation errors

---

## 2. Entity-Relationship & Table Schemas

### 2.1 Security & Access Control

```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(128) NOT NULL,
  email VARCHAR(128),
  is_active BOOLEAN NOT NULL DEFAULT true,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Roles table
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(32) NOT NULL UNIQUE, -- e.g. ROLE_CASHIER, ROLE_ADMIN
  name VARCHAR(64) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Permissions catalog
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(64) NOT NULL UNIQUE, -- e.g. payment.create, billing.void
  module VARCHAR(32) NOT NULL,
  description TEXT,
  risk_level VARCHAR(16) NOT NULL DEFAULT 'Medium'
);

-- Role Permissions junction
CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- User Roles junction
CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);
```

### 2.2 Subscribers & Contacts

```sql
-- Subscriber Master
CREATE TABLE subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number VARCHAR(32) NOT NULL UNIQUE, -- e.g. SUB-202609-0001
  first_name VARCHAR(64) NOT NULL,
  middle_name VARCHAR(64),
  last_name VARCHAR(64) NOT NULL,
  business_name VARCHAR(128),
  contact_number VARCHAR(32) NOT NULL,
  alternate_contact VARCHAR(32),
  email VARCHAR(128),
  id_type VARCHAR(32),
  id_number VARCHAR(64),
  advance_credit_centavos BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, INACTIVE, TERMINATED, ARCHIVED
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscribers_account_no ON subscribers(account_number);
CREATE INDEX idx_subscribers_name ON subscribers(last_name, first_name);
CREATE INDEX idx_subscribers_contact ON subscribers(contact_number);

-- Subscriber Addresses
CREATE TABLE subscriber_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  address_type VARCHAR(20) NOT NULL DEFAULT 'BILLING', -- BILLING, INSTALLATION
  street_address TEXT NOT NULL,
  barangay VARCHAR(64) NOT NULL,
  municipality VARCHAR(64) NOT NULL DEFAULT 'Malaybalay',
  province VARCHAR(64) NOT NULL DEFAULT 'Bukidnon',
  postal_code VARCHAR(10) DEFAULT '8700',
  latitude NUMERIC(10, 8),
  longitude NUMERIC(11, 8),
  is_primary BOOLEAN NOT NULL DEFAULT true
);
```

### 2.3 Service Plans & Accounts

```sql
-- Service Types (Broadband, CATV, Combo)
CREATE TABLE service_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE, -- INTERNET, CABLE_TV, COMBO
  name VARCHAR(64) NOT NULL
);

-- Service Plans Catalog
CREATE TABLE service_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type_id UUID NOT NULL REFERENCES service_types(id),
  plan_code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  monthly_recurring_centavos BIGINT NOT NULL,
  installation_fee_centavos BIGINT NOT NULL DEFAULT 0,
  bandwidth_mbps INT, -- for Internet
  channel_count INT,   -- for Cable
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Service Accounts
CREATE TABLE service_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_account_number VARCHAR(32) NOT NULL UNIQUE, -- e.g. SA-202609-0001
  subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE RESTRICT,
  service_plan_id UUID NOT NULL REFERENCES service_plans(id) ON DELETE RESTRICT,
  installation_address_id UUID REFERENCES subscriber_addresses(id),
  collector_id UUID REFERENCES users(id),
  billing_day_of_month INT NOT NULL DEFAULT 1,
  current_rate_centavos BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- PENDING_INSTALL, ACTIVE, SUSPENDED, TERMINATED
  activation_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_accounts_no ON service_accounts(service_account_number);
CREATE INDEX idx_service_accounts_status ON service_accounts(status);
CREATE INDEX idx_service_accounts_subscriber ON service_accounts(subscriber_id);
```

### 2.4 Invoicing & Billing

```sql
-- Invoices
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number VARCHAR(32) NOT NULL UNIQUE, -- e.g. INV-202609-000001
  service_account_id UUID NOT NULL REFERENCES service_accounts(id) ON DELETE RESTRICT,
  subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE RESTRICT,
  billing_period_start DATE NOT NULL,
  billing_period_end DATE NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  subtotal_centavos BIGINT NOT NULL,
  vat_centavos BIGINT NOT NULL DEFAULT 0,
  total_due_centavos BIGINT NOT NULL,
  allocated_centavos BIGINT NOT NULL DEFAULT 0,
  remaining_balance_centavos BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'UNPAID', -- DRAFT, UNPAID, PARTIALLY_PAID, PAID, OVERDUE, VOID, CREDITED
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index to prevent duplicate billing per period (AT-11)
CREATE UNIQUE INDEX unique_active_invoice_per_period
ON invoices (service_account_id, billing_period_start, billing_period_end)
WHERE status != 'VOID';

CREATE INDEX idx_invoices_due_date ON invoices(due_date);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_service_account ON invoices(service_account_id);

-- Invoice Line Items
CREATE TABLE invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_type VARCHAR(32) NOT NULL, -- PLAN_CHARGE, PRORATED_CHARGE, INSTALLMENT, PENALTY
  description VARCHAR(255) NOT NULL,
  amount_centavos BIGINT NOT NULL,
  quantity INT NOT NULL DEFAULT 1
);
```

### 2.5 Payments, Allocations & Receipts

```sql
-- Payments
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number VARCHAR(32) NOT NULL UNIQUE,
  subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE RESTRICT,
  cashier_id UUID NOT NULL REFERENCES users(id),
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payment_method VARCHAR(20) NOT NULL, -- CASH, GCASH, BANK_TRANSFER, CHECK
  reference_number VARCHAR(64),
  amount_centavos BIGINT NOT NULL,
  is_reversed BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_date ON payments(payment_date);
CREATE INDEX idx_payments_reference ON payments(reference_number);

-- Payment Allocations (Invoice <-> Payment junction)
CREATE TABLE payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  allocated_centavos BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Official Receipts
CREATE TABLE receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number VARCHAR(32) NOT NULL UNIQUE, -- OR-2026-XXXXXX
  payment_id UUID NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  cashier_id UUID NOT NULL REFERENCES users(id),
  total_amount_centavos BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ISSUED', -- ISSUED, REVERSED
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payment Reversals (AT-06)
CREATE TABLE payment_reversals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  reversed_by UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  reversal_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- GCash Verification Queue (AT-05)
CREATE TABLE gcash_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number VARCHAR(64) NOT NULL UNIQUE,
  subscriber_id UUID REFERENCES subscribers(id),
  sender_name VARCHAR(128) NOT NULL,
  sender_phone VARCHAR(32) NOT NULL,
  amount_centavos BIGINT NOT NULL,
  proof_image_path TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING_VERIFICATION', -- PENDING_VERIFICATION, VERIFIED, REJECTED
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2.6 Subscriber Running Ledger

```sql
CREATE TABLE subscriber_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE RESTRICT,
  entry_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entry_type VARCHAR(32) NOT NULL, -- INVOICE_ISSUED, PAYMENT_POSTED, REVERSAL, CREDIT_ADJUSTMENT, DEBIT_ADJUSTMENT
  reference_id VARCHAR(64) NOT NULL,
  description VARCHAR(255) NOT NULL,
  debit_centavos BIGINT NOT NULL DEFAULT 0,
  credit_centavos BIGINT NOT NULL DEFAULT 0,
  balance_after_centavos BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriber_ledger_sub_date ON subscriber_ledger(subscriber_id, entry_date);
```

### 2.7 Field Collections & Remittances

```sql
CREATE TABLE collection_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(128) NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE collection_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number VARCHAR(32) NOT NULL UNIQUE,
  collector_id UUID NOT NULL REFERENCES users(id),
  collection_area_id UUID NOT NULL REFERENCES collection_areas(id),
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN', -- OPEN, IN_PROGRESS, SUBMITTED, REMITTED, RECONCILED, CLOSED
  expected_cash_centavos BIGINT NOT NULL DEFAULT 0,
  remitted_cash_centavos BIGINT NOT NULL DEFAULT 0,
  difference_centavos BIGINT NOT NULL DEFAULT 0,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);
```

### 2.8 Audit Logging

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  actor_name VARCHAR(128) NOT NULL,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  old_values JSONB,
  new_values JSONB,
  reason TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_date ON audit_logs(created_at);
```
