import { apiCore } from './core.js';

export async function listCollectionAreas(): Promise<any> {
  return apiCore.request<any>('/api/v1/collections/areas');
}
export async function listAreas(): Promise<any> {
  return apiCore.request<any>('/api/v1/collections/areas');
}

export async function listCollectionRoutes(areaId?: any): Promise<any> {
  const q = areaId ? `?areaId=${areaId}` : '';
  return apiCore.request<any>(`/api/v1/collections/routes${q}`);
}
export async function listRoutes(areaId?: any): Promise<any> {
  const q = areaId ? `?areaId=${areaId}` : '';
  return apiCore.request<any>(`/api/v1/collections/routes${q}`);
}

export async function getRouteRouteSheet(routeId: string, overdueOnly: boolean = false): Promise<any> {
  return apiCore.request<any>(`/api/v1/collections/routes/${routeId}/route-sheet?overdueOnly=${overdueOnly}`);
}
export async function getAreaRouteSheet(areaId: string, overdueOnly: boolean = false): Promise<any> {
  return apiCore.request<any>(`/api/v1/collections/areas/${areaId}/route-sheet?overdueOnly=${overdueOnly}`);
}