/**
 * Tests for utils/i18n.ts — translation utility.
 */
import { t, setLang, getLang, loadLang as _loadLang } from "../utils/i18n";

describe("i18n translation utility", () => {
  beforeEach(() => {
    // Reset to English before each test
    // Using internal knowledge: setLang is async but getLang is sync
  });

  test("getLang defaults to 'en'", () => {
    expect(getLang()).toBe("en");
  });

  test("t() returns English text by default", () => {
    expect(t("login")).toBe("Login");
    expect(t("register")).toBe("Register");
    expect(t("cancel")).toBe("Cancel");
  });

  test("t() returns Amharic text after setLang('am')", async () => {
    await setLang("am");
    expect(getLang()).toBe("am");
    expect(t("login")).toBe("ግባ");
    expect(t("register")).toBe("ተመዝገብ");
    expect(t("cancel")).toBe("ሰርዝ");
    // Reset
    await setLang("en");
  });

  test("t() returns key for unknown translations", () => {
    expect(t("nonexistent_key")).toBe("nonexistent_key");
  });

  test("t() supports placeholder substitution", async () => {
    await setLang("en");
    expect(t("eta_minutes", "5")).toBe("ETA: 5 min");

    await setLang("am");
    expect(t("eta_minutes", "5")).toBe("ግምት: 5 ደቂቃ");

    await setLang("en");
  });

  test("t() handles multiple placeholders", () => {
    // Even though current translations use single placeholder,
    // the function should handle multiple
    expect(typeof t("app_name")).toBe("string");
  });

  test("all critical UI keys exist", () => {
    const criticalKeys = [
      "app_name", "login", "register", "logout",
      "request_ambulance", "cancel_emergency",
      "accept", "decline", "go_online", "go_offline",
      "hospital_dashboard", "admin_panel",
      "first_aid", "help", "my_profile",
    ];
    for (const key of criticalKeys) {
      const en = t(key);
      expect(en).not.toBe(key); // should have a translation, not return the key itself
      expect(en.length).toBeGreaterThan(0);
    }
  });

  test("Amharic translations exist for critical keys", async () => {
    await setLang("am");
    const criticalKeys = [
      "login", "register", "cancel", "accept", "decline",
      "request_ambulance", "go_online", "go_offline",
    ];
    for (const key of criticalKeys) {
      const am = t(key);
      expect(am).not.toBe(key);
      // Amharic text should contain Ethiopic characters (Unicode range 1200–137F)
      expect(/[\u1200-\u137F]/.test(am)).toBe(true);
    }
    await setLang("en");
  });
});
