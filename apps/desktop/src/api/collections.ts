import { apiCore } from './core.js';

export async function listCollectionAreas() {
  return apiCore.request('/api/v1/collections/areas');
}

export async function listCollectionRoutes(areaId) {
  const q = areaId ? `?areaId=${areaId}` : '';
  return apiCore.request(`/api/v1/collections/routes${q}`);
}

export async function getRouteRouteSheet(routeId, overdueOnly = false) {
  return apiCore.request(`/api/v1/collections/routes/${routeId}/route-sheet?overdueOnly=${overdueOnly}`);
}