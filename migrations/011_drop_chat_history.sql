-- Drop legacy chat_history table (if still present)
-- Run only after you have migrated to public.chatbot_messages.
DROP TABLE IF EXISTS public.chat_history CASCADE;
