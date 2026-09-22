const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../apps/desktop/src/api');

const authContent = `
import { apiCore } from './core.js';
import { UserProfile } from './types.js';

export async function login(username: string, password: string): Promise<any> {
  return apiCore.request<any>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function logout(): Promise<any> {
  return apiCore.request<any>('/api/v1/auth/logout', { method: 'POST' });
}

export async function lock(): Promise<any> {
  return apiCore.request<any>('/api/v1/auth/lock', { method: 'POST' });
}

export async function unlock(password: string): Promise<any> {
  return apiCore.request<any>('/api/v1/auth/unlock', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function getMe(): Promise<any> {
  return apiCore.request<any>('/api/v1/auth/me');
}
`;
fs.writeFileSync(path.join(srcDir, 'auth.ts'), authContent.trim());

const subscribersContent = `
import { apiCore } from './core.js';

export async function listSubscribers(params?: any): Promise<any> {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.status) q.set('status', params.status);
  if (params?.routeId) q.set('routeId', params.routeId);
  return apiCore.request<any>(\`/api/v1/subscribers?\${q.toString()}\`);
}

export async function getSubscriber(id: string): Promise<any> {
  return apiCore.request<any>(\`/api/v1/subscribers/\${id}\`);
}

export async function createSubscriber(data: any): Promise<any> {
  return apiCore.request<any>('/api/v1/subscribers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateSubscriber(id: string, data: any): Promise<any> {
  return apiCore.request<any>(\`/api/v1/subscribers/\${id}\`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function getSubscriberSoa(id: string): Promise<any> {
  return apiCore.request<any>(\`/api/v1/subscribers/\${id}/soa\`);
}
`;
fs.writeFileSync(path.join(srcDir, 'subscribers.ts'), subscribersContent.trim());

const invoicesContent = `
import { apiCore } from './core.js';

export async function listInvoices(params?: any): Promise<any> {
  const q = new URLSearchParams();
  if (params?.subscriberId) q.set('subscriberId', params.subscriberId);
  if (params?.status) q.set('status', params.status);
  return apiCore.request<any>(\`/api/v1/invoices?\${q.toString()}\`);
}

export async function getInvoice(id: string): Promise<any> {
  return apiCore.request<any>(\`/api/v1/invoices/\${id}\`);
}

export async function generateInvoiceBatch(data?: any): Promise<any> {
  return apiCore.request<any>('/api/v1/invoices/batch', {
    method: 'POST',
    body: JSON.stringify(data || {}),
  });
}
`;
fs.writeFileSync(path.join(srcDir, 'invoices.ts'), invoicesContent.trim());

const paymentsContent = `
import { apiCore } from './core.js';

export async function listPayments(params?: any): Promise<any> {
  const q = new URLSearchParams();
  if (params?.subscriberId) q.set('subscriberId', params.subscriberId);
  return apiCore.request<any>(\`/api/v1/payments?\${q.toString()}\`);
}

export async function processPayment(data: any): Promise<any> {
  return apiCore.request<any>('/api/v1/payments', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function postPayment(data: any): Promise<any> {
  return apiCore.request<any>('/api/v1/payments', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
`;
fs.writeFileSync(path.join(srcDir, 'payments.ts'), paymentsContent.trim());

const plansContent = `
import { apiCore } from './core.js';

export async function listPlans(serviceType?: any): Promise<any> {
  const q = serviceType ? \`?serviceType=\${serviceType}\` : '';
  return apiCore.request<any>(\`/api/v1/plans\${q}\`);
}

export async function createPlan(data: any): Promise<any> {
  return apiCore.request<any>('/api/v1/plans', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
`;
fs.writeFileSync(path.join(srcDir, 'plans.ts'), plansContent.trim());

const collectionsContent = `
import { apiCore } from './core.js';

export async function listCollectionAreas(): Promise<any> {
  return apiCore.request<any>('/api/v1/collections/areas');
}
export async function listAreas(): Promise<any> {
  return apiCore.request<any>('/api/v1/collections/areas');
}

export async function listCollectionRoutes(areaId?: any): Promise<any> {
  const q = areaId ? \`?areaId=\${areaId}\` : '';
  return apiCore.request<any>(\`/api/v1/collections/routes\${q}\`);
}
export async function listRoutes(areaId?: any): Promise<any> {
  const q = areaId ? \`?areaId=\${areaId}\` : '';
  return apiCore.request<any>(\`/api/v1/collections/routes\${q}\`);
}

export async function getRouteRouteSheet(routeId: string, overdueOnly: boolean = false): Promise<any> {
  return apiCore.request<any>(\`/api/v1/collections/routes/\${routeId}/route-sheet?overdueOnly=\${overdueOnly}\`);
}
export async function getAreaRouteSheet(areaId: string, overdueOnly: boolean = false): Promise<any> {
  return apiCore.request<any>(\`/api/v1/collections/areas/\${areaId}/route-sheet?overdueOnly=\${overdueOnly}\`);
}
`;
fs.writeFileSync(path.join(srcDir, 'collections.ts'), collectionsContent.trim());

