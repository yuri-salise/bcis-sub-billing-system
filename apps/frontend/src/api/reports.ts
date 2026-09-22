import { apiCore } from './core.js';

export async function getArAging(): Promise<any> {
  return apiCore.request<any>('/api/v1/reports/ar-aging');
}

export async function getDailyCollections(date?: string): Promise<any> {
  const q = date ? `?date=${date}` : '';
  return apiCore.request<any>(`/api/v1/reports/daily-collections${q}`);
}

export async function exportReportCsv(reportType: string): Promise<any> {
  return apiCore.request<any>(`/api/v1/reports/${reportType}?format=csv`);
}