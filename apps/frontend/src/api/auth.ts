import { apiCore } from './core.js';
import { UserProfile } from './types.js';

export async function login(username: string, password: string): Promise<any> {
  return apiCore.request<any>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function logout(): Promise<any> {
  return apiCore.request<any>('/api/v1/auth/logout', { method: 'POST' });
}

export async function lock(): Promise<any> {
  return apiCore.request<any>('/api/v1/auth/lock', { method: 'POST' });
}

export async function unlock(password: string): Promise<any> {
  return apiCore.request<any>('/api/v1/auth/unlock', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function getMe(): Promise<any> {
  return apiCore.request<any>('/api/v1/auth/me');
}