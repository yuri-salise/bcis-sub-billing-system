import { UserRole, PaymentMethod, InvoiceStatus, ServiceOrderStatus } from '@bcis/shared-types';

export interface UserProfile {
  id: string;
  username: string;
  fullName: string;
  email?: string;
  roles: UserRole[];
  permissions: string[];
}

export interface AuthState {
  token: string | null;
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLocked: boolean;
}

export interface SubscriberRecord {
  id: string;
  accountNumber: string;
  firstName: string;
  lastName: string;
  companyName?: string | null;
  status: string;
  email?: string | null;
  phone: string;
  currentBalanceCentavos: number;
  advancePaymentCentavos: number;
  serviceAccounts?: ServiceAccountRecord[];
  primaryAddress?: {
    addressLine1: string;
    barangay: string;
    city: string;
  };
}

export interface ServiceAccountRecord {
  id: string;
  accountNumber: string;
  serviceType: string;
  status: string;
  planName?: string;
  monthlyFeeCentavos: number;
  collectionAreaId?: string | null;
  collectionRouteId?: string | null;
}

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  serviceAccountId: string;
  subscriberId?: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  issueDate: string;
  dueDate: string;
  totalDueCentavos: number;
  remainingBalanceCentavos: number;
  status: InvoiceStatus;
}

export interface PaymentReceipt {
  receiptNumber: string;
  officialReceiptNumber?: string;
  paymentId: string;
  date: string;
  subscriberName: string;
  subscriberAccountNumber: string;
  address?: string;
  cashierName: string;
  paymentMethod: PaymentMethod;
  totalAmountCentavos: number;
  tenderedCentavos?: number;
  changeCentavos?: number;
  referenceNumber?: string | null;
  allocations: Array<{
    invoiceNumber: string;
    allocatedCentavos: number;
    description: string;
  }>;
  advanceCreditCentavos?: number;
}

export interface ServicePlanRecord {
  id: string;
  name: string;
  code: string;
  serviceType: string;
  bandwidthMbps?: number | null;
  monthlyFeeCentavos: number;
  description?: string | null;
  isActive: boolean;
}

export interface ServiceOrderRecord {
  id: string;
  orderNumber: string;
  orderType: string; // INSTALLATION, REPAIR, DISCONNECTION, RECONNECTION
  status: ServiceOrderStatus | string;
  priority: string;
  subscriberId: string;
  subscriberName?: string;
  serviceAccountId: string;
  assignedTechnicianId?: string | null;
  assignedTechnicianName?: string | null;
  scheduledDate?: string | null;
  description?: string | null;
  resolutionNotes?: string | null;
  feeCentavos: number;
  createdAt: string;
}

export interface CollectionAreaRecord {
  id: string;
  code: string;
  name: string;
  barangay?: string | null;
  city: string;
  assignedCollectorId?: string | null;
  assignedCollectorName?: string | null;
  activeAccountsCount?: number;
  totalArrearsCentavos?: number;
  routesCount?: number;
}

export interface CollectionRouteRecord {
  id: string;
  collectionAreaId: string;
  routeCode: string;
  name: string;
  description?: string | null;
  assignedCollectorId?: string | null;
  assignedCollectorName?: string | null;
  accountsCount?: number;
}

export interface RouteSheetItem {
  serviceAccountId: string;
  subscriberId: string;
  subscriberName: string;
  accountNumber: string;
  address: string;
  barangay: string;
  contactNumber: string;
  planName: string;
  planFeeCentavos: number;
  status: string;
  arrearsCentavos: number;
  daysOverdue: number;
  routeId?: string;
  collectionRouteId?: string;
  isDelinquent: boolean;
}

export interface ArAgingBucketSummary {
  bucket: string;
  label: string;
  accountCount: number;
  totalCentavos: number;
  percentage: number;
}

export interface DailyCollectionItem {
  paymentNumber: string;
  receiptNumber: string;
  subscriberName: string;
  paymentMethod: PaymentMethod;
  amountCentavos: number;
  cashierName: string;
  time: string;
}

export interface DailyCollectionReportData {
  reportDate: string;
  totalCollectedCentavos: number;
  totalPayments: number;
  totalReceipts: number;
  byMethod: Record<string, { count: number; totalCentavos: number }>;
  byCashier?: Array<{
    cashierId?: string;
    cashierName: string;
    cashierUsername?: string;
    totalReceipts: number;
    cashCentavos: number;
    gcashCentavos: number;
    checkCentavos: number;
    bankTransferCentavos: number;
    totalCentavos: number;
  }>;
  items: DailyCollectionItem[];
}

export interface LANServerHealth {
  status: string;
  database: string;
  timestamp: string;
  version?: string;
}

