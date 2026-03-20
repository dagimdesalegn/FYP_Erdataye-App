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

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export async function backendGet<T>(path: string): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BACKEND_URL}${path}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.detail ?? `Backend error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function backendPost<T>(path: string, body: unknown): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail ?? `Backend error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function backendPut<T>(path: string, body: unknown): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail ?? `Backend error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function backendDelete<T>(path: string): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail ?? `Backend error ${res.status}`);
  }
  return res.json() as Promise<T>;
}
