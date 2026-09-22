import { apiCore } from './core.js';

export async function listPlans(serviceType) {
  const q = serviceType ? `?serviceType=${serviceType}` : '';
  return apiCore.request(`/api/v1/plans${q}`);
}