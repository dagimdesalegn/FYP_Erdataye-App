/**
 * Tests for utils/notifications.ts — push notification utilities.
 */

// Mock backendPost before importing
import {
  registerForPushNotifications,
  showLocalNotification,
} from "../utils/notifications";

jest.mock("../utils/api", () => ({
  backendPost: jest.fn().mockResolvedValue({ ok: true }),
  backendGet: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { backendPost: mockBackendPost } = require("../utils/api");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MockNotifications = require("expo-notifications");

describe("Push notification utilities", () => {
  test("registerForPushNotifications returns a token on success", async () => {
    const token = await registerForPushNotifications("user-123");
    expect(token).toBe("ExponentPushToken[test123]");
  });

  test("registerForPushNotifications calls backendPost with correct payload", async () => {
    mockBackendPost.mockClear();

    await registerForPushNotifications("user-456");

    expect(mockBackendPost).toHaveBeenCalledWith("/ops/push-token", {
      user_id: "user-456",
      token: "ExponentPushToken[test123]",
      platform: "android",
    });
  });

  test("showLocalNotification calls scheduleNotificationAsync", async () => {
    MockNotifications.scheduleNotificationAsync.mockClear();

    await showLocalNotification("Test Title", "Test Body", { key: "value" });

    expect(MockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
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
