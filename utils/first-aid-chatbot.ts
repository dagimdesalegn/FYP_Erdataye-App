/**
 * First Aid Chatbot — type exports only.
 *
 * All actual responses are powered by DeepSeek AI via the backend.
 * This file only exports the shared types used across the app.
 */

export interface ChatTopic {
  id: string;
  label: string;
  keywords: string[];
  icon: string;
}

export interface BotMessage {
  role: "bot";
  text: string;
  followUps?: string[];
}

export interface UserMessage {
  role: "user";
  text: string;
}

export type Message = BotMessage | UserMessage;
