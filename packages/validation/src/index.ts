import { z } from 'zod';
import { PaymentMethod } from '@bcis/shared-types';

// Philippine Mobile Phone regex (e.g., 09171234567 or +639171234567)
export const philippinePhoneRegex = /^(09|\+639)\d{9}$/;

// GCash Reference Number regex (typically 13 digits)
export const gcashRefRegex = /^\d{11,16}$/;

// Login Schema
export const loginSchema = z.object({
  username: z.string().trim().min(3, 'Username must be at least 3 characters').max(64),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

// Unlock Screen Schema
export const unlockSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type UnlockInput = z.infer<typeof unlockSchema>;


// Subscriber Registration Schema
export const createSubscriberSchema = z.object({
  accountNumber: z.string().trim().max(32).optional(),
  firstName: z.string().trim().min(1, 'First name is required').max(64),
  middleName: z.string().trim().max(64).optional().nullable(),
  lastName: z.string().trim().min(1, 'Last name is required').max(64),
  businessName: z.string().trim().max(128).optional().nullable(),
  contactNumber: z.string().trim().regex(philippinePhoneRegex, 'Must be a valid Philippine mobile number (e.g. 09171234567)'),
  alternateContact: z.string().trim().max(32).optional().nullable(),
  email: z.string().trim().email('Invalid email address').max(128).optional().nullable().or(z.literal('')),
  idType: z.string().trim().max(32).optional().nullable(),
  idNumber: z.string().trim().max(64).optional().nullable(),
  streetAddress: z.string().trim().min(3, 'Street address is required'),
  barangay: z.string().trim().min(1, 'Barangay is required').max(64),
  municipality: z.string().trim().default('Malaybalay'),
  province: z.string().trim().default('Bukidnon'),
  postalCode: z.string().trim().default('8700'),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// Subscriber Update Schema
export const updateSubscriberSchema = z.object({
  firstName: z.string().trim().min(1).max(64).optional(),
  middleName: z.string().trim().max(64).optional().nullable(),
  lastName: z.string().trim().min(1).max(64).optional(),
  businessName: z.string().trim().max(128).optional().nullable(),
  contactNumber: z.string().trim().regex(philippinePhoneRegex, 'Must be a valid Philippine mobile number (e.g. 09171234567)').optional(),
  alternateContact: z.string().trim().max(32).optional().nullable(),
  email: z.string().trim().email('Invalid email address').max(128).optional().nullable().or(z.literal('')),
  idType: z.string().trim().max(32).optional().nullable(),
  idNumber: z.string().trim().max(64).optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED', 'ARCHIVED']).optional(),
  notes: z.string().optional().nullable(),
  // Optional primary address update
  streetAddress: z.string().trim().min(3).optional(),
  barangay: z.string().trim().min(1).max(64).optional(),
  municipality: z.string().trim().optional(),
  province: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
});

// Subscriber Query Schema
export const subscriberQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().optional(),
  name: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'TERMINATED', 'ARCHIVED']).optional(),
  barangay: z.string().trim().optional(),
  sortBy: z.enum(['createdAt', 'accountNumber', 'lastName', 'firstName']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// Service Plan Service Type Enum
export const serviceTypeEnum = z.enum(['CABLE', 'INTERNET', 'BUNDLE', 'CABLE_TV', 'COMBO'], {
  errorMap: () => ({ message: 'Service type must be CABLE, INTERNET, or BUNDLE' }),
});

// Service Plan Creation Schema
export const createPlanSchema = z
  .object({
    name: z.string().trim().min(2, 'Plan name must be at least 2 characters').max(128),
    planCode: z.string().trim().min(2, 'Plan code must be at least 2 characters').max(32).optional(),
    code: z.string().trim().min(2, 'Plan code must be at least 2 characters').max(32).optional(),
    serviceType: serviceTypeEnum,
    monthlyFeeCentavos: z.number().int('Monthly fee must be an integer centavos').nonnegative('Monthly fee cannot be negative').optional(),
    monthlyRecurringCentavos: z.number().int('Monthly fee must be an integer centavos').nonnegative('Monthly fee cannot be negative').optional(),
    installationFeeCentavos: z.number().int('Installation fee must be an integer centavos').nonnegative('Installation fee cannot be negative').default(0),
    bandwidthMbps: z.number().int('Bandwidth must be an integer').positive('Bandwidth must be positive').optional().nullable(),
    channelCount: z.number().int('Channel count must be an integer').positive('Channel count must be positive').optional().nullable(),
    isActive: z.boolean().default(true),
  })
  .refine(
    (data) => data.monthlyFeeCentavos !== undefined || data.monthlyRecurringCentavos !== undefined,
    {
      message: 'Monthly fee in centavos is required',
      path: ['monthlyFeeCentavos'],
    }
  );

// Service Plan Update Schema
export const updatePlanSchema = z.object({
  name: z.string().trim().min(2, 'Plan name must be at least 2 characters').max(128).optional(),
  planCode: z.string().trim().min(2, 'Plan code must be at least 2 characters').max(32).optional(),
  code: z.string().trim().min(2, 'Plan code must be at least 2 characters').max(32).optional(),
  serviceType: serviceTypeEnum.optional(),
  monthlyFeeCentavos: z.number().int('Monthly fee must be an integer centavos').nonnegative('Monthly fee cannot be negative').optional(),
  monthlyRecurringCentavos: z.number().int('Monthly fee must be an integer centavos').nonnegative('Monthly fee cannot be negative').optional(),
  installationFeeCentavos: z.number().int('Installation fee must be an integer centavos').nonnegative('Installation fee cannot be negative').optional(),
  bandwidthMbps: z.number().int('Bandwidth must be an integer').positive('Bandwidth must be positive').optional().nullable(),
  channelCount: z.number().int('Channel count must be an integer').positive('Channel count must be positive').optional().nullable(),
  isActive: z.boolean().optional(),
});

// Service Plan Query Schema
export const planQuerySchema = z.object({
  serviceType: serviceTypeEnum.optional(),
  isActive: z.preprocess((val) => {
    if (typeof val === 'string') {
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
    }
    return val;
  }, z.boolean().optional()),
  search: z.string().trim().optional(),
});

// Service Account Status Enum
export const serviceAccountStatusEnum = z.enum([
  'PENDING',
  'PENDING_INSTALL',
  'ACTIVE',
  'SUSPENDED',
  'TERMINATED',
]);

// Service Account Creation Schema
export const createServiceAccountSchema = z.object({
  subscriberId: z.string().uuid('Invalid subscriber ID'),
  servicePlanId: z.string().uuid('Invalid service plan ID'),
  installationAddressId: z.string().uuid('Invalid installation address ID').optional().nullable(),
  streetAddress: z.string().trim().min(3, 'Installation street address is required').optional(),
  barangay: z.string().trim().min(1, 'Installation barangay is required').max(64).optional(),
  municipality: z.string().trim().default('Malaybalay').optional(),
  province: z.string().trim().default('Bukidnon').optional(),
  postalCode: z.string().trim().default('8700').optional(),
  collectorId: z.string().uuid('Invalid collector ID').optional().nullable(),
  collectionAreaId: z.string().uuid('Invalid collection area ID').optional().nullable(),
  collectionRouteId: z.string().uuid('Invalid collection route ID').optional().nullable(),
  billingDayOfMonth: z.number().int('Billing day must be an integer').min(1).max(31).default(1),
  currentRateCentavos: z.number().int('Current rate must be an integer centavos').nonnegative('Current rate cannot be negative').optional(),
  status: serviceAccountStatusEnum.default('PENDING'),
  activationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Activation date must be YYYY-MM-DD').optional().nullable(),
});

// Service Account Update Schema
export const updateServiceAccountSchema = z.object({
  servicePlanId: z.string().uuid('Invalid service plan ID').optional(),
  installationAddressId: z.string().uuid('Invalid installation address ID').optional().nullable(),
  collectorId: z.string().uuid('Invalid collector ID').optional().nullable(),
  collectionAreaId: z.string().uuid('Invalid collection area ID').optional().nullable(),
  collectionRouteId: z.string().uuid('Invalid collection route ID').optional().nullable(),
  billingDayOfMonth: z.number().int('Billing day must be an integer').min(1).max(31).optional(),
  currentRateCentavos: z.number().int('Current rate must be an integer centavos').nonnegative('Current rate cannot be negative').optional(),
  status: serviceAccountStatusEnum.optional(),
  activationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Activation date must be YYYY-MM-DD').optional().nullable(),
});

// Service Account Collector/Route Assignment Schema (PATCH /service-accounts/:id/collector)
export const assignServiceAccountCollectorSchema = z.object({
  collectorId: z.string().uuid('Invalid collector ID').optional().nullable(),
  collectionAreaId: z.string().uuid('Invalid collection area ID').optional().nullable(),
  collectionRouteId: z.string().uuid('Invalid collection route ID').optional().nullable(),
});

// Service Account Status Change Schema
export const changeServiceAccountStatusSchema = z.object({
  status: serviceAccountStatusEnum,
  reason: z.string().trim().min(3, 'Audit reason must be at least 3 characters').max(500).optional(),
});

// Service Account Query Schema
export const serviceAccountQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  subscriberId: z.string().uuid().optional(),
  servicePlanId: z.string().uuid().optional(),
  status: serviceAccountStatusEnum.optional(),
  search: z.string().trim().optional(),
  sortBy: z.enum(['createdAt', 'serviceAccountNumber', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});


// Payment Creation Schema
export const createPaymentSchema = z.object({
  subscriberId: z.string().uuid('Invalid subscriber ID'),
  amountCentavos: z.number().int('Amount must be an integer').positive('Amount must be greater than zero centavos'),
  paymentMethod: z.nativeEnum(PaymentMethod, { errorMap: () => ({ message: 'Invalid payment method' }) }),
  referenceNumber: z.string().max(64).optional().nullable(),
  notes: z.string().max(255).optional().nullable(),
  collectionBatchId: z.string().uuid().optional().nullable(),
});

// Payment Query Schema
export const paymentQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  subscriberId: z.string().uuid().optional(),
  cashierId: z.string().uuid().optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  method: z.nativeEnum(PaymentMethod).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  isReversed: z.preprocess((val) => {
    if (typeof val === 'string') {
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
    }
    return val;
  }, z.boolean().optional()),
  search: z.string().trim().optional(),
  sortBy: z.enum(['createdAt', 'paymentDate', 'amountCentavos', 'paymentNumber']).default('paymentDate'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// GCash Submission / Intake Schema
export const submitGCashSchema = z.object({
  referenceNumber: z.string().trim().min(5, 'GCash reference number is too short').max(64),
  subscriberId: z.string().uuid('Invalid subscriber ID').optional().nullable(),
  senderName: z.string().trim().min(2, 'Sender name is required').max(128),
  senderPhone: z.string().trim().regex(philippinePhoneRegex, 'Must be a valid Philippine mobile number'),
  amountCentavos: z.number().int('Amount must be an integer').positive('Amount must be positive centavos'),
  proofImagePath: z.string().trim().min(1, 'Proof image path is required'),
});
export const intakeGCashSchema = submitGCashSchema;

// GCash Verification Schema
export const verifyGCashSchema = z.object({
  subscriberId: z.string().uuid('Invalid subscriber ID').optional().nullable(),
  notes: z.string().max(255).optional().nullable(),
});

// GCash Rejection Schema
export const rejectGCashSchema = z.object({
  reason: z.string().trim().min(3, 'Rejection reason must be at least 3 characters').max(500),
});

// Payment Reversal Schema (AT-06)
export const reversePaymentSchema = z.object({
  reason: z.string().trim().min(5, 'Audit reason for reversal must be at least 5 characters').max(500),
});

// Collection Batch Creation Schema
export const createBatchSchema = z.object({
  batchNumber: z.string().trim().max(32).optional(),
  collectorId: z.string().uuid('Invalid collector ID'),
  collectionAreaId: z.string().uuid('Invalid collection area ID').optional().nullable(),
  expectedCashCentavos: z.number().int().nonnegative().default(0),
});

// Collection Batch Remittance Reconciliation Schema (AT-07, AT-08)
export const reconcileBatchSchema = z.object({
  expectedCashCentavos: z.number().int('Expected cash must be an integer').nonnegative('Expected cash cannot be negative').optional(),
  remittedCashCentavos: z.number().int('Remitted cash must be an integer').nonnegative('Remitted cash cannot be negative'),
  supervisorNotes: z.string().max(500).optional().nullable(),
});

// Cashier Shift Reconciliation Schema
export const cashierShiftReconcileSchema = z.object({
  cashierId: z.string().uuid().optional(),
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Shift date must be in YYYY-MM-DD format').optional(),
  remittedCashCentavos: z.number().int().nonnegative('Remitted cash cannot be negative'),
  notes: z.string().max(500).optional().nullable(),
});

// Collection Batch Closure Schema
export const closeBatchSchema = z.object({
  reason: z.string().max(500).optional().nullable(),
  force: z.boolean().optional().default(false),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type PaymentQueryInput = z.infer<typeof paymentQuerySchema>;
export type SubmitGCashInput = z.infer<typeof submitGCashSchema>;
export type IntakeGCashInput = z.infer<typeof intakeGCashSchema>;
export type VerifyGCashInput = z.infer<typeof verifyGCashSchema>;
export type RejectGCashInput = z.infer<typeof rejectGCashSchema>;
export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;
export type CreateBatchInput = z.infer<typeof createBatchSchema>;
export type ReconcileBatchInput = z.infer<typeof reconcileBatchSchema>;
export type CashierShiftReconcileInput = z.infer<typeof cashierShiftReconcileSchema>;
export type CloseBatchInput = z.infer<typeof closeBatchSchema>;


export type CreateSubscriberInput = z.infer<typeof createSubscriberSchema>;
export type UpdateSubscriberInput = z.infer<typeof updateSubscriberSchema>;
export type SubscriberQueryInput = z.infer<typeof subscriberQuerySchema>;

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type PlanQueryInput = z.infer<typeof planQuerySchema>;

export type CreateServiceAccountInput = z.infer<typeof createServiceAccountSchema>;
export type UpdateServiceAccountInput = z.infer<typeof updateServiceAccountSchema>;
export type ChangeServiceAccountStatusInput = z.infer<typeof changeServiceAccountStatusSchema>;
export type ServiceAccountQueryInput = z.infer<typeof serviceAccountQuerySchema>;

// Invoice Line Item Type Enum
export const invoiceItemTypeEnum = z.enum([
  'PLAN_FEE',
  'INSTALLATION',
  'DEVICE',
  'PENALTY',
  'DISCOUNT',
  'ADJUSTMENT',
  'OTHER',
]);

// Invoice Line Item Input Schema
export const invoiceLineItemInputSchema = z.object({
  itemType: invoiceItemTypeEnum,
  description: z.string().trim().min(1, 'Description is required').max(255),
  amountCentavos: z.number().int('Amount must be an integer centavos').positive('Amount must be positive centavos'),
  quantity: z.number().int().positive().default(1),
});

// Invoice Status Enum
export const invoiceStatusEnum = z.enum([
  'DRAFT',
  'UNPAID',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'VOID',
  'VOIDED',
  'CREDITED',
]);

// Invoice Generation Schema (Single account or batch for active accounts)
export const generateInvoiceSchema = z
  .object({
    serviceAccountId: z.string().uuid('Invalid service account ID').optional(),
    billingPeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Billing period start must be YYYY-MM-DD'),
    billingPeriodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Billing period end must be YYYY-MM-DD'),
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Issue date must be YYYY-MM-DD').optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD').optional(),
    notes: z.string().max(500).optional().nullable(),
    customLineItems: z.array(invoiceLineItemInputSchema).optional(),
    applyAdvanceCredit: z.boolean().default(true),
  })
  .refine((data) => data.billingPeriodStart <= data.billingPeriodEnd, {
    message: 'Billing period start date must be on or before billing period end date',
    path: ['billingPeriodEnd'],
  })
  .refine((data) => !data.dueDate || !data.issueDate || data.dueDate >= data.issueDate, {
    message: 'Due date must be on or after issue date',
    path: ['dueDate'],
  });

// Invoice Query Schema
export const invoiceQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  serviceAccountId: z.string().uuid().optional(),
  subscriberId: z.string().uuid().optional(),
  status: invoiceStatusEnum.optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD').optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD').optional(),
  search: z.string().trim().optional(),
  sortBy: z.enum(['createdAt', 'invoiceNumber', 'dueDate', 'issueDate', 'totalDueCentavos']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// Void Invoice Schema
export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(5, 'Reason for voiding must be at least 5 characters').max(500),
});

export type InvoiceLineItemInput = z.infer<typeof invoiceLineItemInputSchema>;
export type GenerateInvoiceInput = z.infer<typeof generateInvoiceSchema>;
export type InvoiceQueryInput = z.infer<typeof invoiceQuerySchema>;
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;

// ==============================================================================
// Collection Areas & Routes Schemas (Phase 6)
// ==============================================================================

export const createCollectionAreaSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(128),
  code: z.string().trim().max(32).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  barangay: z.string().trim().max(64).optional().nullable(),
  city: z.string().trim().max(64).default('Malaybalay'),
  assignedCollectorId: z.string().uuid('Invalid collector ID').optional().nullable(),
});

export const updateCollectionAreaSchema = z.object({
  name: z.string().trim().min(2).max(128).optional(),
  code: z.string().trim().max(32).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  barangay: z.string().trim().max(64).optional().nullable(),
  city: z.string().trim().max(64).optional(),
  assignedCollectorId: z.string().uuid('Invalid collector ID').optional().nullable(),
  isActive: z.boolean().optional(),
});

export const assignCollectorSchema = z.object({
  collectorId: z.string().uuid('Invalid collector ID'),
});

export const collectionAreaQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().optional(),
  barangay: z.string().trim().optional(),
  collectorId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
});

