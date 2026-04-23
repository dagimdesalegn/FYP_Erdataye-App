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

const literalTranslations: Record<string, Record<Lang, string>> = {
  "Sign In": { en: "Sign In", am: "ግባ", om: "Seeni" },
  "Create Account": { en: "Create Account", am: "መለያ ፍጠር", om: "Akkaawuntii Uumi" },
  "Enter your credentials to continue": {
    en: "Enter your credentials to continue",
    am: "ለመቀጠል መረጃዎን ያስገቡ",
    om: "Itti fufuuf odeeffannoo kee galchi",
  },
  "Continue with Fayda": {
    en: "Continue with Fayda",
    am: "በፋይዳ ይቀጥሉ",
    om: "Fayda waliin itti fufi",
  },
  "Warning": { en: "Warning", am: "ማስጠንቀቂያ", om: "Akeekkachiisa" },
  "Registration Submitted": {
    en: "Registration Submitted",
    am: "ምዝገባ ተልኳል",
    om: "Galmeen ergameera",
  },
  "Your ambulance registration has been sent to the selected hospital for approval. You can sign in after approval.": {
    en: "Your ambulance registration has been sent to the selected hospital for approval. You can sign in after approval.",
    am: "የአምቡላንስ ምዝገባዎ ለምርጫው ሆስፒታል ለማጽደቅ ተልኳል። ከፀደቀ በኋላ መግባት ይችላሉ።",
    om: "Galmeen ambulaansii keessanii raggaasisuuf hospitaala filatametti ergameera. Erga ragga'ee booda seenuu dandeessu.",
  },
  "Staff Portal Required": {
    en: "Staff Portal Required",
    am: "የሰራተኛ ፖርታል ያስፈልጋል",
    om: "Poortaaliin Hojjettootaa barbaachisa",
  },
  "Admin and hospital accounts must log in through the Staff Portal at /staff.": {
    en: "Admin and hospital accounts must log in through the Staff Portal at /staff.",
    am: "የአድሚን እና የሆስፒታል መለያዎች በ /staff የሰራተኛ ፖርታል ብቻ መግባት አለባቸው።",
    om: "Akkaawuntiiwwan bulchaa fi hospitaalaa karaa poortaalii hojjettootaa /staff irraa qofa seenuu qabu.",
  },
  "Please enter your phone number": {
    en: "Please enter your phone number",
    am: "እባክዎ ስልክ ቁጥርዎን ያስገቡ",
    om: "Maaloo lakkoofsa bilbilaa keessan galchaa",
  },
  "Enter 9 digits starting with 9 (e.g. 912345678)": {
    en: "Enter 9 digits starting with 9 (e.g. 912345678)",
    am: "በ9 የሚጀምሩ 9 አሃዞች ያስገቡ (ለምሳሌ 912345678)",
    om: "Dijiitii 9 lakkoofsa 9 irraa jalqabamu galchi (fkn 912345678)",
  },
  "Please enter your password": {
    en: "Please enter your password",
    am: "እባክዎ የይለፍ ቃልዎን ያስገቡ",
    om: "Maaloo jecha iccitii keessan galchaa",
  },
  "Please enter your full name": {
    en: "Please enter your full name",
    am: "እባክዎ ሙሉ ስምዎን ያስገቡ",
    om: "Maaloo maqaa guutuu keessan galchaa",
  },
  "Enter first and last name (e.g. Abebe Kebede)": {
    en: "Enter first and last name (e.g. Abebe Kebede)",
    am: "ስም እና የአባት ስም ያስገቡ (ለምሳሌ አበበ ከበደ)",
    om: "Maqaa fi maqaa abbaa galchi (fkn Abebe Kebede)",
  },
  "FAN number must be exactly 16 digits": {
    en: "FAN number must be exactly 16 digits",
    am: "የFAN ቁጥር በትክክል 16 አሃዞች መሆን አለበት",
    om: "Lakkoofsi FAN sirriitti dijiitii 16 ta'uu qaba",
  },
  "Please enter a password": {
    en: "Please enter a password",
    am: "እባክዎ የይለፍ ቃል ያስገቡ",
    om: "Maaloo jecha iccitii galchaa",
  },
  "Password must be at least 6 characters": {
    en: "Password must be at least 6 characters",
    am: "የይለፍ ቃል ቢያንስ 6 ፊደላት መሆን አለበት",
    om: "Jechi iccitii yoo xiqqaate qubee 6 qabaachuu qaba",
  },
  "Please choose one of the available blood type options": {
    en: "Please choose one of the available blood type options",
    am: "እባክዎ ከሚገኙት የደም አይነቶች አንዱን ይምረጡ",
    om: "Maaloo filannoowwan gosa dhiigaa keessaa tokko fili",
  },
  "Please select a hospital": {
    en: "Please select a hospital",
    am: "እባክዎ ሆስፒታል ይምረጡ",
    om: "Maaloo hospitaala tokko fili",
  },
  "Please enter the plate number": {
    en: "Please enter the plate number",
    am: "እባክዎ የሰሌዳ ቁጥር ያስገቡ",
    om: "Maaloo lakkoofsa taargaa galchi",
  },
  "Please enter registration number": {
    en: "Please enter registration number",
    am: "እባክዎ የምዝገባ ቁጥር ያስገቡ",
    om: "Maaloo lakkoofsa galmee galchi",
  },
  "Login Failed": { en: "Login Failed", am: "መግቢያ አልተሳካም", om: "Seenaan hin milkoofne" },
  "Failed to sign in": { en: "Failed to sign in", am: "መግባት አልተሳካም", om: "Seenuun hin milkoofne" },
  "Login failed": { en: "Login failed", am: "መግቢያ አልተሳካም", om: "Seenaan hin milkoofne" },
  "Registration Failed": {
    en: "Registration Failed",
    am: "ምዝገባ አልተሳካም",
    om: "Galmeen hin milkoofne",
  },
  "Registration failed": { en: "Registration failed", am: "ምዝገባ አልተሳካም", om: "Galmeen hin milkoofne" },
  "Failed to create account": {
    en: "Failed to create account",
    am: "መለያ መፍጠር አልተሳካም",
    om: "Akkaawuntii uumuu hin milkoofne",
  },
  "Fayda Verified": { en: "Fayda Verified", am: "ፋይዳ ተረጋግጧል", om: "Faydaan mirkanaa'eera" },
  "Fayda Verification Failed": {
    en: "Fayda Verification Failed",
    am: "የፋይዳ ማረጋገጫ አልተሳካም",
    om: "Mirkaneessi Faydaa hin milkoofne",
  },
  "Fayda Sign-In Failed": {
    en: "Fayda Sign-In Failed",
    am: "በፋይዳ መግቢያ አልተሳካም",
    om: "Seensa Faydaa hin milkoofne",
  },
  "Access Denied": { en: "Access Denied", am: "መዳረሻ ተከልክሏል", om: "Seensii dhorkameera" },
  "This portal is only for admin and hospital accounts.": {
    en: "This portal is only for admin and hospital accounts.",
    am: "ይህ ፖርታል ለአድሚን እና ሆስፒታል መለያዎች ብቻ ነው።",
    om: "Poortaaliin kun akkaawuntiiwwan bulchaa fi hospitaalaa qofaaf dha.",
  },
  "Emergency Ambulance Service": {
    en: "Emergency Ambulance Service",
    am: "የአደጋ አምቡላንስ አገልግሎት",
    om: "Tajaajila Ambulaansii Balaa",
  },
  "Fetching your location...": {
    en: "Fetching your location...",
    am: "አካባቢዎን በመፈለግ ላይ...",
    om: "Bakka keessan barbaadaa jira...",
  },
  "Go to Settings": { en: "Go to Settings", am: "ወደ ቅንብሮች ይሂዱ", om: "Gara qindaa'inaatti deemi" },
  "Live update": { en: "Live update", am: "ቀጥታ ዝማኔ", om: "Fooyya'insa kallattii" },
  "Status Updated": { en: "Status Updated", am: "ሁኔታ ተዘምኗል", om: "Haalli fooyya'eera" },
  "Update Failed": { en: "Update Failed", am: "ማዘመን አልተሳካም", om: "Fooyyessuun hin milkoofne" },
  "Registration Approved": { en: "Registration Approved", am: "ምዝገባ ጸድቋል", om: "Galmeen ragga'eera" },
  "Registration Rejected": { en: "Registration Rejected", am: "ምዝገባ ተከልክሏል", om: "Galmeen didameera" },
  "Approval Update Failed": { en: "Approval Update Failed", am: "የማጽደቅ ማዘመን አልተሳካም", om: "Fooyya'iinsi raggaasii hin milkoofne" },
  "Loading hospital details...": {
    en: "Loading hospital details...",
    am: "የሆስፒታል ዝርዝሮችን በመጫን ላይ...",
    om: "Bal'ina hospitaalaa fe'aa jira...",
  },
  "No ambulances linked yet.": {
    en: "No ambulances linked yet.",
    am: "እስካሁን የተገናኙ አምቡላንሶች የሉም።",
    om: "Ammaaf ambulaansii walqabate hin jiru.",
  },
  "No active assignment": {
    en: "No active assignment",
    am: "ምንም በሂደት ላይ ያለ ምደባ የለም",
    om: "Ramaddiin hojii sochiirra jiru hin jiru",
  },
  "Emergency Tracking": {
    en: "Emergency Tracking",
    am: "የአደጋ ክትትል",
    om: "Hordoffii Balaa",
  },
  "Map": { en: "Map", am: "ካርታ", om: "Kaartaa" },
  "Update Status": { en: "Update Status", am: "ሁኔታ አዘምን", om: "Haala Fooyyessi" },
  "Medical Notes": { en: "Medical Notes", am: "የህክምና ማስታወሻዎች", om: "Yaadannoowwan Fayyaa" },
  "Navigate": { en: "Navigate", am: "አቅጣጫ", om: "Qajeelcha" },
  "Patient": { en: "Patient", am: "ታካሚ", om: "Dhukkubsataa" },
  "Phone": { en: "Phone", am: "ስልክ", om: "Bilbila" },
  "Call": { en: "Call", am: "ደውል", om: "Bilbili" },
  "Blood Type": { en: "Blood Type", am: "የደም አይነት", om: "Gosa Dhiigaa" },
  "Allergies": { en: "Allergies", am: "አለርጂዎች", om: "Alerjii" },
  "Emergency Contact": { en: "Emergency Contact", am: "የአደጋ ግንኙነት", om: "Nama Balaa Yeroo Waamamu" },
  "Hospital Dashboard": {
    en: "Hospital Dashboard",
    am: "የሆስፒታል ዳሽቦርድ",
    om: "Daashboordii Hospitaalaa",
  },
  "Admin Dashboard": {
    en: "Admin Dashboard",
    am: "የአስተዳዳሪ ዳሽቦርድ",
    om: "Daashboordii Bulchiinsaa",
  },
  "Total": { en: "Total", am: "ጠቅላላ", om: "Waliigala" },
  "Pending": { en: "Pending", am: "በመጠበቅ ላይ", om: "Eeggachaa" },
  "Completed": { en: "Completed", am: "ተጠናቋል", om: "Xumurame" },
  "Available": { en: "Available", am: "ዝግጁ", om: "Qophaa'e" },
  "Busy": { en: "Busy", am: "ተጠምዷል", om: "Hojii irra" },
  "Open in Google Maps": {
    en: "Open in Google Maps",
    am: "በGoogle Maps ይክፈቱ",
    om: "Google Maps keessatti bani",
  },
  "Live Map": { en: "Live Map", am: "ቀጥታ ካርታ", om: "Kaartaa Kallattii" },
  "Hospital": { en: "Hospital", am: "ሆስፒታል", om: "Hospitaala" },
  "CALL\nAMBULANCE": {
    en: "CALL\nAMBULANCE",
    am: "አምቡላንስ\nይደውሉ",
    om: "AMBULAANSII\nBILBILAA",
  },
};

const englishToKeyIndex: Map<string, string> = new Map(
  Object.entries(translations)
    .filter(([, value]) => Boolean(value?.en))
    .map(([key, value]) => [value.en, key]),
);

export function translateText(value: string): string {
  if (_currentLang === "en") return value;
  const keyFromEnglish = englishToKeyIndex.get(value);
  if (keyFromEnglish) {
    const translated = t(keyFromEnglish);
    return translated === keyFromEnglish ? value : translated;
  }
  const literal = literalTranslations[value];
  if (!literal) return value;
  return literal[_currentLang] ?? literal.en ?? value;
}
