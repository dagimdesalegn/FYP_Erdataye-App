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

import AsyncStorage from "@react-native-async-storage/async-storage";

export type Lang = "en" | "am" | "om";

const _STORAGE_KEY = "erdataye_lang";
let _currentLang: Lang = "en";
const _listeners = new Set<() => void>();

export const LANG_OPTIONS: ReadonlyArray<Lang> = ["en", "am", "om"];

const _notifyLangChanged = () => {
  _listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // No-op: keep broadcasting to other listeners.
    }
  });
};

export function subscribeLangChange(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/** Set the active language and persist. */
export async function setLang(lang: Lang): Promise<void> {
  if (_currentLang === lang) return;
  _currentLang = lang;

  try {
    await AsyncStorage.setItem(_STORAGE_KEY, lang);
  } catch {
    /* best-effort local persist */
  }

  _notifyLangChanged();

  try {
    const { supabase } = await import("./supabase");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.auth.updateUser({ data: { preferred_lang: lang } });
    }
  } catch {
    /* best-effort persist */
  }
}

/** Get current language synchronously. */
export function getLang(): Lang {
  return _currentLang;
}

/** Load persisted language preference (call once at app start). */
export async function loadLang(): Promise<Lang> {
  let nextLang: Lang | null = null;

  try {
    const storedLocal = await AsyncStorage.getItem(_STORAGE_KEY);
    if (storedLocal === "en" || storedLocal === "am" || storedLocal === "om") {
      nextLang = storedLocal;
    }
  } catch {
    /* default to profile or fallback en */
  }

  try {
    const { supabase } = await import("./supabase");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const stored = user?.user_metadata?.preferred_lang;
    if (stored === "en" || stored === "am" || stored === "om") {
      nextLang = stored;
    }
  } catch {
    /* ignore and keep local/default */
  }

  if (nextLang && nextLang !== _currentLang) {
    _currentLang = nextLang;
    _notifyLangChanged();

    try {
      await AsyncStorage.setItem(_STORAGE_KEY, nextLang);
    } catch {
      /* best-effort local persist */
    }
  }

  return _currentLang;
}

// ─── Translation dictionary ───────────────────────────────────────────────

