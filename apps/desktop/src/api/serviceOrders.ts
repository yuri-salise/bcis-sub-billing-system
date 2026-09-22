import { apiCore } from './core.js';

export async function listServiceOrders(params) {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.orderType) q.set('orderType', params.orderType);
  return apiCore.request(`/api/v1/service-orders?${q.toString()}`);
}

export async function createServiceOrder(data) {
  return apiCore.request('/api/v1/service-orders', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function assignTechnician(orderId, technicianId) {
  return apiCore.request(`/api/v1/service-orders/${orderId}/assign`, {
    method: 'POST',
    body: JSON.stringify({ technicianId }),
  });
}

export async function updateServiceOrderStatus(orderId, status, reason) {
  return apiCore.request(`/api/v1/service-orders/${orderId}/status`, {
    method: 'POST',
    body: JSON.stringify({ status, reason }),
  });
}

export async function completeServiceOrder(orderId, resolutionNotes) {
  return apiCore.request(`/api/v1/service-orders/${orderId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ resolutionNotes }),
  });
}

export async function cancelServiceOrder(orderId, reason) {
  return apiCore.request(`/api/v1/service-orders/${orderId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}