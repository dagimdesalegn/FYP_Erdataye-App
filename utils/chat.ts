import { backendDelete, backendGet, backendPost } from "./api";

export interface ChatMessage {
  id: string;
  user_id: string;
  role: "user" | "bot";
  message: string;
  created_at: string;
}

export interface ChatbotMessage {
  id: string;
  user_id: string;
  role: "user" | "bot";
  message: string;
  created_at: string;
}

/**
 * Add one message to chatbot history via backend.
 */
export const addChatbotMessage = async (
  _userId: string,
  role: "user" | "bot",
  message: string,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    await backendPost("/chat/messages", { role, message });
    return { success: true, error: null };
  } catch (error) {
    console.error("addChatbotMessage error:", error);
    return { success: false, error: error as Error };
  }
};

/**
 * Get chatbot history for the current user via backend.
 */
export const getChatbotMessages = async (
  _userId: string,
): Promise<{ messages: ChatbotMessage[] | null; error: Error | null }> => {
  try {
    const data = await backendGet<{ messages: ChatbotMessage[] }>("/chat/messages");
    return { messages: data.messages, error: null };
  } catch (error) {
    console.error("getChatbotMessages error:", error);
    return { messages: null, error: error as Error };
  }
};

/**
 * Delete all chatbot history for the current user via backend.
 */
export const deleteChatbotMessages = async (
  _userId: string,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    await backendDelete("/chat/messages");
    return { success: true, error: null };
  } catch (error) {
    console.error("deleteChatbotMessages error:", error);
    return { success: false, error: error as Error };
  }
};