const translations: Record<string, Record<Lang, string>> = {
  // ── Common ──
  app_name: { en: "Erdataye", am: "እርዳታዬ", om: "Gargaarsa Koo" },
  loading: { en: "Loading…", am: "በመጫን ላይ…", om: "Fe'aa jira…" },
  error: { en: "Error", am: "ስህተት", om: "Dogoggora" },
  success: { en: "Success", am: "ተሳክቷል", om: "Milkaa'eera" },
  cancel: { en: "Cancel", am: "ሰርዝ", om: "Haqi" },
  confirm: { en: "Confirm", am: "አረጋግጥ", om: "Mirkaneessi" },
  save: { en: "Save", am: "አስቀምጥ", om: "Kuusi" },
  delete: { en: "Delete", am: "ሰርዝ", om: "Haqi" },
  back: { en: "Back", am: "ተመለስ", om: "Deebi'i" },
  next: { en: "Next", am: "ቀጣይ", om: "Itti Aanu" },
  ok: { en: "OK", am: "እሺ", om: "Tole" },
  yes: { en: "Yes", am: "አዎ", om: "Eeyyee" },
  no: { en: "No", am: "አይ", om: "Lakki" },
  retry: { en: "Retry", am: "ድገም", om: "Irra Deebi'i" },
  close: { en: "Close", am: "ዝጋ", om: "Cufi" },
  language: { en: "Language", am: "ቋንቋ", om: "Afaan" },
  lang_en: { en: "English", am: "English", om: "English" },
  lang_am: { en: "Amharic", am: "አማርኛ", om: "Amaariffa" },
  lang_om: { en: "Oromo", am: "ኦሮምኛ", om: "Afaan Oromo" },
  internet_required_title: {
    en: "No Internet Connection",
    am: "የኢንተርኔት ግንኙነት የለም",
    om: "Walitti hidhamiinsi interneetii hin jiru",
  },
  internet_required_message: {
    en: "Please turn on mobile data or Wi-Fi and try again.",
    am: "እባክዎ ሞባይል ዳታ ወይም Wi-Fi ያብሩ እና እንደገና ይሞክሩ።",
    om: "Maaloo daataa moobaayilii yookaan Wi-Fi bansiitii irra deebi'ii yaali.",
  },
  update_available_title: {
    en: "Update Available",
    am: "አዲስ ስሪት አለ",
    om: "Fooyya'iinsi haaraan jira",
  },
  update_required_title: {
    en: "Update Required",
    am: "ማዘመን አስፈላጊ ነው",
    om: "Fooyyeessuun dirqama",
  },
  update_available_message: {
    en: "A newer app version ({0}) is available. You are using {1}. Update now for the latest fixes and features.",
    am: "አዲስ የመተግበሪያ ስሪት ({0}) አለ። እርስዎ {1} እየተጠቀሙ ነው። አዳዲስ ማሻሻያዎችን ለማግኘት አሁን ያዘምኑ።",
    om: "Vershinii appii haaraan ({0}) jira. Ati {1} fayyadamaa jirta. Sirreeffamoota fi fooyya'iinsa haaraa argachuuf amma fooyyessi.",
  },
  update_open_failed_title: {
    en: "Update Link Error",
    am: "የማዘመኛ ሊንክ ስህተት",
    om: "Dogoggora liinkii fooyya'iinsaa",
  },
  update_open_failed_message: {
    en: "Could not open the update link. Please visit erdatayee.tech/downloads/erdataye.apk",
    am: "የማዘመኛ ሊንኩን መክፈት አልተቻለም። እባክዎ erdatayee.tech/downloads/erdataye.apk ይጎብኙ",
    om: "Liinkii fooyya'iinsaa banuu hin dandeenye. Maaloo erdatayee.tech/downloads/erdataye.apk daawwadhaa",
  },
  update_now: {
    en: "Update Now",
    am: "አሁን ያዘምኑ",
    om: "Amma Fooyyessi",
  },
  later: {
    en: "Later",
    am: "በኋላ",
    om: "Booda",
  },
  // Driver / patient home
  welcome: { en: "Welcome", am: "እንኳን ደህና መጡ", om: "Baga nagaan dhuftan" },
  ambulance_status: {
    en: "Ambulance Status",
    am: "የአምቡላንስ ሁኔታ",
    om: "Haala Ambulaansii",
  },
  available: { en: "Available", am: "ዝግጁ", om: "Qophaa'e" },
  offline: { en: "Offline", am: "ከመስመር ውጪ", om: "Alaa Sarara" },
  ready_to_receive_calls: {
    en: "Ready to receive calls",
    am: "ጥሪዎችን ለመቀበል ዝግጁ",
    om: "Waamicha fudhachuuf qophaa'e",
  },
  not_receiving_calls: {
    en: "Not receiving calls",
    am: "ጥሪ አይቀበልም",
    om: "Waamicha hin fudhatu",
  },
  view_assignment: { en: "View Assignment", am: "ምደባ ይመልከቱ", om: "Ramaddii Ilaali" },
  active: { en: "Active", am: "በሂደት ላይ", om: "Hojii Irra" },
  total: { en: "Total", am: "ጠቅላላ", om: "Waliigala" },
  completed_history: {
    en: "Completed History",
    am: "የተጠናቀቀ ታሪክ",
    om: "Seenaa Xumurame",
  },
  no_completed_emergencies_yet: {
    en: "No completed emergencies yet",
    am: "እስካሁን የተጠናቀቀ አደጋ የለም",
    om: "Ammaaf balaan xumurame hin jiru",
  },
  sign_out: { en: "Sign Out", am: "ውጣ", om: "Ba'i" },
  help_short: { en: "Help", am: "እገዛ", om: "Gargaarsa" },
  direct_short: { en: "Direct", am: "ቀጥታ", om: "Kallattiin" },
  ask_chatbot: { en: "Ask Chatbot", am: "ቻትቦትን ይጠይቁ", om: "Chaatiin Gaafadhu" },
  current_device_location: {
    en: "Current location of your device",
    am: "የመሣሪያዎ የአሁን አካባቢ",
    om: "Bakka ammaa meeshaa keessanii",
  },
  choose_help_type: { en: "Choose help type", am: "የእርዳታ አይነት ይምረጡ", om: "Gosa gargaarsaa fili" },
  for_me: { en: "For me", am: "ለእኔ", om: "Naaf" },
  for_other: { en: "For other", am: "ለሌላ", om: "Nama biraaf" },
  emergency_contacts: {
    en: "Emergency Contacts",
    am: "የአደጋ ግንኙነቶች",
    om: "Namoota Balaa Yeroo Waamamu",
  },
  ethiopian_emergency_services: {
    en: "Ethiopian Emergency Services",
    am: "የኢትዮጵያ የአደጋ አገልግሎቶች",
    om: "Tajaajiloota Balaa Itiyoophiyaa",
  },
  family_personal: { en: "Family / Personal", am: "ቤተሰብ / የግል", om: "Maatii / Dhuunfaa" },
  emergency_ambulance: {
    en: "Emergency (Ambulance)",
    am: "አደጋ (አምቡላንስ)",
    om: "Balaa (Ambulaansii)",
  },
  fire_emergency: { en: "Fire & Emergency", am: "እሳት እና አደጋ", om: "Ibidda fi Balaa" },
  police: { en: "Police", am: "ፖሊስ", om: "Poolisii" },
  emergency_contact_label: {
    en: "Emergency Contact",
    am: "የአደጋ ግንኙነት",
    om: "Nama Balaa Yeroo Waamamu",
  },
  from_your_profile: {
    en: "From your profile",
    am: "ከመገለጫዎ",
    om: "Piroofaayila kee irraa",
  },

  // ── Auth ──
  login: { en: "Login", am: "ግባ", om: "Seeni" },
  register: { en: "Register", am: "ተመዝገብ", om: "Galmaa'i" },
  logout: { en: "Logout", am: "ውጣ", om: "Ba'i" },
  phone_number: { en: "Phone Number", am: "ስልክ ቁጥር", om: "Lakkoofsa Bilbilaa" },
  password: { en: "Password", am: "የይለፍ ቃል", om: "Jecha Iccitii" },
  full_name: { en: "Full Name", am: "ሙሉ ስም", om: "Maqaa Guutuu" },
  email: { en: "Email", am: "ኢሜይል", om: "Imeelii" },
  already_have_account: {
    en: "Already have an account?",
    am: "መለያ አለዎት?",
    om: "Akkaawuntii qabdaa?",
  },
  no_account: {
    en: "Don't have an account?",
    am: "መለያ የለዎትም?",
    om: "Akkaawuntii hin qabduu?",
  },
  i_am_a: { en: "I am a:", am: "እኔ:", om: "Ani:" },
  login_subtitle: {
    en: "Sign in to your account",
    am: "ወደ መለያዎ ይግቡ",
    om: "Gara akkaawuntii keetti seeni",
  },
  register_subtitle: {
    en: "Create a new account",
    am: "አዲስ መለያ ይፍጠሩ",
    om: "Akkaawuntii haaraa uumi",
  },
  role_patient: { en: "Patient", am: "ታካሚ", om: "Dhukkubsataa" },
  role_driver: {
    en: "Ambulance Driver",
    am: "የአምቡላንስ ሹፌር",
    om: "Konkolaachisaa Ambulaansii",
  },
  staff_login: {
    en: "Staff Login",
    am: "የሰራተኛ መግቢያ",
    om: "Seensa Hojjettootaa",
  },

  // ── Patient Emergency ──
  request_ambulance: {
    en: "Request Ambulance",
    am: "አምቡላንስ ጥያቄ",
    om: "Ambulaansii Gaafadhu",
  },
  emergency_type: { en: "Emergency Type", am: "የአደጋ ዓይነት", om: "Gosa Balaa" },
  describe_emergency: {
    en: "Describe your emergency",
    am: "ሁኔታዎን ይግለጹ",
    om: "Balaa kee ibsi",
  },
  severity: { en: "Severity", am: "ክብደት", om: "Hammaataa" },
  severity_low: { en: "Low", am: "ዝቅተኛ", om: "Xiqqaa" },
  severity_medium: { en: "Medium", am: "መካከለኛ", om: "Giddugaleessa" },
  severity_high: { en: "High", am: "ከፍተኛ", om: "Olaanaa" },
  severity_critical: { en: "Critical", am: "አሳሳቢ", om: "Baayyee Hamaa" },
  ambulance_on_the_way: {
    en: "Ambulance is on the way!",
    am: "አምቡላንስ በመንገድ ላይ ነው!",
    om: "Ambulaansiin karaa irra jirti!",
  },
  cancel_emergency: { en: "Cancel Emergency", am: "አደጋ ሰርዝ", om: "Balaa Haqi" },
  waiting_for_ambulance: {
    en: "Waiting for ambulance…",
    am: "አምቡላንስ በመጠበቅ ላይ…",
    om: "Ambulaansii eeggachaa jira…",
  },
  eta_minutes: {
    en: "ETA: {0} min",
    am: "ግምት: {0} ደቂቃ",
    om: "Yeroo dhaqabaa: daqiiqaa {0}",
  },
  no_ambulance_available: {
    en: "No ambulance available nearby",
    am: "በአቅራቢያ አምቡላንስ የለም",
    om: "Naannoo keessatti ambulaansiin hin jiru",
  },
  emergency_created: {
    en: "Emergency request sent",
    am: "የአደጋ ጥያቄ ተልኳል",
    om: "Gaaffiin balaa ergameera",
  },
  emergency_completed: {
    en: "Emergency completed",
    am: "አደጋ ተጠናቋል",
    om: "Balaan xumurameera",
  },

  // ── Driver ──
  go_online: { en: "Go Online", am: "መስመር ላይ ግባ", om: "Onlaayinii Ta'i" },
  go_offline: { en: "Go Offline", am: "መስመር ውጣ", om: "Offlaayinii Ta'i" },
  accept: { en: "Accept", am: "ተቀበል", om: "Fudhadhu" },
  decline: { en: "Decline", am: "አትቀበል", om: "Didi" },
  new_assignment: {
    en: "New Emergency Assignment",
    am: "አዲስ የአደጋ ስራ",
    om: "Ramaddii Balaa Haaraa",
  },
  en_route: { en: "En Route", am: "በመንገድ ላይ", om: "Karaa Irra" },
  at_scene: { en: "At Scene", am: "ስፍራ ደርሷል", om: "Iddoo Irra Jira" },
  transporting: { en: "Transporting", am: "በማጓጓዝ ላይ", om: "Geejjibaa Jira" },
  at_hospital: { en: "At Hospital", am: "ሆስፒታል ደርሷል", om: "Hospitaala Jira" },
  completed: { en: "Completed", am: "ተጠናቋል", om: "Xumurame" },
  vehicle_number: {
    en: "Vehicle Number",
    am: "የተሽከርካሪ ቁጥር",
    om: "Lakkoofsa Konkolaataa",
  },
  your_hospital: { en: "Your Hospital", am: "ሆስፒታልዎ", om: "Hospitaala Kee" },
  active_emergencies: {
    en: "Active Emergencies",
    am: "በሂደት ላይ ያሉ አደጋዎች",
    om: "Balaa Itti Fufaa",
  },
  completed_emergencies: {
    en: "Completed Emergencies",
    am: "የተጠናቀቁ አደጋዎች",
    om: "Balaa Xumuraman",
  },
  no_active_assignment: {
    en: "No active assignment",
    am: "ምንም የተመደበ ስራ የለም",
    om: "Ramaddiin hojii hin jiru",
  },

  // ── Hospital ──
  hospital_dashboard: {
    en: "Hospital Dashboard",
    am: "የሆስፒታል ዳሽቦርድ",
    om: "Daashboordii Hospitaalaa",
  },
  fleet_overview: {
    en: "Fleet Overview",
    am: "የአምቡላንስ ማጠቃለያ",
    om: "Haala Waliigalaa Fleet",
  },
  pending_emergencies: {
    en: "Pending Emergencies",
    am: "በመጠበቅ ላይ ያሉ",
    om: "Balaa Eeggachaa Jiran",
  },
  add_note: { en: "Add Note", am: "ማስታወሻ ጨምር", om: "Yaadannoo DabalI" },
  clinical_notes: {
    en: "Clinical Notes",
    am: "የህክምና ማስታወሻ",
    om: "Yaadannoo Kiliinikii",
  },
  treatment: { en: "Treatment", am: "ህክምና", om: "Wal'aansa" },
  diagnosis: { en: "Diagnosis", am: "ምርመራ", om: "Qorannoo" },
  vitals: { en: "Vitals", am: "አካላዊ ምልክቶች", om: "Mallattoolee Jireenyaa" },

  // ── Profile ──
  my_profile: { en: "My Profile", am: "የእኔ መገለጫ", om: "Piroofaayilii Koo" },
  medical_info: {
    en: "Medical Information",
    am: "የጤና መረጃ",
    om: "Odeeffannoo Fayyaa",
  },
  blood_type: { en: "Blood Type", am: "የደም ዓይነት", om: "Gosa Dhiigaa" },
  allergies: { en: "Allergies", am: "አለርጂዎች", om: "Alerjii" },
  medications: {
    en: "Current Medications",
    am: "የአሁን መድሃኒቶች",
    om: "Qorichoota Amma Fudhattu",
  },
  emergency_contact: {
    en: "Emergency Contact",
    am: "የአደጋ ጊዜ ግንኙነት",
    om: "Nama Balaa Yeroo Waamamu",
  },

  // ── First Aid ──
  first_aid: { en: "First Aid", am: "የመጀመሪያ እርዳታ", om: "Gargaarsa Duraa" },
  first_aid_assistant: {
    en: "First Aid Assistant",
    am: "የመጀመሪያ እርዳታ ረዳት",
    om: "Gargaaraa Gargaarsa Duraa",
  },

  // ── Help ──
  help: { en: "Help", am: "እገዛ", om: "Gargaarsa" },
  how_to_use: {
    en: "How to use",
    am: "እንዴት እንደሚጠቀሙ",
    om: "Akkaataa Itti Fayyadamtan",
  },

  // ── Admin ──
  admin_panel: {
    en: "Admin Panel",
    am: "የአስተዳዳሪ ፓነል",
    om: "Paanaalii Bulchiinsaa",
  },
  total_emergencies: {
    en: "Total Emergencies",
    am: "ጠቅላላ አደጋዎች",
    om: "Waliigala Balaa",
  },
  total_ambulances: {
    en: "Total Ambulances",
    am: "ጠቅላላ አምቡላንሶች",
    om: "Waliigala Ambulaansii",
  },
  total_hospitals: {
    en: "Total Hospitals",
    am: "ጠቅላላ ሆስፒታሎች",
    om: "Waliigala Hospitaalaa",
  },

  // ── Notifications ──
  notification_new_emergency: {
    en: "New Emergency!",
    am: "አዲስ አደጋ!",
    om: "Balaan Haaraan Jira!",
  },
  notification_assigned: {
    en: "You have been assigned",
    am: "ተመድበዋል",
    om: "Ati ramadamteetta",
  },
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
