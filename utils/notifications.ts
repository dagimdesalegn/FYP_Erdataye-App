/**
 * Push notification utilities for the Erdataye app.
 *
 * Uses expo-notifications for:
 *  - Requesting notification permission
 *  - Retrieving Expo push token
 *  - Registering token with the backend
 *  - Handling incoming notifications
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { backendPost } from "./api";

// ── Configure notification behaviour ──────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
    priority: Notifications.AndroidNotificationPriority.HIGH,
  }),
});

// ── Android channel ───────────────────────────────────────────────────────
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("emergencies", {
    name: "Emergency Alerts",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    sound: "default",
  }).catch(() => {});
}

// ── Push token registration ───────────────────────────────────────────────

/**
 * Request notification permissions, retrieve Expo push token,
 * and register it with the backend.
 *
 * @returns The Expo push token string, or null if unavailable.
 */
export async function registerForPushNotifications(
  userId: string,
): Promise<string | null> {
  try {
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.warn("[notifications] Permission not granted");
      return null;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    if (!projectId) {
      console.warn("[notifications] No EAS project ID found");
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;

    // Register token with backend
    await backendPost("/ops/push-token", { user_id: userId, token, platform: Platform.OS });

    return token;
  } catch (err) {
    console.error("[notifications] Registration failed:", err);
    return null;
  }
}

// ── Notification listeners ────────────────────────────────────────────────

/**
 * Subscribe to incoming notifications while the app is foregrounded.
 * Returns an unsubscribe function.
 */
export function onNotificationReceived(
  callback: (notification: Notifications.Notification) => void,
): () => void {
  const subscription =
    Notifications.addNotificationReceivedListener(callback);
  return () => subscription.remove();
}

/**
 * Subscribe to notification tap/interactions.
 * Returns an unsubscribe function.
 */
export function onNotificationResponse(
  callback: (response: Notifications.NotificationResponse) => void,
): () => void {
  const subscription =
    Notifications.addNotificationResponseReceivedListener(callback);
  return () => subscription.remove();
}

/**
 * Schedule an immediate local notification (useful for driver alerts
 * when a Supabase realtime event fires while app is foregrounded).
 */
export async function showLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data ?? {},
      sound: "default",
      ...(Platform.OS === "android" ? { channelId: "emergencies" } : {}),
    },
    trigger: null, // show immediately
  });
}
