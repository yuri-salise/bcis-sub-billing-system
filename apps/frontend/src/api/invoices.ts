import { apiCore } from './core.js';

export async function listInvoices(params?: any): Promise<any> {
  const q = new URLSearchParams();
  if (params?.subscriberId) q.set('subscriberId', params.subscriberId);
  if (params?.status) q.set('status', params.status);
  return apiCore.request<any>(`/api/v1/invoices?${q.toString()}`);
}

export async function getInvoice(id: string): Promise<any> {
  return apiCore.request<any>(`/api/v1/invoices/${id}`);
}

export async function generateInvoiceBatch(data?: any): Promise<any> {
  return apiCore.request<any>('/api/v1/invoices/batch', {
    method: 'POST',
    body: JSON.stringify(data || {}),
  });
}