import type { BotMessage, Message } from "./first-aid-chatbot";
import type { Lang } from "./i18n-first-aid";
import { backendPost } from "./api";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const isFirstAidAiConfigured = (): boolean => true;

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
  const contextMessages = history.slice(-8).map((msg) => ({
    role: toChatRole(msg.role),
    content: msg.text,
  }));
  const startedAt = Date.now();

  try {
    const data = await backendPost<{ reply?: string }>("/chat", {
      message: userInput,
      history: contextMessages,
      lang,
    });

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
  }
};