export const createCollectionRouteSchema = z.object({
  collectionAreaId: z.string().uuid('Invalid collection area ID'),
  routeCode: z.string().trim().min(2, 'Route code must be at least 2 characters').max(32),
  name: z.string().trim().min(2, 'Route name must be at least 2 characters').max(128),
  description: z.string().max(500).optional().nullable(),
  assignedCollectorId: z.string().uuid('Invalid collector ID').optional().nullable(),
});

export const updateCollectionRouteSchema = z.object({
  collectionAreaId: z.string().uuid('Invalid collection area ID').optional(),
  routeCode: z.string().trim().min(2).max(32).optional(),
  name: z.string().trim().min(2).max(128).optional(),
  description: z.string().max(500).optional().nullable(),
  assignedCollectorId: z.string().uuid('Invalid collector ID').optional().nullable(),
  isActive: z.boolean().optional(),
});

export const collectionRouteQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  collectionAreaId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  collectorId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
});

export const routeSheetQuerySchema = z.object({
  overdueOnly: z.preprocess((val) => {
    if (typeof val === 'string') {
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
    }
    return val;
  }, z.boolean().optional().default(false)),
});

export type CreateCollectionAreaInput = z.infer<typeof createCollectionAreaSchema>;
export type UpdateCollectionAreaInput = z.infer<typeof updateCollectionAreaSchema>;
export type AssignCollectorInput = z.infer<typeof assignCollectorSchema>;
export type CollectionAreaQueryInput = z.infer<typeof collectionAreaQuerySchema>;
export type CreateCollectionRouteInput = z.infer<typeof createCollectionRouteSchema>;
export type UpdateCollectionRouteInput = z.infer<typeof updateCollectionRouteSchema>;
export type CollectionRouteQueryInput = z.infer<typeof collectionRouteQuerySchema>;
export type RouteSheetQueryInput = z.infer<typeof routeSheetQuerySchema>;
export type AssignServiceAccountCollectorInput = z.infer<typeof assignServiceAccountCollectorSchema>;

