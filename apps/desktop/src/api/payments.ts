import { apiCore } from './core.js';

export async function listPayments(params) {
  const q = new URLSearchParams();
  if (params?.subscriberId) q.set('subscriberId', params.subscriberId);
  return apiCore.request(`/api/v1/payments?${q.toString()}`);
}

export async function processPayment(data) {
  return apiCore.request('/api/v1/payments', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}