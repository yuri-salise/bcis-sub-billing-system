# BCIS Subscription Billing and Collection System — Business & Financial Rules

## 1. Monetary Mathematics & Currency Handling

### 1.1 Integer Centavos Standard
- **Zero Floating-Point Representation**: Authoritative financial storage and computations must **NEVER** use standard JavaScript double-precision floats (`Number`).
- **Standard Unit**: All monetary values are represented and stored as **integer centavos** (1 Philippine Peso [PHP / ₱] = 100 Centavos).
  - Example: `₱999.00` is represented internally as integer `99900`.
  - Example: `₱1,499.50` is represented internally as integer `149950`.
- **Database Mapping**: Stored as `BIGINT` in PostgreSQL or `NUMERIC(12, 2)` with strict conversion adapters at the repository boundary.

### 1.2 Formatting and Parsing Helpers
- **Format to Display Currency**:
  ```text
  FormatCurrency(99900)  => "₱999.00"
  FormatCurrency(149950) => "₱1,499.50"
  ```
- **Parse Currency to Centavos**:
  ```text
  ParseCurrency("999.00")    => 99900
  ParseCurrency("1,499.50")  => 149950
  ParseCurrency("999")       => 99900
  ```

### 1.3 Proration and Rounding Rules
- When a subscriber activates or terminates service mid-cycle, charges are prorated:
  $$\text{Prorated Centavos} = \operatorname{RoundHalfUp}\left( \frac{\text{Monthly Recurring Charge (MRC)} \times \text{Active Days in Period}}{\text{Total Days in Period}} \right)$$
- Example: ₱999.00 plan (`99900` centavos) activated on September 16 in a 30-day month (15 active days):
  $$\frac{99900 \times 15}{30} = 49950\text{ centavos} \ (\text{₱499.50})$$

---

## 2. Invoicing & Billing Lifecycle

### 2.1 Billing Cycles
- Subscribers are assigned to a standard billing cycle anchor (e.g., Cycle 1 = 1st of month, Cycle 15 = 15th of month).
- Invoices are generated 5 days prior to the start of the billing period.
- Standard Payment Term: Due date is strictly **15 calendar days** from the invoice issue date.

### 2.2 Invoice State Transitions
```text
┌────────┐       Finalize       ┌────────┐      Due Date Passes      ┌─────────┐
│ DRAFT  ├─────────────────────>│ UNPAID ├──────────────────────────>│ OVERDUE │
└───┬────┘                      └───┬────┘                           └────┬────┘
    │                               │                                     │
    │ Cancel                        │ Payment < Total                     │ Payment < Total
    ▼                               ▼                                     ▼
┌────────┐                  ┌────────────────┐                            │
│  VOID  │                  │ PARTIALLY_PAID │<───────────────────────────┘
└────────┘                  └───────┬────────┘
                                    │
                                    │ Payment >= Total
                                    ▼
                             ┌─────────────┐
                             │    PAID     │
                             └─────────────┘
```

- **DRAFT**: Generated preview; not yet legally posted or reflected on subscriber ledger.
- **UNPAID**: Finalized and posted. A debit is applied to the subscriber ledger. Due date countdown begins.
- **PARTIALLY_PAID**: One or more payments have been allocated, but an outstanding balance remains.
- **PAID**: The total invoice amount has been completely satisfied (remaining balance is exactly 0 centavos).
- **OVERDUE**: The due date has elapsed with a remaining balance > 0. Triggers AR aging and reminder notifications.
- **VOID**: Cancelled prior to payment or due to administrative correction. Invoices with applied payments cannot be voided directly; payments must be reversed first.
- **CREDITED**: Invoice balance cleared entirely through an authorized Credit Adjustment / Credit Memo.

### 2.3 Duplicate Billing Prevention Rule
- The system must prevent duplicate invoicing for the same service account within the same billing period.
- **Enforcement Mechanism**:
  1. Application check before batch generation: skip accounts with an existing non-void invoice for the target period.
  2. Database unique constraint:
     ```sql
     CREATE UNIQUE INDEX unique_active_invoice_per_period
     ON invoices (service_account_id, billing_period_start, billing_period_end)
     WHERE status != 'VOID';
     ```

