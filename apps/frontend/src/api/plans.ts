import { apiCore } from './core.js';

export async function listPlans(serviceType?: any): Promise<any> {
  const q = serviceType ? `?serviceType=${serviceType}` : '';
  return apiCore.request<any>(`/api/v1/plans${q}`);
}

export async function createPlan(data: any): Promise<any> {
  return apiCore.request<any>('/api/v1/plans', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}