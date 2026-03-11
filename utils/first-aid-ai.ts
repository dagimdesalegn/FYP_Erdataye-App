import type { BotMessage, Message } from "./first-aid-chatbot";
import type { Lang } from "./i18n-first-aid";

const BACKEND_URL =
  (process.env.EXPO_PUBLIC_BACKEND_URL ?? "http://localhost:8000").replace(
    /\/$/,
    "",
  );

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const isFirstAidAiConfigured = (): boolean => Boolean(BACKEND_URL);

const toChatRole = (role: Message["role"]): "assistant" | "user" =>
  role === "bot" ? "assistant" : "user";

/**
 * Send user input + conversation history to the DeepSeek backend.
 * ALL responses come from DeepSeek — no local hardcoded answers.
 */
export const getFirstAidAiResponse = async (
  userInput: string,
  history: Message[],
  lang: Lang = "en",
): Promise<BotMessage | null> => {
  if (!BACKEND_URL) return null;

  const contextMessages = history.slice(-8).map((msg) => ({
    role: toChatRole(msg.role),
    content: msg.text,
  }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${BACKEND_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: userInput,
        history: contextMessages,
        lang: lang,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`DeepSeek backend error ${response.status}`);
      return null;
    }

    const data: any = await response.json();
    let replyText = typeof data?.reply === "string" ? data.reply.trim() : "";
    // Strip any leftover markdown asterisks
    replyText = replyText.replace(/\*+/g, "");

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
    console.warn("DeepSeek backend request failed:", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
};