---

## 3. Subscriber Ledger & Accounting Engine

### 3.1 Double-Entry Debit/Credit Principles
The subscriber account maintains an audit-proof, running transaction ledger:

| Transaction Type | Debit (Increases Balance) | Credit (Decreases Balance) | Impact on Balance |
| :--- | :---: | :---: | :--- |
| **Invoice Issued** | Total Due | — | Increases subscriber arrears |
| **Payment Posted** | — | Paid Amount | Decreases subscriber arrears |
| **Payment Reversal** | Reversed Amount | — | Restores subscriber arrears |
| **Credit Adjustment** | — | Adjustment Amount | Forgives/discounts balance |
| **Debit Adjustment** | Fee Amount | — | Adds penalty or service fee |

### 3.2 Running Balance Calculation
$$\text{Current Outstanding Balance} = \sum \text{Debits} - \sum \text{Credits}$$
- Balance must be dynamically verifiable by replaying all historical ledger entries.
- Direct mutations to historical ledger rows are strictly prohibited (`UPDATE` and `DELETE` queries are denied via database triggers on `subscriber_ledger`).

---

## 4. Payment Allocation Engine

### 4.1 FIFO (Oldest-Unpaid Invoice First) Default Rule
When a payment is received without specific manual invoice designations:
1. Fetch all unpaid or partially paid invoices for the subscriber ordered chronologically:
   `ORDER BY due_date ASC, created_at ASC`.
2. Allocate the payment amount sequentially:
   - For each invoice, compute $\text{Required} = \text{Total Due} - \text{Total Allocated}$.
   - If $\text{Remaining Payment} \ge \text{Required}$: Allocate `Required` to this invoice; mark invoice as `PAID`; deduct `Required` from `Remaining Payment`.
   - If $0 < \text{Remaining Payment} < \text{Required}$: Allocate all `Remaining Payment` to this invoice; mark invoice as `PARTIALLY_PAID`; set `Remaining Payment` to 0.
3. If all outstanding invoices are satisfied and $\text{Remaining Payment} > 0$:
   - Credit the remaining excess to the subscriber's **Advance Balance / Unallocated Credit** account.

### 4.2 Handling Advance / Overpayments (AT-03)
- If a subscriber pays in advance (e.g., pays ₱3,000 for a ₱1,000/month plan):
  - Current month invoice (₱1,000) is marked `PAID`.
  - Remaining ₱2,000 is stored in `subscribers.advance_credit_centavos = 200000`.
  - When the next month's invoice is finalized, the billing engine automatically applies available advance credit before demanding counter payment.

### 4.3 Payment Reversal Rules (AT-06)
- **Eligibility**: Only authorized roles (`Owner`, `Super Admin`, `Accounting/Auditor`) can execute a reversal.
- **Workflow**:
  1. Mandatory audit reason must be supplied (e.g., "Bounced Check", "Counter Teller Error - Wrong Account").
  2. The original payment row is marked as `is_reversed = true` and linked to a newly created `payment_reversals` record. The original row is **NEVER** deleted.
  3. Every invoice allocation linked to the payment is unlinked:
     - Invoice allocated amounts are decremented.
     - Invoice status reverts to `UNPAID`, `PARTIALLY_PAID`, or `OVERDUE` based on its recalculated balance and due date.
  4. Any advance credit created by the reversed payment is deducted from `subscribers.advance_credit_centavos`.
  5. The associated Official Receipt is updated to status `REVERSED`.
  6. A compensatory debit row is inserted into `subscriber_ledger`.
  7. An immutable audit log entry is written.

---

## 5. GCash Processing Rules

### 5.1 Deduplication & Integrity
- **Unique Reference Number**: Every GCash payment requires a reference number (typically 13 digits). The system must enforce case-insensitive uniqueness across all approved and pending GCash records.
- **Duplicate Prevention (AT-05)**: If a user or cashier submits a GCash reference that already exists in `gcash_transactions` or `payments`, the submission is rejected immediately with a 409 Conflict error.

