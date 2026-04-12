import { Platform } from "react-native";

const CONNECTIVITY_TIMEOUT_MS = 4000;

const ENV_BACKEND_URL_RAW = process.env.EXPO_PUBLIC_BACKEND_URL?.trim() || "";
const BACKEND_FALLBACKS = (process.env.EXPO_PUBLIC_BACKEND_FALLBACKS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const PROBE_URLS = [
  ENV_BACKEND_URL_RAW,
  ...BACKEND_FALLBACKS,
  "https://staff.erdatayee.tech/api/health",
  "https://erdatayee.tech/api/health",
]
  .filter(Boolean)
  .map((value) => value.replace(/\/+$/, ""));

const withTimeout = async (url: string, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json,text/plain,*/*" },
    });
  } finally {
    clearTimeout(timer);
  }
};

export async function hasInternetConnection(): Promise<boolean> {
  if (
    Platform.OS === "web" &&
    typeof navigator !== "undefined" &&
    navigator.onLine === false
  ) {
    return false;
  }

  for (const baseUrl of PROBE_URLS) {
    try {
      const probeUrl = baseUrl.endsWith("/health")
        ? baseUrl
        : `${baseUrl}/health`;
      const response = await withTimeout(probeUrl, CONNECTIVITY_TIMEOUT_MS);
      if (response.ok || response.status === 401 || response.status === 403) {
        return true;
      }
    } catch {
      // Try next probe target.
    }
  }

  return false;
}

export function isLikelyConnectivityError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("offline") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("internet")
  );
}
