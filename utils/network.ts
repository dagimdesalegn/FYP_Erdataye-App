import { Platform } from "react-native";

const CONNECTIVITY_TIMEOUT_MS = 8000;

const PRODUCTION_VPS_HEALTH = "http://95.111.253.90/api/health";
const SUPABASE_HEALTH = (() => {
  const base = (process.env.EXPO_PUBLIC_SUPABASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (base) return `${base}/auth/v1/health`;
  return "https://padezipdfcicydyncmkw.supabase.co/auth/v1/health";
})();

const ENV_BACKEND_URL_RAW = process.env.EXPO_PUBLIC_BACKEND_URL?.trim() || "";
const BACKEND_FALLBACKS = (process.env.EXPO_PUBLIC_BACKEND_FALLBACKS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const toHealthUrl = (value: string): string => {
  const v = value.replace(/\/+$/, "");
  if (v.endsWith("/health")) return v;
  if (v.endsWith("/api")) return `${v}/health`;
  return `${v}/health`;
};

const PROBE_URLS = [
  PRODUCTION_VPS_HEALTH,
  SUPABASE_HEALTH,
  ENV_BACKEND_URL_RAW ? toHealthUrl(ENV_BACKEND_URL_RAW) : "",
  ...BACKEND_FALLBACKS.map(toHealthUrl),
]
  .filter(Boolean)
  .filter((v, i, a) => a.indexOf(v) === i);

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

const probeSucceeded = (response: Response): boolean =>
  response.ok || response.status === 401 || response.status === 403;

export async function hasInternetConnection(): Promise<boolean> {
  if (
    Platform.OS === "web" &&
    typeof navigator !== "undefined" &&
    navigator.onLine === false
  ) {
    return false;
  }

  for (const probeUrl of PROBE_URLS) {
    try {
      const response = await withTimeout(probeUrl, CONNECTIVITY_TIMEOUT_MS);
      if (probeSucceeded(response)) {
        return true;
      }
    } catch {
      // Try next probe target.
    }
  }

  // Release Android builds can false-negative on HTTP health probes even when
  // the device is online. Let auth/API calls surface real errors instead of
  // blocking login with a misleading offline message.
  if (Platform.OS !== "web") {
    return true;
  }

  return false;
}

export function isLikelyConnectivityError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("unable to reach backend") ||
    message.includes("unreachable") ||
    message.includes("offline") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("internet") ||
    message.includes("aborted")
  );
}