### 5.2 Two-Stage Verification Discipline
1. **Intake / Queue (`PENDING_VERIFICATION`)**:
   - Customer submits screenshot proof and sender details.
   - Account balance is **NOT** credited. Invoices remain unpaid.
2. **Review & Action**:
   - Cashier or supervisor inspects the uploaded proof image side-by-side with sender name, reference number, and amount.
   - **Reject**: Transaction marked `REJECTED` with mandatory rejection reason (e.g., "Reference blurred", "Amount does not match bill", "Fake receipt").
   - **Verify & Post**: Atomic transaction posts payment to ledger, allocates across invoices, generates Official Receipt, and marks GCash record `VERIFIED`.

---

## 6. Field Collection & Remittance Reconciliation

### 6.1 Batch Lifecycle
Field collectors carry out collections within structured batches:
```text
OPEN ──> IN_PROGRESS ──> SUBMITTED ──> REMITTED ──> RECONCILED ──> CLOSED
```
- **OPEN**: Batch created; collector assigned; route sheet generated.
- **IN_PROGRESS**: Collector active in field.
- **SUBMITTED**: Collector returns to office; field collections entered into system.
- **REMITTED**: Physical currency handed to cashier/supervisor.
- **RECONCILED**: System cash total compared against physical cash turned in.
- **CLOSED**: Fully processed and archived.

### 6.2 Cash Reconciliation Calculation (AT-07, AT-08)
$$\text{Expected Cash} = \sum \text{Amount of all Cash Payments in Batch}$$
$$\text{Remitted Cash} = \text{Actual Cash Counted by Cashier}$$
$$\text{Difference} = \text{Expected Cash} - \text{Remitted Cash}$$

- **Balanced Batch ($\text{Difference} = 0$)**:
  - Remittance matches exactly. Batch transitions to `RECONCILED` and can be immediately `CLOSED`.
- **Shortage ($\text{Difference} > 0$)**:
  - The collector remitted less cash than recorded on issued receipts.
  - The system records a formal **Shortage Entry** against the collector:
    $$\text{Collector Shortage Balance} \mathrel{+}= \text{Difference}$$
  - **Critical Rule**: The system **FORBIDS** silently closing a short batch as balanced. It must be flagged as `RECONCILED_WITH_SHORTAGE` and requires dual-signature approval.
- **Overage ($\text{Difference} < 0$)**:
  - The collector turned in more cash than recorded. Placed in an operational overage holding account for investigation.

---

## 7. Accounts Receivable (AR) Aging & Service Control

### 7.1 Aging Buckets
Aging is evaluated daily based on elapsed days past the invoice due date:
- **Current**: $\text{Due Date} \ge \text{Today}$
- **1–30 Days Past Due**: $1 \le (\text{Today} - \text{Due Date}) \le 30$
- **31–60 Days Past Due**: $31 \le (\text{Today} - \text{Due Date}) \le 60$
- **61–90 Days Past Due**: $61 \le (\text{Today} - \text{Due Date}) \le 90$
- **90+ Days Past Due**: $(\text{Today} - \text{Due Date}) > 90$

### 7.2 Service Suspension Policy
- **Threshold**: An account with an overdue balance $> 0$ past **60 days** (or two consecutive unpaid monthly cycles) is automatically classified as a `Suspension Candidate`.
- **Suspension Notice**: Generated 5 days prior to physical/logical disconnection.
- **Execution**: Service account status changes to `SUSPENDED`. Monthly recurring charges cease while suspended (or a reduced standby fee is charged per plan terms).

### 7.3 Reconnection Policy
- **Prerequisites for Reconnection**:
  1. Full settlement of all delinquent balances (or approved installment plan signed by Owner).
  2. Payment of standard **Reconnection Fee** (₱300.00 / `30000` centavos).
- **Execution**:
  - System generates `Reconnection Work Order`.
  - Service status transitions back to `ACTIVE`.
  - Billing resumes on the next scheduled cycle.