const serviceOrdersContent = `
import { apiCore } from './core.js';

export async function listServiceOrders(params?: any): Promise<any> {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.orderType) q.set('orderType', params.orderType);
  return apiCore.request<any>(\`/api/v1/service-orders?\${q.toString()}\`);
}

export async function createServiceOrder(data: any): Promise<any> {
  return apiCore.request<any>('/api/v1/service-orders', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function assignTechnician(orderId: string, technicianId: string): Promise<any> {
  return apiCore.request<any>(\`/api/v1/service-orders/\${orderId}/assign\`, {
    method: 'POST',
    body: JSON.stringify({ technicianId }),
  });
}

export async function updateServiceOrderStatus(orderId: string, status: string, reason?: string): Promise<any> {
  return apiCore.request<any>(\`/api/v1/service-orders/\${orderId}/status\`, {
    method: 'POST',
    body: JSON.stringify({ status, reason }),
  });
}

export async function completeServiceOrder(orderId: string, resolutionNotes: string): Promise<any> {
  return apiCore.request<any>(\`/api/v1/service-orders/\${orderId}/complete\`, {
    method: 'POST',
    body: JSON.stringify({ resolutionNotes }),
  });
}

export async function cancelServiceOrder(orderId: string, reason: string): Promise<any> {
  return apiCore.request<any>(\`/api/v1/service-orders/\${orderId}/cancel\`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
`;
fs.writeFileSync(path.join(srcDir, 'serviceOrders.ts'), serviceOrdersContent.trim());

const reportsContent = `
import { apiCore } from './core.js';

export async function getArAging(): Promise<any> {
  return apiCore.request<any>('/api/v1/reports/ar-aging');
}

export async function getDailyCollections(date?: string): Promise<any> {
  const q = date ? \`?date=\${date}\` : '';
  return apiCore.request<any>(\`/api/v1/reports/daily-collections\${q}\`);
}

export async function exportReportCsv(reportType: string): Promise<any> {
  return apiCore.request<any>(\`/api/v1/reports/\${reportType}?format=csv\`);
}
`;
fs.writeFileSync(path.join(srcDir, 'reports.ts'), reportsContent.trim());

const systemContent = `
import { apiCore } from './core.js';

export async function ping(): Promise<any> {
  return apiCore.request<any>('/api/v1/health');
}

export async function createBackup(): Promise<any> {
  return apiCore.request<any>('/api/v1/system/backup', { method: 'POST' });
}

export async function listBackups(): Promise<any> {
  return apiCore.request<any>('/api/v1/system/backups');
}

export async function restoreBackup(filename: string): Promise<any> {
  return apiCore.request<any>('/api/v1/system/restore', {
    method: 'POST',
    body: JSON.stringify({ filename }),
  });
}

export async function listTechnicians(): Promise<any> {
  return apiCore.request<any>('/api/v1/users');
}
`;
fs.writeFileSync(path.join(srcDir, 'system.ts'), systemContent.trim());

const facadeContent = `
import * as auth from './auth.js';
import * as subscribers from './subscribers.js';
import * as invoices from './invoices.js';
import * as payments from './payments.js';
import * as plans from './plans.js';
import * as collections from './collections.js';
import * as serviceOrders from './serviceOrders.js';
import * as reports from './reports.js';
import * as system from './system.js';
import { apiCore } from './core.js';

export const apiClient = {
  setToken: (token: string | null) => apiCore.setToken(token),
  setBaseUrl: (url: string) => apiCore.setBaseUrl(url),
  getBaseUrl: () => apiCore.getBaseUrl(),
  ...auth,
  ...subscribers,
  ...invoices,
  ...payments,
  ...plans,
  ...collections,
  ...serviceOrders,
  ...reports,
  ...system,
};
`;
fs.writeFileSync(path.join(srcDir, 'client.ts'), facadeContent.trim());
console.log('Fixed TS typings.');
