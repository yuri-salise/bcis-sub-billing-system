import { apiCore } from './core.js';

export async function listPayments(params?: any): Promise<any> {
  const q = new URLSearchParams();
  if (params?.subscriberId) q.set('subscriberId', params.subscriberId);
  return apiCore.request<any>(`/api/v1/payments?${q.toString()}`);
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