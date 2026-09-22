import { apiCore } from './core.js';

export async function ping(): Promise<any> {
  return apiCore.request<any>('/api/v1/health');
}

export async function createBackup(): Promise<any> {
  return apiCore.request<any>('/api/v1/system/backup', { method: 'POST' });
}

export async function listBackups(): Promise<any> {
  return apiCore.request<any>('/api/v1/system/backups');
}

export async function restoreBackup(filename: string): Promise<any> {
  return apiCore.request<any>('/api/v1/system/restore', {
    method: 'POST',
    body: JSON.stringify({ filename }),
  });
}

export async function listTechnicians(): Promise<any> {
  return apiCore.request<any>('/api/v1/users');
}