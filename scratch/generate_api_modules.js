const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../apps/desktop/src/api');

const authContent = `
import { apiCore } from './core.js';
import { UserProfile } from './types.js';

export async function login(username, password) {
  return apiCore.request('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function logout() {
  return apiCore.request('/api/v1/auth/logout', { method: 'POST' });
}

export async function lock() {
  return apiCore.request('/api/v1/auth/lock', { method: 'POST' });
}

export async function unlock(password) {
  return apiCore.request('/api/v1/auth/unlock', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function getMe() {
  return apiCore.request('/api/v1/auth/me');
}
`;
fs.writeFileSync(path.join(srcDir, 'auth.ts'), authContent.trim());

const subscribersContent = `
import { apiCore } from './core.js';
import { SubscriberRecord, StatementOfAccountDto } from './types.js';

export async function listSubscribers(params) {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.status) q.set('status', params.status);
  if (params?.routeId) q.set('routeId', params.routeId);
  return apiCore.request(\`/api/v1/subscribers?\${q.toString()}\`);
}

export async function getSubscriber(id) {
  return apiCore.request(\`/api/v1/subscribers/\${id}\`);
}

export async function createSubscriber(data) {
  return apiCore.request('/api/v1/subscribers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateSubscriber(id, data) {
  return apiCore.request(\`/api/v1/subscribers/\${id}\`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function getSubscriberSoa(id) {
  return apiCore.request(\`/api/v1/subscribers/\${id}/soa\`);
}
`;
fs.writeFileSync(path.join(srcDir, 'subscribers.ts'), subscribersContent.trim());

const invoicesContent = `
import { apiCore } from './core.js';

export async function listInvoices(params) {
  const q = new URLSearchParams();
  if (params?.subscriberId) q.set('subscriberId', params.subscriberId);
  if (params?.status) q.set('status', params.status);
  return apiCore.request(\`/api/v1/invoices?\${q.toString()}\`);
}

export async function getInvoice(id) {
  return apiCore.request(\`/api/v1/invoices/\${id}\`);
}
`;
fs.writeFileSync(path.join(srcDir, 'invoices.ts'), invoicesContent.trim());

const paymentsContent = `
import { apiCore } from './core.js';

export async function listPayments(params) {
  const q = new URLSearchParams();
  if (params?.subscriberId) q.set('subscriberId', params.subscriberId);
  return apiCore.request(\`/api/v1/payments?\${q.toString()}\`);
}

export async function processPayment(data) {
  return apiCore.request('/api/v1/payments', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
`;
fs.writeFileSync(path.join(srcDir, 'payments.ts'), paymentsContent.trim());

const plansContent = `
import { apiCore } from './core.js';

export async function listPlans(serviceType) {
  const q = serviceType ? \`?serviceType=\${serviceType}\` : '';
  return apiCore.request(\`/api/v1/plans\${q}\`);
}
`;
fs.writeFileSync(path.join(srcDir, 'plans.ts'), plansContent.trim());

const collectionsContent = `
import { apiCore } from './core.js';

export async function listCollectionAreas() {
  return apiCore.request('/api/v1/collections/areas');
}

export async function listCollectionRoutes(areaId) {
  const q = areaId ? \`?areaId=\${areaId}\` : '';
  return apiCore.request(\`/api/v1/collections/routes\${q}\`);
}

export async function getRouteRouteSheet(routeId, overdueOnly = false) {
  return apiCore.request(\`/api/v1/collections/routes/\${routeId}/route-sheet?overdueOnly=\${overdueOnly}\`);
}
`;
fs.writeFileSync(path.join(srcDir, 'collections.ts'), collectionsContent.trim());

const serviceOrdersContent = `
import { apiCore } from './core.js';

export async function listServiceOrders(params) {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.orderType) q.set('orderType', params.orderType);
  return apiCore.request(\`/api/v1/service-orders?\${q.toString()}\`);
}

export async function createServiceOrder(data) {
  return apiCore.request('/api/v1/service-orders', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function assignTechnician(orderId, technicianId) {
  return apiCore.request(\`/api/v1/service-orders/\${orderId}/assign\`, {
    method: 'POST',
    body: JSON.stringify({ technicianId }),
  });
}

export async function updateServiceOrderStatus(orderId, status, reason) {
  return apiCore.request(\`/api/v1/service-orders/\${orderId}/status\`, {
    method: 'POST',
    body: JSON.stringify({ status, reason }),
  });
}

export async function completeServiceOrder(orderId, resolutionNotes) {
  return apiCore.request(\`/api/v1/service-orders/\${orderId}/complete\`, {
    method: 'POST',
    body: JSON.stringify({ resolutionNotes }),
  });
}

export async function cancelServiceOrder(orderId, reason) {
  return apiCore.request(\`/api/v1/service-orders/\${orderId}/cancel\`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
`;
fs.writeFileSync(path.join(srcDir, 'serviceOrders.ts'), serviceOrdersContent.trim());

const reportsContent = `
import { apiCore } from './core.js';

export async function getArAging() {
  return apiCore.request('/api/v1/reports/ar-aging');
}

export async function getDailyCollections(date) {
  const q = date ? \`?date=\${date}\` : '';
  return apiCore.request(\`/api/v1/reports/daily-collections\${q}\`);
}

export async function exportReportCsv(reportType) {
  return apiCore.request(\`/api/v1/reports/\${reportType}?format=csv\`);
}
`;
fs.writeFileSync(path.join(srcDir, 'reports.ts'), reportsContent.trim());

const systemContent = `
import { apiCore } from './core.js';

export async function ping() {
  return apiCore.request('/api/v1/health');
}

export async function createBackup() {
  return apiCore.request('/api/v1/system/backup', { method: 'POST' });
}

export async function listBackups() {
  return apiCore.request('/api/v1/system/backups');
}

export async function restoreBackup(filename) {
  return apiCore.request('/api/v1/system/restore', {
    method: 'POST',
    body: JSON.stringify({ filename }),
  });
}

export async function listTechnicians() {
  return apiCore.request('/api/v1/users');
}
`;
fs.writeFileSync(path.join(srcDir, 'system.ts'), systemContent.trim());

// We can export everything from an index.ts to make it easier to import, or just create a new \`apiClient\` facade to drop-in replace the old one for now so we don't break everything, or use the object facade.
// Since the instruction is "delete Monolithic ApiClient class. Too big. Break into domain modules.", I will do exactly that, and I will create an apiClient facade in \`client.ts\` that is just an object to avoid breaking the 8 UI files.

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
  setToken: (token) => apiCore.setToken(token),
  setBaseUrl: (url) => apiCore.setBaseUrl(url),
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

console.log("Domain modules created successfully.");
