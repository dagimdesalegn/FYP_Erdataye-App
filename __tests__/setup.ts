/**
 * Jest test setup for the Erdataye React Native app.
 * Mocks platform APIs that aren't available in the test environment.
 */

// Mock react-native Platform
jest.mock("react-native", () => ({
  Platform: { OS: "android", select: (obj: any) => obj.android ?? obj.default },
}));

// Mock expo-notifications
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  getPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: "granted" })
  ),
  requestPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: "granted" })
  ),
  getExpoPushTokenAsync: jest.fn(() =>
    Promise.resolve({ data: "ExponentPushToken[test123]" })
  ),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve()),
  AndroidNotificationPriority: { HIGH: 4 },
  AndroidImportance: { MAX: 5 },
}));

// Mock expo-constants
jest.mock("expo-constants", () => ({
  expoConfig: {
    extra: { eas: { projectId: "test-project-id" } },
  },
  easConfig: { projectId: "test-project-id" },
}));

// Mock async storage used by offline queue
const _memoryStore: Record<string, string> = {};
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn((k: string) => Promise.resolve(_memoryStore[k] ?? null)),
  setItem: jest.fn((k: string, v: string) => {
    _memoryStore[k] = v;
    return Promise.resolve();
  }),
  removeItem: jest.fn((k: string) => {
    delete _memoryStore[k];
    return Promise.resolve();
  }),
}));

// Mock supabase client
jest.mock("../utils/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      getUser: jest.fn(() =>
        Promise.resolve({ data: { user: null }, error: null })
      ),
      getSession: jest.fn(() =>
        Promise.resolve({ data: { session: null }, error: null })
      ),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
      updateUser: jest.fn(() => Promise.resolve({ data: {}, error: null })),
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(() => Promise.resolve({ data: null, error: null })),
    })),
  },
}));
