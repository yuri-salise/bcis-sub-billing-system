import { z } from 'zod';
import { PaymentMethod } from '@bcis/shared-types';

// Philippine Mobile Phone regex (e.g., 09171234567 or +639171234567)
export const philippinePhoneRegex = /^(09|\+639)\d{9}$/;

// GCash Reference Number regex (typically 13 digits)
export const gcashRefRegex = /^\d{11,16}$/;

// Login Schema
export const loginSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(64),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

// Subscriber Registration Schema
export const createSubscriberSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(64),
  middleName: z.string().max(64).optional(),
  lastName: z.string().min(1, 'Last name is required').max(64),
  businessName: z.string().max(128).optional(),
  contactNumber: z.string().regex(philippinePhoneRegex, 'Must be a valid Philippine mobile number (e.g. 09171234567)'),
  alternateContact: z.string().max(32).optional(),
  email: z.string().email('Invalid email address').max(128).optional(),
  streetAddress: z.string().min(3, 'Street address is required'),
  barangay: z.string().min(1, 'Barangay is required').max(64),
  municipality: z.string().default('Malaybalay'),
  province: z.string().default('Bukidnon'),
  postalCode: z.string().default('8700'),
  notes: z.string().optional(),
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
