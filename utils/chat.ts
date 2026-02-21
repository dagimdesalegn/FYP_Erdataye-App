import { supabase } from './supabase';

export interface ChatMessage {
  id: string;
  emergency_id: string;
  user_id: string;
  message: string;
  is_ai: boolean;
  created_at: string;
}

/**
 * Add chat message
 */
export const addChatMessage = async (
  emergencyId: string,
  userId: string,
  message: string,
  isAi = false
): Promise<{ success: boolean; error: Error | null }> => {
  try {
    const { error } = await supabase.from('chat_history').insert({
      emergency_id: emergencyId,
      user_id: userId,
      message,
      is_ai: isAi,
    });

    if (error) {
      throw error;
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
      .eq('emergency_id', emergencyId)
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
    .channel(`chat_history:emergency_id=eq.${emergencyId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_history',
        filter: `emergency_id=eq.${emergencyId}`,
      },
      (payload: any) => {
        callback(payload.new as ChatMessage);
      }
    )
    .subscribe();

  return subscription;
};
