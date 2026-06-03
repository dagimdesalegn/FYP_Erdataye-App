import { Platform } from "react-native";

const CONNECTIVITY_TIMEOUT_MS = 4000;

const ENV_BACKEND_URL_RAW = process.env.EXPO_PUBLIC_BACKEND_URL?.trim() || "";
const BACKEND_FALLBACKS = (process.env.EXPO_PUBLIC_BACKEND_FALLBACKS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const PRODUCTION_HEALTH_PROBES = [
  "http://95.111.253.90/api/health",
  "http://95.111.253.90:8000/health",
];

const SUPABASE_PROBE =
  (process.env.EXPO_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "") +
  "/auth/v1/health";

const PROBE_URLS = [
  ...PRODUCTION_HEALTH_PROBES,
  SUPABASE_PROBE,
  ENV_BACKEND_URL_RAW ? `${ENV_BACKEND_URL_RAW.replace(/\/+$/, "")}/health`.replace("/api/health", "/health") : "",
  ENV_BACKEND_URL_RAW?.replace(/\/+$/, "") || "",
  ...BACKEND_FALLBACKS,
]
  .filter(Boolean)
  .map((value) => {
    const v = value.replace(/\/+$/, "");
    if (v.endsWith("/health")) return v;
    if (v.includes("/api")) return `${v.replace(/\/api$/, "")}/api/health`.replace("//api", "/api");
    return `${v}/health`;
  })
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