// ==============================================================================
// Service Orders Engine Schemas (Phase 6)
// ==============================================================================

export const serviceOrderTypeEnum = z.enum([
  'INSTALLATION',
  'REPAIR',
  'DISCONNECTION',
  'RECONNECTION',
  'RELOCATION',
  'TRANSFER',
]);

export const serviceOrderStatusEnum = z.enum([
  'PENDING',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);

export const serviceOrderPriorityEnum = z.enum([
  'LOW',
  'NORMAL',
  'HIGH',
  'URGENT',
]);

export const materialUsedSchema = z.object({
  item: z.string().trim().min(1, 'Item name is required'),
  quantity: z.number().positive('Quantity must be positive'),
  unit: z.string().optional(),
  costCentavos: z.number().int().nonnegative().optional(),
});

export const createServiceOrderSchema = z.object({
  serviceAccountId: z.string().uuid('Invalid service account ID'),
  orderType: serviceOrderTypeEnum,
  description: z.string().trim().min(3, 'Description must be at least 3 characters').max(1000),
  priority: serviceOrderPriorityEnum.default('NORMAL'),
  assignedTechnicianId: z.string().uuid('Invalid technician ID').optional().nullable(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Scheduled date must be YYYY-MM-DD').optional().nullable(),
  targetAddressId: z.string().uuid('Invalid target address ID').optional().nullable(),
  feeCentavos: z.number().int().nonnegative('Fee cannot be negative').default(0),
  disconnectionType: z.enum(['TEMPORARY', 'PERMANENT']).optional().nullable(),
});

export const updateServiceOrderSchema = z.object({
  description: z.string().trim().min(3).max(1000).optional(),
  priority: serviceOrderPriorityEnum.optional(),
  assignedTechnicianId: z.string().uuid('Invalid technician ID').optional().nullable(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Scheduled date must be YYYY-MM-DD').optional().nullable(),
  status: z.enum(['PENDING', 'ASSIGNED', 'IN_PROGRESS']).optional(),
  feeCentavos: z.number().int().nonnegative().optional(),
  targetAddressId: z.string().uuid('Invalid target address ID').optional().nullable(),
});

export const assignTechnicianSchema = z.object({
  technicianId: z.string().uuid('Invalid technician ID'),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Scheduled date must be YYYY-MM-DD').optional().nullable(),
});

export const completeServiceOrderSchema = z.object({
  resolutionNotes: z.string().trim().min(3, 'Resolution notes are required').max(2000),
  materialsUsed: z.array(materialUsedSchema).optional(),
  disconnectionType: z.enum(['TEMPORARY', 'PERMANENT']).optional(),
  targetAddressId: z.string().uuid('Invalid target address ID').optional().nullable(),
  completedAt: z.string().optional(),
});

export const cancelServiceOrderSchema = z.object({
  reason: z.string().trim().min(3, 'Cancellation reason is required').max(500),
});

export const changeServiceOrderStatusSchema = z.object({
  status: z.enum(['PENDING', 'ASSIGNED', 'IN_PROGRESS']),
  reason: z.string().trim().max(500).optional(),
});

export const serviceOrderQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  serviceAccountId: z.string().uuid().optional(),
  subscriberId: z.string().uuid().optional(),
  assignedTechnicianId: z.string().uuid().optional(),
  orderType: serviceOrderTypeEnum.optional(),
  status: serviceOrderStatusEnum.optional(),
  priority: serviceOrderPriorityEnum.optional(),
  search: z.string().trim().optional(),
  sortBy: z.enum(['createdAt', 'scheduledDate', 'orderNumber', 'priority', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type MaterialUsedInput = z.infer<typeof materialUsedSchema>;
export type CreateServiceOrderInput = z.infer<typeof createServiceOrderSchema>;
export type UpdateServiceOrderInput = z.infer<typeof updateServiceOrderSchema>;
export type ChangeServiceOrderStatusInput = z.infer<typeof changeServiceOrderStatusSchema>;
export type AssignTechnicianInput = z.infer<typeof assignTechnicianSchema>;
export type CompleteServiceOrderInput = z.infer<typeof completeServiceOrderSchema>;
export type CancelServiceOrderInput = z.infer<typeof cancelServiceOrderSchema>;
export type ServiceOrderQueryInput = z.infer<typeof serviceOrderQuerySchema>;

// ==============================================================================
// 12. Dunning Management Schemas (Phase 7)
// ==============================================================================

export const dunningNoticeStatusEnum = z.enum([
  'ISSUED',
  'DELIVERED',
  'RESOLVED',
  'CANCELLED',
]);

export const generateDunningNoticesSchema = z.object({
  minDaysOverdue: z.coerce.number().int().positive('Minimum days overdue must be positive').default(30),
  noticeLevel: z.coerce.number().int().min(1).max(3).optional(),
  collectionAreaId: z.string().uuid('Invalid collection area ID').optional(),
  serviceAccountId: z.string().uuid('Invalid service account ID').optional(),
  notes: z.string().trim().max(500).optional(),
});

export const dunningNoticeQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: dunningNoticeStatusEnum.optional(),
  serviceAccountId: z.string().uuid().optional(),
  subscriberId: z.string().uuid().optional(),
  noticeLevel: z.coerce.number().int().min(1).max(3).optional(),
  search: z.string().trim().optional(),
  sortBy: z.enum(['issuedAt', 'noticeNumber', 'daysOverdue', 'overdueBalanceCentavos', 'status']).default('issuedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const deliverDunningNoticeSchema = z.object({
  deliveredAt: z.string().optional(),
  deliveryNotes: z.string().trim().max(1000).optional(),
});

export const resolveDunningNoticeSchema = z.object({
  resolvedReason: z.string().trim().min(2, 'Resolution reason is required').max(500),
  notes: z.string().trim().max(1000).optional(),
});

export const cancelDunningNoticeSchema = z.object({
  reason: z.string().trim().min(2, 'Cancellation reason is required').max(500),
});

export type GenerateDunningNoticesInput = z.infer<typeof generateDunningNoticesSchema>;
export type DunningNoticeQueryInput = z.infer<typeof dunningNoticeQuerySchema>;
export type DeliverDunningNoticeInput = z.infer<typeof deliverDunningNoticeSchema>;
export type ResolveDunningNoticeInput = z.infer<typeof resolveDunningNoticeSchema>;
export type CancelDunningNoticeInput = z.infer<typeof cancelDunningNoticeSchema>;

// ==============================================================================
// 13. Reports & Analytics Schemas (Phase 7)
// ==============================================================================

export const reportFormatEnum = z.enum(['json', 'csv']).default('json');

export const arAgingQuerySchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  barangay: z.string().trim().optional(),
  collectionAreaId: z.string().uuid('Invalid collection area ID').optional(),
  groupBy: z.enum(['subscriber', 'service_account', 'barangay', 'collection_area', 'summary']).default('subscriber'),
  format: reportFormatEnum,
});

export const disconnectionCandidatesQuerySchema = z.object({
  thresholdDays: z.coerce.number().int().positive('Threshold days must be positive').default(60),
  minOverdueCentavos: z.coerce.number().int().nonnegative('Minimum overdue cannot be negative').default(0),
  barangay: z.string().trim().optional(),
  collectionAreaId: z.string().uuid('Invalid collection area ID').optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  format: reportFormatEnum,
});

export const dailyCollectionQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD').optional(),
  cashierId: z.string().uuid('Invalid cashier ID').optional(),
  format: reportFormatEnum,
});

export const billingRevenueQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD').optional(),
  format: reportFormatEnum,
});

export type ArAgingQueryInput = z.infer<typeof arAgingQuerySchema>;
export type DisconnectionCandidatesQueryInput = z.infer<typeof disconnectionCandidatesQuerySchema>;
export type DailyCollectionQueryInput = z.infer<typeof dailyCollectionQuerySchema>;
export type BillingRevenueQueryInput = z.infer<typeof billingRevenueQuerySchema>;


