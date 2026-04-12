/**
 * Authenticated client for the Erdataye Python backend.
 *
 * Every request automatically attaches the current Supabase session JWT so
 * the backend can verify the caller via its `get_current_user` dependency.
 */
import { Platform } from "react-native";

import { supabase } from "./supabase";

const ENV_BACKEND_URL_RAW = process.env.EXPO_PUBLIC_BACKEND_URL?.trim() || "";
const ENV_BACKEND_URL = ENV_BACKEND_URL_RAW || "http://localhost:8000";
const BACKEND_FALLBACKS = (process.env.EXPO_PUBLIC_BACKEND_FALLBACKS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

// Safety net for release builds where EXPO_PUBLIC_* env values may not be
// embedded as expected. Keep public URLs here so mobile requests still work.
const DEFAULT_PUBLIC_BACKENDS = [
  "https://staff.erdatayee.tech/api",
  "https://erdatayee.tech/api",
  "http://207.180.205.85/api",
  "http://207.180.205.85:8000",
];

const DEFAULT_TIMEOUT_MS = 12000;
const GET_TIMEOUT_MS = 12000;

const AUTH_ERROR_SNIPPETS = [
  "session from session_id claim",
  "session does not exist",
  "jwt expired",
  "token expired",
  "invalid jwt",
  "invalid token",
  "invalid signature",
  "not authenticated",
  "authentication required",
];

const TRANSIENT_ERROR_SNIPPETS = [
  "timeout",
  "network request failed",
  "failed to fetch",
];

const isLocalBackendUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1", "0.0.0.0", "10.0.2.2"].includes(
      parsed.hostname,
    );
  } catch {
    return false;
  }
};

const isSecureWebContext = (): boolean => {
  if (Platform.OS !== "web") return false;
  return (
    typeof window !== "undefined" &&
    typeof window.location !== "undefined" &&
    window.location?.protocol === "https:"
  );
};

const isInsecureHttp = (url: string): boolean => /^http:\/\//i.test(url);
const allowInsecureHttpCandidate = (url: string): boolean => {
  if (!isInsecureHttp(url)) return true;
  return typeof __DEV__ !== "undefined" ? __DEV__ : false;
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const addDerivedPublicCandidates = (list: string[], sourceUrl: string) => {
  try {
    const parsed = new URL(sourceUrl);
    const sourcePath = trimTrailingSlash(parsed.pathname || "");
    const hostOnly = parsed.hostname;
    const origin = `${parsed.protocol}//${parsed.host}`;
    const hostOrigin = `${parsed.protocol}//${hostOnly}`;

    if (!hostOnly || isLocalBackendUrl(sourceUrl)) return;

    // When env points to :8000, also try /api on port 80.
    if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
      addCandidate(list, `${hostOrigin}/api`);
    }

    // When env points to origin, also try /api.
    if (!sourcePath || sourcePath === "/") {
      addCandidate(list, `${origin}/api`);
      return;
    }

    // When env points to /api, also keep direct origin and :8000.
    if (sourcePath === "/api") {
      addCandidate(list, origin);
      addCandidate(list, `${parsed.protocol}//${hostOnly}:8000`);
    }
  } catch {
    // Ignore invalid URLs.
  }
};

