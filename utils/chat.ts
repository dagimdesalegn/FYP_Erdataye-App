import { supabase } from './supabase';

export interface ChatMessage {
  id: string;
  emergency_request_id: string;
  user_id: string;
  user_message: string;
  ai_response: string;
  created_at: string;
}

/**
 * Add chat message.
 * emergencyId may be a real emergency UUID or a user-session key for general chats.
 * Errors are returned rather than thrown so callers can handle silently.
 */
export const addChatMessage = async (
  emergencyId: string,
  userId: string,
  userMessage: string,
  aiResponse: string = ''
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const { error } = await supabase.from('chat_history').insert({
      emergency_request_id: emergencyId,
      user_id: userId,
      user_message: userMessage,
      ai_response: aiResponse,
    });

    if (error) {
      // FK violation or other DB error — return gracefully, don't crash caller
      return { success: false, error: error as unknown as Error };
    }

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

/**
 * Get chat history for emergency
 */
export const getChatHistory = async (emergencyId: string): Promise<{
  messages: ChatMessage[] | null;
  error: Error | null;
}> => {
  try {
    const { data, error } = await supabase
      .from('chat_history')
      .select('*')
      .eq('emergency_request_id', emergencyId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return { messages: data as ChatMessage[], error: null };
  } catch (error) {
    return { messages: null, error: error as Error };
  }
};

/**
 * Subscribe to chat messages
 */
export const subscribeToChatMessages = (emergencyId: string, callback: (message: ChatMessage) => void) => {
  const subscription = supabase
    .channel(`chat_history:emergency_request_id=eq.${emergencyId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_history',
        filter: `emergency_request_id=eq.${emergencyId}`,
      },
      (payload: any) => {
        callback(payload.new as ChatMessage);
      }
    )
    .subscribe();

  return subscription;
};
