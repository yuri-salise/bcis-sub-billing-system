import { apiCore } from './core.js';

export async function listSubscribers(params?: any): Promise<any> {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.status) q.set('status', params.status);
  if (params?.routeId) q.set('routeId', params.routeId);
  return apiCore.request<any>(`/api/v1/subscribers?${q.toString()}`);
}

export async function getSubscriber(id: string): Promise<any> {
  return apiCore.request<any>(`/api/v1/subscribers/${id}`);
}

export async function createSubscriber(data: any): Promise<any> {
  return apiCore.request<any>('/api/v1/subscribers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateSubscriber(id: string, data: any): Promise<any> {
  return apiCore.request<any>(`/api/v1/subscribers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function getSubscriberSoa(id: string): Promise<any> {
  return apiCore.request<any>(`/api/v1/subscribers/${id}/soa`);
}