const addCandidate = (list: string[], candidate?: string | null) => {
  if (!candidate) return;
  if (!/^https?:\/\//i.test(candidate)) return;
  if (isSecureWebContext() && isInsecureHttp(candidate)) return;
  if (!allowInsecureHttpCandidate(candidate)) return;
  const normalized = trimTrailingSlash(candidate);
  if (!list.includes(normalized)) {
    list.push(normalized);
  }
};

const buildBackendCandidates = (): string[] => {
  const candidates: string[] = [];

  if (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    typeof window.location !== "undefined" &&
    window.location
  ) {
    addCandidate(candidates, `${window.location.origin}/api`);
  }

  // Prioritize public fallbacks on mobile/web when localhost is unreachable.
  BACKEND_FALLBACKS.filter((value) => !isLocalBackendUrl(value)).forEach(
    (value) => {
      addCandidate(candidates, value);
      addDerivedPublicCandidates(candidates, value);
    },
  );

  if (ENV_BACKEND_URL_RAW) {
    addCandidate(candidates, ENV_BACKEND_URL_RAW);
    addDerivedPublicCandidates(candidates, ENV_BACKEND_URL_RAW);
  }

  BACKEND_FALLBACKS.forEach((value) => addCandidate(candidates, value));

  // If nothing public was configured, inject stable production fallbacks.
  // This prevents mobile requests from getting stuck on localhost.
  if (!candidates.some((value) => !isLocalBackendUrl(value))) {
    DEFAULT_PUBLIC_BACKENDS.forEach((value) => {
      addCandidate(candidates, value);
      addDerivedPublicCandidates(candidates, value);
    });
  }

  const localDefaults = ["http://localhost:8000", "http://127.0.0.1:8000"];
  if (Platform.OS === "android") {
    localDefaults.push("http://10.0.2.2:8000");
  }
  if (Platform.OS === "ios") {
    localDefaults.push("http://127.0.0.1:8000");
  }
  localDefaults.forEach((value) => addCandidate(candidates, value));

  if (!ENV_BACKEND_URL_RAW) {
    addCandidate(candidates, ENV_BACKEND_URL);
  }

  if (
    typeof window !== "undefined" &&
    typeof window.location !== "undefined" &&
    window.location
  ) {
    const host = window.location.hostname || "";
    const isLocalHost = host === "localhost" || host === "127.0.0.1";
    const hostLooksLikeLanIp = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
    const envLooksLikeTunnel =
      ENV_BACKEND_URL.includes("ngrok") || ENV_BACKEND_URL.includes(".dev");

    if (isLocalHost && envLooksLikeTunnel) {
      addCandidate(candidates, "http://localhost:8000");
    }

    if (hostLooksLikeLanIp) {
      addCandidate(candidates, `http://${host}:8000`);
    }
  }

  return candidates.length > 0 ? candidates : ["http://localhost:8000"];
};

const BACKEND_CANDIDATES = buildBackendCandidates();
let activeBackendBase = BACKEND_CANDIDATES[0];

const getBackendBaseOrder = (): string[] => {
  if (!activeBackendBase) {
    activeBackendBase = BACKEND_CANDIDATES[0];
  }
  const rest = BACKEND_CANDIDATES.filter(
    (candidate) => candidate !== activeBackendBase,
  );
  return [activeBackendBase, ...rest];
};

function toErrorMessage(status: number, body: any): string {
  if (typeof body?.detail === "string" && body.detail.trim())
    return body.detail;
  if (Array.isArray(body?.detail) && body.detail.length > 0) {
    const first = body.detail[0];
    const message = typeof first?.msg === "string" ? first.msg : "";
    const location = Array.isArray(first?.loc) ? first.loc.join(".") : "";
    if (message && location) return `${location}: ${message}`;
    if (message) return message;
  }
  if (body?.detail && typeof body.detail === "object") {
    const detailMessage =
      body.detail.message || body.detail.error || body.detail.msg;
    if (typeof detailMessage === "string" && detailMessage.trim()) {
      return detailMessage;
    }
  }
  if (typeof body?.message === "string" && body.message.trim())
    return body.message;
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
    if (error?.name === "AbortError") {
      throw new Error("Request timeout. Please try again.");
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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

const isAuthErrorMessage = (message: string): boolean =>
  AUTH_ERROR_SNIPPETS.some((snippet) => message.includes(snippet));

const isTransientNetworkError = (message: string): boolean =>
  TRANSIENT_ERROR_SNIPPETS.some((snippet) => message.includes(snippet));

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface BackendRequestOptions {
  method: HttpMethod;
  path: string;
  body?: unknown;
  timeoutMs?: number;
}

async function requestWithSessionRecovery<T>({
  method,
  path,
  body,
  timeoutMs,
}: BackendRequestOptions): Promise<T> {
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: Error | null = null;

  for (const baseUrl of getBackendBaseOrder()) {
    let refreshedSession = false;
    let networkAttempt = 0;

    while (networkAttempt < 2) {
      const headers = await getAuthHeaders();
      const init: RequestInit = {
        method,
        headers,
      };

      if (body !== undefined && method !== "GET") {
        init.body = JSON.stringify(body);
      }

      try {
        const res = await fetchWithTimeout(`${baseUrl}${path}`, init, timeout);

        if (res.status === 401 && !refreshedSession) {
          const { error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError) {
            throw new Error(refreshError.message || "Session refresh failed");
          }
          refreshedSession = true;
          continue;
        }

        activeBackendBase = baseUrl;
        return await parseJsonResponse<T>(res);
      } catch (error: any) {
        const err =
          error instanceof Error
            ? error
            : new Error(String(error?.message || error));
        lastError = err;
        const message = String(err.message || "").toLowerCase();

        if (!refreshedSession && isAuthErrorMessage(message)) {
          const { error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError) {
            break;
          }
          refreshedSession = true;
          continue;
        }

        if (isTransientNetworkError(message) && networkAttempt === 0) {
          networkAttempt += 1;
          continue;
        }

        break;
      }
    }
  }

  throw lastError ?? new Error("Backend request failed");
}

export async function backendGet<T>(path: string): Promise<T> {
  return requestWithSessionRecovery<T>({
    method: "GET",
    path,
    timeoutMs: GET_TIMEOUT_MS,
  });
}

export async function backendPost<T>(path: string, body: unknown): Promise<T> {
  return requestWithSessionRecovery<T>({
    method: "POST",
    path,
    body,
    timeoutMs: 10000,
  });
}

export async function backendPut<T>(path: string, body: unknown): Promise<T> {
  return requestWithSessionRecovery<T>({
    method: "PUT",
    path,
    body,
    timeoutMs: 10000,
  });
}

export async function backendPatch<T>(path: string, body: unknown): Promise<T> {
  return requestWithSessionRecovery<T>({
    method: "PATCH",
    path,
    body,
    timeoutMs: 10000,
  });
}

export async function backendDelete<T>(path: string): Promise<T> {
  return requestWithSessionRecovery<T>({
    method: "DELETE",
    path,
    timeoutMs: 8000,
  });
}
