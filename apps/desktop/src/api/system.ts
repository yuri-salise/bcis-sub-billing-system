import { apiCore } from './core.js';

export async function ping() {
  return apiCore.request('/api/v1/health');
}

export async function createBackup() {
  return apiCore.request('/api/v1/system/backup', { method: 'POST' });
}

export async function listBackups() {
  return apiCore.request('/api/v1/system/backups');
}

export async function restoreBackup(filename) {
  return apiCore.request('/api/v1/system/restore', {
    method: 'POST',
    body: JSON.stringify({ filename }),
  });
}

export async function listTechnicians() {
  return apiCore.request('/api/v1/users');
}