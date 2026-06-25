import Constants from "expo-constants";
import { Platform } from "react-native";

export const APP_UPDATE_METADATA_URL =
  process.env.EXPO_PUBLIC_APP_UPDATE_URL?.trim() ||
  "https://erdatayee.tech/app-update.json";

const DEFAULT_APK_URL = "https://erdatayee.tech/downloads/erdataye.apk";
const REQUEST_TIMEOUT_MS = 4500;

export type AppUpdateCheckResult = {
  updateAvailable: boolean;
  forceUpdate: boolean;
  latestVersionCode: number;
  currentVersionCode: number;
  latestVersionLabel: string;
  currentVersionLabel: string;
  apkUrl: string;
  message?: string;
};

type RemoteUpdateMetadata = {
  latestVersionCode?: number | string;
  versionCode?: number | string;
  latestVersion?: string;
  version?: string;
  minSupportedVersionCode?: number | string;
  minimumVersionCode?: number | string;
  force?: boolean;
  forceUpdate?: boolean;
  apkUrl?: string;
  downloadUrl?: string;
  message?: string;
};

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

function getCurrentVersionCode(): number {
  const fromNative = toInt(Constants.nativeBuildVersion);
  if (fromNative !== null) return fromNative;

  const fromExpoConfig = toInt(Constants.expoConfig?.android?.versionCode);
  if (fromExpoConfig !== null) return fromExpoConfig;

  return 0;
}

function getCurrentVersionLabel(): string {
  const label = Constants.expoConfig?.version;
  return typeof label === "string" && label.trim() ? label.trim() : "unknown";
}

function normalizeApkUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return DEFAULT_APK_URL;
  }

  const candidate = rawUrl.trim();
  if (/^https:\/\//i.test(candidate)) {
    return candidate;
  }

  return DEFAULT_APK_URL;
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Update metadata request failed (${res.status})`);
    }

    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function checkForAndroidAppUpdate(): Promise<AppUpdateCheckResult | null> {
  if (Platform.OS !== "android") {
    return null;
  }

  try {
    const payload = (await fetchJsonWithTimeout(
      APP_UPDATE_METADATA_URL,
      REQUEST_TIMEOUT_MS,
    )) as RemoteUpdateMetadata;

    const latestVersionCode =
      toInt(payload.latestVersionCode) ?? toInt(payload.versionCode);
    if (latestVersionCode === null) {
      return null;
    }

    const minSupportedVersionCode =
      toInt(payload.minSupportedVersionCode) ??
      toInt(payload.minimumVersionCode) ??
      latestVersionCode;

    const currentVersionCode = getCurrentVersionCode();
    const latestVersionLabel =
      typeof payload.latestVersion === "string" && payload.latestVersion.trim()
        ? payload.latestVersion.trim()
        : typeof payload.version === "string" && payload.version.trim()
          ? payload.version.trim()
          : String(latestVersionCode);

    const result: AppUpdateCheckResult = {
      updateAvailable: currentVersionCode < latestVersionCode,
      forceUpdate:
        payload.force === true ||
        payload.forceUpdate === true ||
        currentVersionCode < minSupportedVersionCode,
      latestVersionCode,
      currentVersionCode,
      latestVersionLabel,
      currentVersionLabel: getCurrentVersionLabel(),
      apkUrl: normalizeApkUrl(payload.apkUrl ?? payload.downloadUrl),
      message:
        typeof payload.message === "string" ? payload.message.trim() : "",
    };

    if (!result.updateAvailable) {
      return null;
    }

    return result;
  } catch {
    return null;
  }
}
