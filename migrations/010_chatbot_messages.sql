-- Dedicated chatbot message history (separate from emergency chat flow)
CREATE TABLE IF NOT EXISTS public.chatbot_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'bot')),
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chatbot_messages_user_id
  ON public.chatbot_messages(user_id);

CREATE INDEX IF NOT EXISTS idx_chatbot_messages_user_created
  ON public.chatbot_messages(user_id, created_at ASC);

ALTER TABLE public.chatbot_messages ENABLE ROW LEVEL SECURITY;

-- Users can read only their own chatbot messages
CREATE POLICY "Chatbot: users read own messages"
  ON public.chatbot_messages
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert only their own chatbot messages
CREATE POLICY "Chatbot: users insert own messages"
  ON public.chatbot_messages
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete only their own chatbot messages
CREATE POLICY "Chatbot: users delete own messages"
  ON public.chatbot_messages
  FOR DELETE
  USING (auth.uid() = user_id);
