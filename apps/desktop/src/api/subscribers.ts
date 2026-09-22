import { apiCore } from './core.js';
import { SubscriberRecord, StatementOfAccountDto } from './types.js';

export async function listSubscribers(params) {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.status) q.set('status', params.status);
  if (params?.routeId) q.set('routeId', params.routeId);
  return apiCore.request(`/api/v1/subscribers?${q.toString()}`);
}

export async function getSubscriber(id) {
  return apiCore.request(`/api/v1/subscribers/${id}`);
}

export async function createSubscriber(data) {
  return apiCore.request('/api/v1/subscribers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateSubscriber(id, data) {
  return apiCore.request(`/api/v1/subscribers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function getSubscriberSoa(id) {
  return apiCore.request(`/api/v1/subscribers/${id}/soa`);
}