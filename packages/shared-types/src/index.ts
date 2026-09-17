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
  | 'plans.read'
  | 'plans.write'
  | 'subscribers.read'
  | 'subscribers.write'
  | 'service_accounts.read'
  | 'service_accounts.write'
  | 'invoices.read'
  | 'invoices.generate'
  | 'invoices.void'
  | 'billing.view'
  | 'billing.generate'
  | 'billing.adjust'
  | 'billing.void'
  | 'payment.view'
  | 'payment.create'
  | 'payment.reverse'
  | 'payments.create'
  | 'payments.read'
  | 'payments.reverse'
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
  | 'remittances.manage'
  | 'collections.manage'
  | 'service_orders.create'
  | 'service_orders.read'
  | 'service_orders.update'
  | 'service_orders.complete'
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

// User Information returned in Auth responses
export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  roles: string[];
  permissions: string[];
}

// JWT Token Payload
export interface AuthTokenPayload {
  id: string;
  username: string;
  fullName: string;
  roles: string[];
  permissions: string[];
  jti?: string;
  iat?: number;
  exp?: number;
}

// Response from POST /api/v1/auth/login
export interface LoginResponse {
  token: string;
  user: AuthUser;
}

// Response from GET /api/v1/auth/me
export interface AuthMeResponse {
  user: AuthUser;
}

// Pagination metadata
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Service Plan DTO
export interface ServicePlanDto {
  id: string;
  planCode: string;
  code: string;
  name: string;
  serviceTypeId: string;
  serviceType: string;
  monthlyFeeCentavos: number;
  monthlyRecurringCentavos: number;
  installationFeeCentavos: number;
  bandwidthMbps: number | null;
  channelCount: number | null;
  isActive: boolean;
  createdAt: Date | string;
}

// Subscriber Address DTO
export interface SubscriberAddressDto {
  id: string;
  subscriberId: string;
  addressType: string;
  streetAddress: string;
  barangay: string;
  municipality: string;
  province: string;
  postalCode: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  isPrimary: boolean;
}

// Subscriber DTO
export interface SubscriberDto {
  id: string;
  accountNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  businessName: string | null;
  contactNumber: string;
  alternateContact: string | null;
  email: string | null;
  idType: string | null;
  idNumber: string | null;
  advanceCreditCentavos: number;
  status: string;
  notes: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  addresses?: SubscriberAddressDto[];
  primaryAddress?: SubscriberAddressDto | null;
}

// Service Account DTO
export interface ServiceAccountDto {
  id: string;
  serviceAccountNumber: string;
  subscriberId: string;
  servicePlanId: string;
  installationAddressId: string | null;
  collectorId: string | null;
  collectionAreaId?: string | null;
  collectionRouteId?: string | null;
  billingDayOfMonth: number;
  currentRateCentavos: number;
  status: string;
  activationDate: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  subscriber?: SubscriberDto;
  plan?: ServicePlanDto;
  installationAddress?: SubscriberAddressDto | null;
}

// Invoice Item DTO
export interface InvoiceItemDto {
  id: string;
  invoiceId: string;
  itemType: string;
  description: string;
  amountCentavos: number;
  quantity: number;
}

// Invoice DTO
export interface InvoiceDto {
  id: string;
  invoiceNumber: string;
  serviceAccountId: string;
  subscriberId: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  issueDate: string;
  dueDate: string;
  subtotalCentavos: number;
  vatCentavos: number;
  totalDueCentavos: number;
  allocatedCentavos: number;
  remainingBalanceCentavos: number;
  status: string;
  notes: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  subscriber?: {
    id: string;
    accountNumber: string;
    firstName: string;
    lastName: string;
    businessName: string | null;
  };
  serviceAccount?: {
    id: string;
    serviceAccountNumber: string;
    status: string;
    planName?: string;
  };
  items?: InvoiceItemDto[];
  lineItems?: InvoiceItemDto[];
}

// Detailed Invoice with relations and payment allocations
export interface InvoiceDetailDto extends InvoiceDto {
  subscriber: SubscriberDto;
  serviceAccount: ServiceAccountDto;
  lineItems: InvoiceItemDto[];
  paymentAllocations: Array<{
    id: string;
    paymentId: string;
    allocatedCentavos: number;
    paymentNumber?: string;
    paymentDate?: string | Date;
    paymentMethod?: string;
  }>;
}

// Bulk Batch Generation Result DTO
export interface GenerateInvoiceBatchResultDto {
  totalProcessed: number;
  generatedCount: number;
  skippedCount: number;
  invoices: InvoiceDto[];
  skippedAccounts?: Array<{
    serviceAccountId: string;
    serviceAccountNumber: string;
    reason: string;
  }>;
}

// Payment Allocation DTO
export interface PaymentAllocationDto {
  id: string;
  paymentId: string;
  invoiceId: string;
  allocatedCentavos: number;
  createdAt: Date | string;
  invoice?: {
    id: string;
    invoiceNumber: string;
    totalDueCentavos: number;
    remainingBalanceCentavos: number;
    status: string;
    billingPeriodStart?: string;
    billingPeriodEnd?: string;
  };
}

// Receipt DTO
export interface ReceiptDto {
  id: string;
  receiptNumber: string;
  paymentId: string;
  cashierId: string;
  totalAmountCentavos: number;
  status: string;
  issuedAt: Date | string;
  cashierName?: string;
}

