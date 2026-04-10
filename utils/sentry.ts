/**
 * Sentry error tracking for the Erdataye React Native frontend.
 *
 * Initialises Sentry when EXPO_PUBLIC_SENTRY_DSN is set.
 * Safe to import even when Sentry is not configured — all calls
 * become no-ops.
 *
 * Usage:
 *   import { initSentry, captureException } from '@/utils/sentry';
 *   initSentry();  // call once in _layout.tsx
 */

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? "";

let _initialised = false;
let _Sentry: any = null;

async function loadSentryModule(): Promise<any> {
  try {
    // @sentry/react-native is not in dependencies, so require will fail gracefully
    return require("@sentry/react-native");
  } catch {
    return null;
  }
}

/**
 * Initialise Sentry SDK. Call once at app startup.
 */
export async function initSentry(): Promise<void> {
  if (_initialised || !SENTRY_DSN) return;

  try {
    _Sentry = await loadSentryModule();
    if (!_Sentry) {
      return;
    }
    _Sentry.init({
      dsn: SENTRY_DSN,
      tracesSampleRate: 0.2,
      enableAutoSessionTracking: true,
      environment: __DEV__ ? "development" : "production",
    });
    _initialised = true;
  } catch {
    // sentry-sdk not installed — silently skip
  }
}

/**
 * Report an exception to Sentry. No-op if Sentry is not initialised.
 */
export function captureException(error: Error | unknown): void {
  if (!_initialised || !_Sentry) return;
  try {
    _Sentry.captureException(error);
  } catch {
    // best-effort
  }
}

/**
 * Send a message to Sentry. No-op if Sentry is not initialised.
 */
export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
): void {
  if (!_initialised || !_Sentry) return;
  try {
    _Sentry.captureMessage(message, level);
  } catch {
    // best-effort
  }
}
