/**
 * Authenticated client for the Erdataye Python backend.
 *
 * Every request automatically attaches the current Supabase session JWT so
 * the backend can verify the caller via its `get_current_user` dependency.
 */
import { supabase } from './supabase';

const ENV_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

function resolveBackendUrl(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLocalWeb = host === 'localhost' || host === '127.0.0.1';
    const pointsToTunnel = ENV_BACKEND_URL.includes('ngrok') || ENV_BACKEND_URL.includes('.dev');
    if (isLocalWeb && pointsToTunnel) {
      return 'http://localhost:8000';
    }
  }
  return ENV_BACKEND_URL;
}

const BACKEND_URL = resolveBackendUrl();
const DEFAULT_TIMEOUT_MS = 12000;

function toErrorMessage(status: number, body: any): string {
  if (typeof body?.detail === 'string' && body.detail.trim()) return body.detail;
  if (typeof body?.message === 'string' && body.message.trim()) return body.message;
  return `Backend error ${status}`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('Request timeout. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(toErrorMessage(res.status, body));
  }

  if (res.status === 204) {
    return {} as T;
  }

  return res.json() as Promise<T>;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export async function backendGet<T>(path: string): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetchWithTimeout(`${BACKEND_URL}${path}`, { headers }, 12000);
  return parseJsonResponse<T>(res);
}

export async function backendPost<T>(path: string, body: unknown): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetchWithTimeout(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, 15000);
  return parseJsonResponse<T>(res);
}

export async function backendPut<T>(path: string, body: unknown): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetchWithTimeout(`${BACKEND_URL}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  }, 15000);
  return parseJsonResponse<T>(res);
}

export async function backendDelete<T>(path: string): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetchWithTimeout(`${BACKEND_URL}${path}`, {
    method: 'DELETE',
    headers,
  }, 12000);
  return parseJsonResponse<T>(res);
}
