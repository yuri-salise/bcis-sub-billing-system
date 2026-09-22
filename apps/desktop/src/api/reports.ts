import { apiCore } from './core.js';

export async function getArAging() {
  return apiCore.request('/api/v1/reports/ar-aging');
}

export async function getDailyCollections(date) {
  const q = date ? `?date=${date}` : '';
  return apiCore.request(`/api/v1/reports/daily-collections${q}`);
}

export async function exportReportCsv(reportType) {
  return apiCore.request(`/api/v1/reports/${reportType}?format=csv`);
}