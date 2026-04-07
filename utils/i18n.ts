/**
 * Full UI internationalisation for the Erdataye app.
 *
 * Extends the first-aid chatbot i18n (`i18n-first-aid.ts`) to cover
 * all buttons, labels, headers, and messages across the entire app.
 *
 * Usage:
 *   import { t, setLang, getLang } from '@/utils/i18n';
 *   <Text>{t('login')}</Text>
 */

export type Lang = "en" | "am";

const STORAGE_KEY = "erdataye_lang";
let _currentLang: Lang = "en";

/** Set the active language and persist. */
export async function setLang(lang: Lang): Promise<void> {
  _currentLang = lang;
  try {
    const { supabase } = await import("./supabase");
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.auth.updateUser({ data: { preferred_lang: lang } });
    }
  } catch { /* best-effort persist */ }
}

/** Get current language synchronously. */
export function getLang(): Lang {
  return _currentLang;
}

/** Load persisted language preference (call once at app start). */
export async function loadLang(): Promise<Lang> {
  try {
    const { supabase } = await import("./supabase");
    const { data: { user } } = await supabase.auth.getUser();
    const stored = user?.user_metadata?.preferred_lang;
    if (stored === "en" || stored === "am") {
      _currentLang = stored;
    }
  } catch { /* default to en */ }
  return _currentLang;
}

// ─── Translation dictionary ───────────────────────────────────────────────

