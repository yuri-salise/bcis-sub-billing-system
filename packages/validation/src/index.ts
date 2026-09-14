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
  billingDayOfMonth: z.number().int('Billing day must be an integer').min(1).max(31).optional(),
  currentRateCentavos: z.number().int('Current rate must be an integer centavos').nonnegative('Current rate cannot be negative').optional(),
  status: serviceAccountStatusEnum.optional(),
  activationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Activation date must be YYYY-MM-DD').optional().nullable(),
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
  referenceNumber: z.string().max(64).optional(),
  notes: z.string().max(255).optional(),
});

// GCash Submission Intake Schema
export const submitGCashSchema = z.object({
  referenceNumber: z.string().regex(gcashRefRegex, 'GCash reference number must be 11 to 16 digits'),
  subscriberId: z.string().uuid('Invalid subscriber ID').optional(),
  senderName: z.string().min(2, 'Sender name is required').max(128),
  senderPhone: z.string().regex(philippinePhoneRegex, 'Must be a valid Philippine mobile number'),
  amountCentavos: z.number().int().positive('Amount must be positive centavos'),
  proofImagePath: z.string().min(1, 'Proof image path is required'),
});

// Payment Reversal Schema (AT-06)
export const reversePaymentSchema = z.object({
  reason: z.string().min(10, 'Audit reason for reversal must be at least 10 characters').max(500),
});

// Collection Batch Remittance Reconciliation Schema (AT-07, AT-08)
export const reconcileBatchSchema = z.object({
  remittedCashCentavos: z.number().int().nonnegative('Remitted cash cannot be negative'),
  supervisorNotes: z.string().max(500).optional(),
});

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

