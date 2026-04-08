/**
 * Multilingual support for the First Aid Chatbot.
 * Supports: English (en), Amharic (am), Afaan Oromo (om).
 */

export type Lang = "en" | "am" | "om";

export const LANG_LABELS: Record<Lang, string> = {
  en: "EN",
  am: "አማ",
  om: "OM",
};

export const LANG_NAMES: Record<Lang, string> = {
  en: "English",
  am: "አማርኛ",
  om: "Afaan Oromoo",
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
    headerTitle: "First Aid",
    headerStatus: "WHO · Always ready",
    inputPlaceholder: "Describe your emergency…",
    welcomeMessage: "How can I help you today? Type your question below.",
    typingIndicator: "···",
  },
  am: {
    headerTitle: "የመጀመሪያ እርዳታ",
    headerStatus: "WHO · ሁልጊዜ ዝግጁ",
    inputPlaceholder: "ሁኔታዎን ይግለጹ…",
    welcomeMessage: "ዛሬ እንዴት ልርዳዎ? ጥያቄዎን ከታች ይጻፉ።",
    typingIndicator: "···",
  },
  om: {
    headerTitle: "Gargaarsa Jalqabaa",
    headerStatus: "WHO · Yeroo hunda qophii",
    inputPlaceholder: "Haala keessan ibsaa…",
    welcomeMessage:
      "Har'a akkamiin isin gargaaruu danda'a? Gaaffii keessan armaan gaditti barreessaa.",
    typingIndicator: "···",
  },
};

// NOTE: System prompts live server-side in backend/routers/chat.py (SYSTEM_PROMPT).
// They are NOT duplicated here. The backend is the single source of truth.

// ─────────────────────────────────────────────────────────────────────────────
// Follow-up suggestions per language (used when AI omits FOLLOW_UPS block)
// ─────────────────────────────────────────────────────────────────────────────
export const MIN_REPLY_FOLLOWUPS: Record<Lang, string[]> = {
  en: [
    "Any danger signs to watch now?",
    "When should I call an ambulance?",
    "What is the next first aid step?",
  ],
  am: [
    "አሁን ሊታዩ የሚገባቸው የአደጋ ምልክቶች?",
    "አምቡላንስ መቼ መደወል አለብኝ?",
    "ቀጣዩ የመጀመሪያ ​​እርዳታ ደረጃ ምንድነው?",
  ],
  om: [
    "Mallattoo balaa amma eeguu qaban?",
    "Yoom ambulaansii bilbiluu qaba?",
    "Tarkaanfiin gargaarsa jalqabaa itti aanu maali?",
  ],
};
