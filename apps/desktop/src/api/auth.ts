import { apiCore } from './core.js';
import { UserProfile } from './types.js';

export async function login(username, password) {
  return apiCore.request('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function logout() {
  return apiCore.request('/api/v1/auth/logout', { method: 'POST' });
}

export async function lock() {
  return apiCore.request('/api/v1/auth/lock', { method: 'POST' });
}

export async function unlock(password) {
  return apiCore.request('/api/v1/auth/unlock', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function getMe() {
  return apiCore.request('/api/v1/auth/me');
}