// Payment DTO
export interface PaymentDto {
  id: string;
  paymentNumber: string;
  subscriberId: string;
  cashierId: string;
  paymentDate: Date | string;
  paymentMethod: PaymentMethod | string;
  referenceNumber: string | null;
  amountCentavos: number;
  isReversed: boolean;
  notes: string | null;
  createdAt: Date | string;
  subscriber?: {
    id: string;
    accountNumber: string;
    firstName: string;
    lastName: string;
    businessName: string | null;
  };
  cashier?: {
    id: string;
    username: string;
    fullName: string;
  };
  receipt?: ReceiptDto | null;
  allocations?: PaymentAllocationDto[];
  advanceCreditAddedCentavos?: number;
}

// Payment Detail DTO
export interface PaymentDetailDto extends PaymentDto {
  reversal?: {
    id: string;
    reversedBy: string;
    reversedByName?: string;
    reason: string;
    reversalDate: Date | string;
  } | null;
}

// GCash Transaction DTO
export interface GCashTransactionDto {
  id: string;
  referenceNumber: string;
  subscriberId: string | null;
  senderName: string;
  senderPhone: string;
  amountCentavos: number;
  proofImagePath: string;
  status: GCashStatus | string;
  verifiedBy: string | null;
  verifiedAt: Date | string | null;
  rejectionReason: string | null;
  createdAt: Date | string;
  subscriber?: {
    id: string;
    accountNumber: string;
    firstName: string;
    lastName: string;
  } | null;
}

// Collection Batch DTO
export interface CollectionBatchDto {
  id: string;
  batchNumber: string;
  collectorId: string;
  collectionAreaId: string;
  status: CollectionBatchStatus | string;
  expectedCashCentavos: number;
  remittedCashCentavos: number;
  differenceCentavos: number;
  openedAt: Date | string;
  closedAt: Date | string | null;
  collector?: {
    id: string;
    username: string;
    fullName: string;
  };
  collectionArea?: {
    id: string;
    name: string;
  };
}

// Service Order Lifecycle Types
export enum ServiceOrderType {
  INSTALLATION = 'INSTALLATION',
  REPAIR = 'REPAIR',
  DISCONNECTION = 'DISCONNECTION',
  RECONNECTION = 'RECONNECTION',
  RELOCATION = 'RELOCATION',
  TRANSFER = 'TRANSFER',
}

export enum ServiceOrderStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum ServiceOrderPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export interface MaterialUsedItem {
  item: string;
  quantity: number;
  unit?: string;
  costCentavos?: number;
}

export interface ServiceOrderDto {
  id: string;
  orderNumber: string;
  orderType: ServiceOrderType | string;
  status: ServiceOrderStatus | string;
  serviceAccountId: string;
  subscriberId: string;
  assignedTechnicianId: string | null;
  priority: ServiceOrderPriority | string;
  scheduledDate: string | null;
  completedAt: Date | string | null;
  cancelledAt: Date | string | null;
  cancellationReason: string | null;
  targetAddressId: string | null;
  description: string | null;
  resolutionNotes: string | null;
  materialsUsed: MaterialUsedItem[] | null;
  feeCentavos: number;
  disconnectionType?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  serviceAccount?: {
    id: string;
    serviceAccountNumber: string;
    status: string;
    planName?: string;
    currentRateCentavos?: number;
  };
  subscriber?: {
    id: string;
    accountNumber: string;
    firstName: string;
    lastName: string;
    contactNumber?: string;
  };
  assignedTechnician?: {
    id: string;
    username: string;
    fullName: string;
  } | null;
}

// Collection Area DTO
export interface CollectionAreaDto {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  barangay?: string | null;
  city?: string;
  assignedCollectorId?: string | null;
  isActive?: boolean;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  assignedCollector?: {
    id: string;
    username: string;
    fullName: string;
  } | null;
  routeCount?: number;
  accountCount?: number;
}

// Collection Route DTO
export interface CollectionRouteDto {
  id: string;
  collectionAreaId: string;
  routeCode: string;
  name: string;
  description?: string | null;
  assignedCollectorId?: string | null;
  isActive?: boolean;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  collectionArea?: {
    id: string;
    name: string;
  };
  assignedCollector?: {
    id: string;
    username: string;
    fullName: string;
  } | null;
}

// Route Sheet Account Item
export interface RouteSheetAccountItem {
  serviceAccountId: string;
  serviceAccountNumber: string;
  subscriberId: string;
  subscriberAccountNumber: string;
  subscriberName: string;
  contactNumber: string;
  address: string;
  barangay: string;
  collectionRouteId?: string | null;
  servicePlanName: string;
  monthlyRateCentavos: number;
  status: string;
  openInvoiceCount: number;
  oldestInvoiceDueDate: string | null;
  totalArrearsCentavos: number;
  advanceCreditCentavos: number;
  netDueCentavos: number;
}

// Route Sheet DTO
export interface RouteSheetDto {
  area: {
    id: string;
    name: string;
    code?: string | null;
    barangay?: string | null;
  };
  route?: {
    id: string;
    routeCode: string;
    name: string;
  } | null;
  collector: {
    id: string;
    username: string;
    fullName: string;
  } | null;
  generatedAt: string;
  totalAccounts: number;
  totalDelinquentAccounts: number;
  totalArrearsCentavos: number;
  accounts: RouteSheetAccountItem[];
}



