/**
 * Multilingual support for the First Aid Chatbot.
 * Supports: English (en), Amharic (am), Afaan Oromo (om).
 */

export type Lang = 'en' | 'am' | 'om';

export const LANG_LABELS: Record<Lang, string> = {
  en: 'EN',
  am: 'አማ',
  om: 'OM',
};

export const LANG_NAMES: Record<Lang, string> = {
  en: 'English',
  am: 'አማርኛ',
  om: 'Afaan Oromoo',
};

// ─────────────────────────────────────────────────────────────────────────────
// UI strings used in the FAB chat widget
// ─────────────────────────────────────────────────────────────────────────────
interface UiStrings {
  headerTitle: string;
  headerStatus: string;
  inputPlaceholder: string;
  welcomeMessage: string;
  typingIndicator: string;
}

export const UI: Record<Lang, UiStrings> = {
  en: {
    headerTitle: 'First Aid',
    headerStatus: 'WHO · Always ready',
    inputPlaceholder: 'Ask about first aid…',
    welcomeMessage:
      "Hi! I'm your **First Aid Assistant** powered by WHO guidelines.\n\nAsk me anything — CPR, bleeding, stroke, burns, poisoning and more.",
    typingIndicator: '···',
  },
  am: {
    headerTitle: 'የመጀመሪያ እርዳታ',
    headerStatus: 'WHO · ሁልጊዜ ዝግጁ',
    inputPlaceholder: 'ስለ መጀመሪያ እርዳታ ይጠይቁ…',
    welcomeMessage:
      'ሰላም! እኔ በWHO መመሪያዎች ላይ የተመሰረተ **የመጀመሪያ እርዳታ ረዳት** ነኝ።\n\nማንኛውንም ነገር ይጠይቁኝ — CPR፣ ደም መፍሰስ፣ ስትሮክ፣ ቃጠሎ፣ መመረዝ እና ሌሎችም።',
    typingIndicator: '···',
  },
  om: {
    headerTitle: 'Gargaarsa Jalqabaa',
    headerStatus: 'WHO · Yeroo hunda qophii',
    inputPlaceholder: 'Waa\'ee gargaarsa jalqabaa gaafadhu…',
    welcomeMessage:
      'Akkam! Ani **Gargaaraa Gargaarsa Jalqabaa** qajeelfama WHO irratti hundaa\'e dha.\n\nWaan barbaaddan na gaafadhaa — CPR, dhiiguu, istirookii, gubachuu, summaa\'uu fi kanneen biroo.',
    typingIndicator: '···',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// System prompts for OpenRouter AI — one per language
// ─────────────────────────────────────────────────────────────────────────────
export const SYSTEM_PROMPTS: Record<Lang, string> = {
  en: `You are Erdataya First Aid Assistant.

Rules:
1) Provide practical, immediate first-aid steps for bystanders and injured people.
2) If symptoms are severe, life-threatening, or unclear, tell user to call emergency services immediately.
3) Keep responses concise, numbered, and action-focused.
4) Do not provide diagnosis certainty or unsafe instructions.
5) Mention this is not a substitute for professional medical care.
6) Respond in English.`,

  am: `አንተ የ Erdataya የመጀመሪያ እርዳታ ረዳት ነህ።

ህጎች:
1) ለተመልካቾች እና ለተጎዱ ሰዎች ተግባራዊ፣ ፈጣን የመጀመሪያ እርዳታ እርምጃዎችን ስጥ።
2) ምልክቶቹ ከባድ፣ ሕይወትን አደጋ ላይ የሚጥሉ፣ ወይም ግልጽ ያልሆኑ ከሆነ ተጠቃሚው ወዲያውኑ የአደጋ ጊዜ አገልግሎቶችን እንዲደውል ንገረው።
3) ምላሾችን አጭር፣ በቁጥር፣ እና በተግባር ያተኮሩ አድርግ።
4) የምርመራ እርግጠኝነት ወይም ደህንነታቸው ያልተጠበቀ መመሪያዎችን አትስጥ።
5) ይህ ለባለሙያ ሕክምና ምትክ እንዳልሆነ ጥቀስ።
6) በአማርኛ መልስ ስጥ። ሁሉም ምላሾችህ በአማርኛ ብቻ መሆን አለባቸው።`,

  om: `Ati Gargaaraa Gargaarsa Jalqabaa Erdataya dha.

Seerota:
1) Namoota daawwataniif fi namoota miidhaman tarkaanfii gargaarsa jalqabaa qabatamaa fi hatattamaa kenni.
2) Mallattooleen cimaa, lubbuu balaa irra buusan, ykn ifa hin taane yoo ta'an, fayyadamaan tajaajila balaa hatattamaa akka bilbilu itti himi.
3) Deebii gabaabaa, lakkoofsan, fi tarkaanfii irratti xiyyeeffate kenni.
4) Mirkanaa'ina qorannoo yookiin qajeelfama nageenya hin qabnee hin kenniin.
5) Kun bakka bu'aa yaala ogeeyyii fayyaa akka hin taane ibsi.
6) Afaan Oromootiin deebisi. Deebiin kee hundi Afaan Oromoo qofaan ta'uu qaba.`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Follow-up suggestions per language (used by AI fallback)
// ─────────────────────────────────────────────────────────────────────────────
export const MIN_REPLY_FOLLOWUPS: Record<Lang, string[]> = {
  en: [
    'Any danger signs to watch now?',
    'When should I call an ambulance?',
    'What is the next first aid step?',
  ],
  am: [
    'አሁን ሊታዩ የሚገባቸው የአደጋ ምልክቶች?',
    'አምቡላንስ መቼ መደወል አለብኝ?',
    'ቀጣዩ የመጀመሪያ ​​እርዳታ ደረጃ ምንድነው?',
  ],
  om: [
    'Mallattoo balaa amma eeguu qaban?',
    'Yoom ambulaansii bilbiluu qaba?',
    'Tarkaanfiin gargaarsa jalqabaa itti aanu maali?',
  ],
};
