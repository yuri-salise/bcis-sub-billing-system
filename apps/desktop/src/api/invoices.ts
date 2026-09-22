import { apiCore } from './core.js';

export async function listInvoices(params) {
  const q = new URLSearchParams();
  if (params?.subscriberId) q.set('subscriberId', params.subscriberId);
  if (params?.status) q.set('status', params.status);
  return apiCore.request(`/api/v1/invoices?${q.toString()}`);
}

export async function getInvoice(id) {
  return apiCore.request(`/api/v1/invoices/${id}`);
}