import type { BotMessage, Message } from "./first-aid-chatbot";
import { type Lang, SYSTEM_PROMPTS } from "./i18n-first-aid";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GEMINI_MODEL = "gemini-2.0-flash";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_DEFAULT_MODEL = "liquid/lfm-2.5-1.2b-instruct:free";
const OPENROUTER_FALLBACK_MODELS = [
  OPENROUTER_DEFAULT_MODEL,
  "arcee-ai/trinity-mini:free",
  "nvidia/nemotron-nano-9b-v2:free",
];

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

const ASSISTANT_META_TEXT: Record<Lang, string> = {
  en: "I am your WHO-based First Aid Assistant. I provide step-by-step first aid guidance for health emergencies.",
  am: "እኔ በWHO መመሪያ ላይ የተመሰረተ የመጀመሪያ እርዳታ ረዳት ነኝ። ለጤና አደጋዎች ደረጃ በደረጃ መመሪያ እሰጣለሁ።",
  om: "Ani Gargaaraa Gargaarsa Jalqabaa WHO irratti hundaa'e dha. Balaa fayyaa irratti tarkaanfii tarkaanfiidhaan qajeelfama kenna.",
};

const GREETING_PATTERN =
  /^(hi|hello|hey|good morning|good afternoon|good evening|salam|selam|ሰላም|akkam|nagaa|ashamaa)\b/i;

const isHealthRelatedQuery = (input: string): boolean => {
  const lower = input.toLowerCase().trim();
  return HEALTH_SCOPE_KEYWORDS.some((kw) => lower.includes(kw));
};

const isGreetingQuery = (input: string): boolean =>
  GREETING_PATTERN.test(input.toLowerCase().trim());

const isAssistantMetaQuery = (input: string): boolean =>
  /\b(who are you|who r u|who are u|what are you|what can you do|what happened to you|what happened to u|about you|your role)\b/i.test(
    input.toLowerCase().trim(),
  );

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getApiKey = (): string =>
  (process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? "").trim();

const getOpenRouterApiKey = (): string =>
  (process.env.EXPO_PUBLIC_OPENROUTER_API_KEY ?? "").trim();

const getOpenRouterModel = (): string =>
  (process.env.EXPO_PUBLIC_OPENROUTER_MODEL ?? "").trim() ||
  OPENROUTER_DEFAULT_MODEL;

const getOpenRouterFallbackModels = (): string[] => {
  const preferred = getOpenRouterModel();
  const all = [preferred, ...OPENROUTER_FALLBACK_MODELS];
  return all.filter((model, idx) => model && all.indexOf(model) === idx);
};

export const isFirstAidAiConfigured = (): boolean =>
  Boolean(getApiKey() || getOpenRouterApiKey());

const toChatRole = (role: Message["role"]): "assistant" | "user" =>
  role === "bot" ? "assistant" : "user";

export const getFirstAidAiResponse = async (
  userInput: string,
  history: Message[],
  lang: Lang = "en",
): Promise<BotMessage | null> => {
  const geminiApiKey = getApiKey();
  const openRouterApiKey = getOpenRouterApiKey();
  if (!geminiApiKey && !openRouterApiKey) return null;

  // Let the local chatbot greeting logic return the full welcome message.
  if (isGreetingQuery(userInput)) return null;

  if (isAssistantMetaQuery(userInput)) {
    return {
      role: "bot",
      text: ASSISTANT_META_TEXT[lang],
    };
  }

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

  const payload = {
    temperature: 0.3,
    max_tokens: 350,
    messages: [
      { role: "system", content: SYSTEM_PROMPTS[lang].trim() },
      ...contextMessages,
      { role: "user", content: userInput },
    ],
  };

  try {
    let replyText = "";

    // Prefer Gemini when available, fallback to OpenRouter free model on error/limits.
    if (geminiApiKey) {
      const response = await fetch(GEMINI_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${geminiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...payload,
          model: GEMINI_MODEL,
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        const data: any = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        replyText = typeof content === "string" ? content.trim() : "";
      } else {
        const errText = await response.text().catch(() => "");
        console.warn(`Gemini error ${response.status}: ${errText}`);
      }
    }

    if (!replyText && openRouterApiKey) {
      for (const model of getOpenRouterFallbackModels()) {
        const response = await fetch(OPENROUTER_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openRouterApiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://localhost",
            "X-Title": "Erdataye App",
          },
          body: JSON.stringify({
            ...payload,
            model,
          }),
          signal: controller.signal,
        });

        if (response.ok) {
          const data: any = await response.json();
          const content = data?.choices?.[0]?.message?.content;
          replyText = typeof content === "string" ? content.trim() : "";
          if (replyText) break;
        } else {
          const errText = await response.text().catch(() => "");
          console.warn(
            `OpenRouter error ${response.status} (${model}): ${errText}`,
          );
        }
      }
    }

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
