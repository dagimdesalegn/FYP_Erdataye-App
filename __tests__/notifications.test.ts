/**
 * Tests for utils/notifications.ts — push notification utilities.
 */

// Mock backendPost before importing
jest.mock("../utils/api", () => ({
  backendPost: jest.fn().mockResolvedValue({ ok: true }),
  backendGet: jest.fn(),
}));

import {
  registerForPushNotifications,
  showLocalNotification,
} from "../utils/notifications";

describe("Push notification utilities", () => {
  test("registerForPushNotifications returns a token on success", async () => {
    const token = await registerForPushNotifications("user-123");
    expect(token).toBe("ExponentPushToken[test123]");
  });

  test("registerForPushNotifications calls backendPost with correct payload", async () => {
    const { backendPost } = require("../utils/api");
    backendPost.mockClear();

    await registerForPushNotifications("user-456");

    expect(backendPost).toHaveBeenCalledWith("/ops/push-token", {
      user_id: "user-456",
      token: "ExponentPushToken[test123]",
      platform: "android",
    });
  });

  test("showLocalNotification calls scheduleNotificationAsync", async () => {
    const Notifications = require("expo-notifications");
    Notifications.scheduleNotificationAsync.mockClear();

    await showLocalNotification("Test Title", "Test Body", { key: "value" });

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: "Test Title",
          body: "Test Body",
          data: { key: "value" },
        }),
        trigger: null,
      }),
    );
  });
});
