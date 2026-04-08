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
import Constants from "expo-constants";
import { backendPost } from "./api";

const IS_EXPO_GO = Constants.appOwnership === "expo";

// Lazy-load expo-notifications to avoid web SSR crash (localStorage not available)
type NotificationsModule = typeof import("expo-notifications");
type NotificationType = unknown;
type NotificationResponseType = unknown;

let Notifications: NotificationsModule | null = null;
const getNotifications = async () => {
  if (!Notifications) {
    Notifications = await import("expo-notifications");
  }
  return Notifications;
};

// ── Configure notification behaviour (skip on web) ──────────────────────
if (Platform.OS !== "web" && !IS_EXPO_GO) {
  getNotifications().then((N) => {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
        priority: N.AndroidNotificationPriority.HIGH,
      }),
    });

    // ── Android channel ─────────────────────────────────────────────────
    if (Platform.OS === "android") {
      N.setNotificationChannelAsync("emergencies", {
        name: "Emergency Alerts",
        importance: N.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        sound: "default",
      }).catch(() => {});
    }
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
    if (Platform.OS === "web") {
      return null;
    }

    // Expo Go SDK 53+ no longer supports remote push notifications.
    if (IS_EXPO_GO) {
      console.warn(
        "[notifications] Remote push is disabled in Expo Go. Use a development build for push testing.",
      );
      return null;
    }

    const Notifications = await getNotifications();
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
  callback: (notification: NotificationType) => void,
): () => void {
  if (Platform.OS === "web" || IS_EXPO_GO) {
    return () => {};
  }

  let subscription: { remove: () => void } | null = null;
  void getNotifications()
    .then((Notifications) => {
      subscription = Notifications.addNotificationReceivedListener(callback);
    })
    .catch(() => {});
  return () => {
    subscription?.remove();
  };
}

/**
 * Subscribe to notification tap/interactions.
 * Returns an unsubscribe function.
 */
export function onNotificationResponse(
  callback: (response: NotificationResponseType) => void,
): () => void {
  if (Platform.OS === "web" || IS_EXPO_GO) {
    return () => {};
  }

  let subscription: { remove: () => void } | null = null;
  void getNotifications()
    .then((Notifications) => {
      subscription =
        Notifications.addNotificationResponseReceivedListener(callback);
    })
    .catch(() => {});
  return () => {
    subscription?.remove();
  };
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
  if (Platform.OS === "web" || IS_EXPO_GO) {
    return;
  }

  const Notifications = await getNotifications();
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
