import { supabase } from "./supabase";

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
 * Legacy helper kept for compatibility.
 * Stores user/bot rows in chatbot_messages (chat_history removed).
 */
export const addChatMessage = async (
  _emergencyId: string,
  userId: string,
  userMessage: string,
  aiResponse: string = "",
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const rows: Array<{
      user_id: string;
      role: "user" | "bot";
      message: string;
    }> = [{ user_id: userId, role: "user", message: userMessage }];
    if (aiResponse.trim()) {
      rows.push({ user_id: userId, role: "bot", message: aiResponse });
    }

    const { error } = await supabase.from("chatbot_messages").insert(rows);
    if (error) return { success: false, error: error as unknown as Error };

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

/**
 * Legacy helper kept for compatibility.
 * Returns chatbot_messages for a user id passed as emergencyId.
 */
export const getChatHistory = async (
  emergencyId: string,
): Promise<{
  messages: ChatMessage[] | null;
  error: Error | null;
}> => {
  try {
    const { data, error } = await supabase
      .from("chatbot_messages")
      .select("*")
      .eq("user_id", emergencyId)
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    return { messages: data as ChatMessage[], error: null };
  } catch (error) {
    return { messages: null, error: error as Error };
  }
};

/**
 * Legacy realtime helper kept for compatibility.
 */
export const subscribeToChatMessages = (
  emergencyId: string,
  callback: (message: ChatMessage) => void,
) => {
  const subscription = supabase
    .channel(`chatbot_messages:user_id=eq.${emergencyId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "chatbot_messages",
        filter: `user_id=eq.${emergencyId}`,
      },
      (payload: any) => {
        callback(payload.new as ChatMessage);
      },
    )
    .subscribe();

  return subscription;
};

/**
 * Add one message to chatbot history.
 */
export const addChatbotMessage = async (
  userId: string,
  role: "user" | "bot",
  message: string,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const { error } = await supabase.from("chatbot_messages").insert({
      user_id: userId,
      role,
      message,
    });

    if (error) return { success: false, error: error as unknown as Error };
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

/**
 * Get chatbot history for the current user.
 */
export const getChatbotMessages = async (
  userId: string,
): Promise<{ messages: ChatbotMessage[] | null; error: Error | null }> => {
  try {
    const { data, error } = await supabase
      .from("chatbot_messages")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return { messages: data as ChatbotMessage[], error: null };
  } catch (error) {
    return { messages: null, error: error as Error };
  }
};

/**
 * Delete all chatbot history for the current user.
 */
export const deleteChatbotMessages = async (
  userId: string,
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const { error } = await supabase
      .from("chatbot_messages")
      .delete()
      .eq("user_id", userId);

    if (error) return { success: false, error: error as unknown as Error };
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};
