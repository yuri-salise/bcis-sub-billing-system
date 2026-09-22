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