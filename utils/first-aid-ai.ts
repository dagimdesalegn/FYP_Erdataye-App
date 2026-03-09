import type { BotMessage, Message } from "./first-aid-chatbot";
import { type Lang, SYSTEM_PROMPTS } from "./i18n-first-aid";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GEMINI_MODEL = "gemini-2.0-flash";

const HEALTH_SCOPE_KEYWORDS = [
  "first aid",
  "medical",
  "health",
  "emergency",
  "injury",
  "pain",
  "bleed",
  "burn",
  "fracture",
  "stroke",
  "seizure",
  "poison",
  "allergy",
  "choking",
  "cpr",
  "heart",
  "breath",
  "shock",
  "wound",
  "fever",
  "vomit",
  "diarrhea",
  "unconscious",
  "ሕክምና",
  "ጤና",
  "ድንገተኛ",
  "እርዳታ",
  "ደም",
  "ቃጠሎ",
  "ስብራት",
  "ስትሮክ",
  "fayyaa",
  "gargaarsa",
  "hatattama",
  "dhiiguu",
  "gubachuu",
  "istirookii",
  "ukkaamfamuu",
];

const HEALTH_ONLY_TEXT: Record<Lang, string> = {
  en: "I can only answer health and first aid questions.",
  am: "እኔ መመለስ የምችለው ስለ ጤና እና ስለ መጀመሪያ እርዳታ ጥያቄዎች ብቻ ነው።",
  om: "Ani gaaffii fayyaa fi gargaarsa jalqabaa qofa deebisa.",
};

const isHealthRelatedQuery = (input: string): boolean => {
  const lower = input.toLowerCase().trim();
  return HEALTH_SCOPE_KEYWORDS.some((kw) => lower.includes(kw));
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getApiKey = (): string =>
  (process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? "").trim();

export const isFirstAidAiConfigured = (): boolean => Boolean(getApiKey());

const toChatRole = (role: Message["role"]): "assistant" | "user" =>
  role === "bot" ? "assistant" : "user";

export const getFirstAidAiResponse = async (
  userInput: string,
  history: Message[],
  lang: Lang = "en",
): Promise<BotMessage | null> => {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  if (!isHealthRelatedQuery(userInput)) {
    return {
      role: "bot",
      text: HEALTH_ONLY_TEXT[lang],
    };
  }

  const contextMessages = history.slice(-8).map((msg) => ({
    role: toChatRole(msg.role),
    content: msg.text,
  }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const startedAt = Date.now();

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        temperature: 0.3,
        max_tokens: 350,
        messages: [
          { role: "system", content: SYSTEM_PROMPTS[lang].trim() },
          ...contextMessages,
          { role: "user", content: userInput },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn(`Gemini error ${response.status}: ${errText}`);
      return null;
    }

    const data: any = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const replyText = typeof content === "string" ? content.trim() : "";

    if (!replyText) return null;

    const elapsed = Date.now() - startedAt;
    if (elapsed < 300) {
      await sleep(300 - elapsed);
    }

    return {
      role: "bot",
      text: replyText,
    };
  } catch (error) {
    console.warn("Gemini request failed:", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