const translations: Record<string, Record<Lang, string>> = {
  // ── Common ──
  app_name: { en: "Erdataye", am: "እርዳታዬ" },
  loading: { en: "Loading…", am: "በመጫን ላይ…" },
  error: { en: "Error", am: "ስህተት" },
  success: { en: "Success", am: "ተሳክቷል" },
  cancel: { en: "Cancel", am: "ሰርዝ" },
  confirm: { en: "Confirm", am: "አረጋግጥ" },
  save: { en: "Save", am: "አስቀምጥ" },
  delete: { en: "Delete", am: "ሰርዝ" },
  back: { en: "Back", am: "ተመለስ" },
  next: { en: "Next", am: "ቀጣይ" },
  ok: { en: "OK", am: "እሺ" },
  yes: { en: "Yes", am: "አዎ" },
  no: { en: "No", am: "አይ" },
  retry: { en: "Retry", am: "ድገም" },
  close: { en: "Close", am: "ዝጋ" },

  // ── Auth ──
  login: { en: "Login", am: "ግባ" },
  register: { en: "Register", am: "ተመዝገብ" },
  logout: { en: "Logout", am: "ውጣ" },
  phone_number: { en: "Phone Number", am: "ስልክ ቁጥር" },
  password: { en: "Password", am: "የይለፍ ቃል" },
  full_name: { en: "Full Name", am: "ሙሉ ስም" },
  email: { en: "Email", am: "ኢሜይል" },
  already_have_account: { en: "Already have an account?", am: "መለያ አለዎት?" },
  no_account: { en: "Don't have an account?", am: "መለያ የለዎትም?" },
  login_subtitle: { en: "Sign in to your account", am: "ወደ መለያዎ ይግቡ" },
  register_subtitle: { en: "Create a new account", am: "አዲስ መለያ ይፍጠሩ" },
  role_patient: { en: "Patient", am: "ታካሚ" },
  role_driver: { en: "Ambulance Driver", am: "የአምቡላንስ ሹፌር" },
  staff_login: { en: "Staff Login", am: "የሰራተኛ መግቢያ" },

  // ── Patient Emergency ──
  request_ambulance: { en: "Request Ambulance", am: "አምቡላንስ ጥያቄ" },
  emergency_type: { en: "Emergency Type", am: "የአደጋ ዓይነት" },
  describe_emergency: { en: "Describe your emergency", am: "ሁኔታዎን ይግለጹ" },
  severity: { en: "Severity", am: "ክብደት" },
  severity_low: { en: "Low", am: "ዝቅተኛ" },
  severity_medium: { en: "Medium", am: "መካከለኛ" },
  severity_high: { en: "High", am: "ከፍተኛ" },
  severity_critical: { en: "Critical", am: "አሳሳቢ" },
  ambulance_on_the_way: { en: "Ambulance is on the way!", am: "አምቡላንስ በመንገድ ላይ ነው!" },
  cancel_emergency: { en: "Cancel Emergency", am: "አደጋ ሰርዝ" },
  waiting_for_ambulance: { en: "Waiting for ambulance…", am: "አምቡላንስ በመጠበቅ ላይ…" },
  eta_minutes: { en: "ETA: {0} min", am: "ግምት: {0} ደቂቃ" },
  no_ambulance_available: { en: "No ambulance available nearby", am: "በአቅራቢያ አምቡላንስ የለም" },
  emergency_created: { en: "Emergency request sent", am: "የአደጋ ጥያቄ ተልኳል" },
  emergency_completed: { en: "Emergency completed", am: "አደጋ ተጠናቋል" },

  // ── Driver ──
  go_online: { en: "Go Online", am: "መስመር ላይ ግባ" },
  go_offline: { en: "Go Offline", am: "መስመር ውጣ" },
  accept: { en: "Accept", am: "ተቀበል" },
  decline: { en: "Decline", am: "አትቀበል" },
  new_assignment: { en: "New Emergency Assignment", am: "አዲስ የአደጋ ስራ" },
  en_route: { en: "En Route", am: "በመንገድ ላይ" },
  at_scene: { en: "At Scene", am: "ስፍራ ደርሷል" },
  transporting: { en: "Transporting", am: "በማጓጓዝ ላይ" },
  at_hospital: { en: "At Hospital", am: "ሆስፒታል ደርሷል" },
  completed: { en: "Completed", am: "ተጠናቋል" },
  vehicle_number: { en: "Vehicle Number", am: "የተሽከርካሪ ቁጥር" },
  your_hospital: { en: "Your Hospital", am: "ሆስፒታልዎ" },
  active_emergencies: { en: "Active Emergencies", am: "በሂደት ላይ ያሉ አደጋዎች" },
  completed_emergencies: { en: "Completed Emergencies", am: "የተጠናቀቁ አደጋዎች" },
  no_active_assignment: { en: "No active assignment", am: "ምንም የተመደበ ስራ የለም" },

  // ── Hospital ──
  hospital_dashboard: { en: "Hospital Dashboard", am: "የሆስፒታል ዳሽቦርድ" },
  fleet_overview: { en: "Fleet Overview", am: "የአምቡላንስ ማጠቃለያ" },
  pending_emergencies: { en: "Pending Emergencies", am: "በመጠበቅ ላይ ያሉ" },
  add_note: { en: "Add Note", am: "ማስታወሻ ጨምር" },
  clinical_notes: { en: "Clinical Notes", am: "የህክምና ማስታወሻ" },
  treatment: { en: "Treatment", am: "ህክምና" },
  diagnosis: { en: "Diagnosis", am: "ምርመራ" },
  vitals: { en: "Vitals", am: "አካላዊ ምልክቶች" },

  // ── Profile ──
  my_profile: { en: "My Profile", am: "የእኔ መገለጫ" },
  medical_info: { en: "Medical Information", am: "የጤና መረጃ" },
  blood_type: { en: "Blood Type", am: "የደም ዓይነት" },
  allergies: { en: "Allergies", am: "አለርጂዎች" },
  medications: { en: "Current Medications", am: "የአሁን መድሃኒቶች" },
  emergency_contact: { en: "Emergency Contact", am: "የአደጋ ጊዜ ግንኙነት" },

  // ── First Aid ──
  first_aid: { en: "First Aid", am: "የመጀመሪያ እርዳታ" },
  first_aid_assistant: { en: "First Aid Assistant", am: "የመጀመሪያ እርዳታ ረዳት" },

  // ── Help ──
  help: { en: "Help", am: "እገዛ" },
  how_to_use: { en: "How to use", am: "እንዴት እንደሚጠቀሙ" },

  // ── Admin ──
  admin_panel: { en: "Admin Panel", am: "የአስተዳዳሪ ፓነል" },
  total_emergencies: { en: "Total Emergencies", am: "ጠቅላላ አደጋዎች" },
  total_ambulances: { en: "Total Ambulances", am: "ጠቅላላ አምቡላንሶች" },
  total_hospitals: { en: "Total Hospitals", am: "ጠቅላላ ሆስፒታሎች" },

  // ── Notifications ──
  notification_new_emergency: { en: "New Emergency!", am: "አዲስ አደጋ!" },
  notification_assigned: { en: "You have been assigned", am: "ተመድበዋል" },
};

/**
 * Translate a key. Supports simple `{0}` placeholder substitution.
 *
 * @example t('eta_minutes', '5') → "ETA: 5 min" / "ግምት: 5 ደቂቃ"
 */
export function t(key: string, ...args: (string | number)[]): string {
  const entry = translations[key];
  if (!entry) return key;
  let text = entry[_currentLang] ?? entry.en ?? key;
  args.forEach((arg, idx) => {
    text = text.replace(`{${idx}}`, String(arg));
  });
  return text;
}
