// User Roles in BCIS
export enum UserRole {
  SUPER_ADMIN = 'ROLE_SUPER_ADMIN',
  ADMIN = 'ROLE_ADMIN',
  CASHIER = 'ROLE_CASHIER',
  COLLECTION_SUPERVISOR = 'ROLE_COLLECTION_SUPV',
  ACCOUNTING = 'ROLE_ACCOUNTING',
  TECHNICIAN = 'ROLE_TECHNICIAN',
  VIEWER = 'ROLE_VIEWER',
}

// Granular Permissions
export type PermissionCode =
  | 'subscriber.view'
  | 'subscriber.create'
  | 'subscriber.update'
  | 'subscriber.archive'
  | 'service_account.view'
  | 'service_account.create'
  | 'service_account.update'
  | 'service_plan.view'
  | 'service_plan.manage'
  | 'billing.view'
  | 'billing.generate'
  | 'billing.adjust'
  | 'billing.void'
  | 'payment.view'
  | 'payment.create'
  | 'payment.reverse'
  | 'receipt.view'
  | 'receipt.reprint'
  | 'gcash.view'
  | 'gcash.submit'
  | 'gcash.verify'
  | 'gcash.reject'
  | 'collection.view'
  | 'collection.batch_create'
  | 'collection.enter_field'
  | 'collection.reconcile'
  | 'collection.manage_staff'
  | 'receivable.view'
  | 'receivable.view_aging'
  | 'service_control.view'
  | 'service_control.suspend'
  | 'service_control.reconnect'
  | 'report.operational'
  | 'report.financial'
  | 'user.manage'
  | 'user.reset_password'
  | 'audit.view'
  | 'audit.export'
  | 'backup.create'
  | 'backup.restore'
  | 'settings.manage';

// Subscriber Lifecycle Statuses
export enum SubscriberStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  TERMINATED = 'TERMINATED',
  ARCHIVED = 'ARCHIVED',
}

// Service Types
export enum ServiceTypeCode {
  INTERNET = 'INTERNET',
  CABLE_TV = 'CABLE_TV',
  COMBO = 'COMBO',
}

// Service Account Statuses
export enum ServiceAccountStatus {
  PENDING_INSTALL = 'PENDING_INSTALL',
  ACTIVE = 'ACTIVE',
  TEMPORARILY_DISCONNECTED = 'TEMPORARILY_DISCONNECTED',
  SUSPENDED = 'SUSPENDED',
  TERMINATED = 'TERMINATED',
}

// Invoice Lifecycle Statuses
export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  UNPAID = 'UNPAID',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  VOID = 'VOID',
  CREDITED = 'CREDITED',
}

// Payment Methods
export enum PaymentMethod {
  CASH = 'CASH',
  GCASH = 'GCASH',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CHECK = 'CHECK',
}

// Receipt Statuses
export enum ReceiptStatus {
  ISSUED = 'ISSUED',
  REVERSED = 'REVERSED',
}

// GCash Queue Statuses
export enum GCashStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

// Collection Batch Statuses
export enum CollectionBatchStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  SUBMITTED = 'SUBMITTED',
  REMITTED = 'REMITTED',
  RECONCILED = 'RECONCILED',
  RECONCILED_WITH_SHORTAGE = 'RECONCILED_WITH_SHORTAGE',
  CLOSED = 'CLOSED',
}

// AR Aging Buckets
export enum AgingBucket {
  CURRENT = 'CURRENT',
  DAYS_1_30 = 'DAYS_1_30',
  DAYS_31_60 = 'DAYS_31_60',
  DAYS_61_90 = 'DAYS_61_90',
  DAYS_90_PLUS = 'DAYS_90_PLUS',
}

// System Health Response
export interface HealthStatusResponse {
  status: 'ok' | 'degraded' | 'error';
  database: 'connected' | 'disconnected';
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

// Standard API Error Envelope
export interface ApiErrorResponse {
  statusCode: number;
  error: string;
  code?: string;
  message: string;
  details?: Array<{ field: string; issue: string }>;
  timestamp: string;
}
