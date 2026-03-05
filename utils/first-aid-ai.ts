import type { BotMessage, Message } from './first-aid-chatbot';
import { type Lang, MIN_REPLY_FOLLOWUPS, SYSTEM_PROMPTS } from './i18n-first-aid';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const isFirstAidAiConfigured = (): boolean =>
  Boolean((process.env.EXPO_PUBLIC_OPENROUTER_API_KEY ?? '').trim());

const toOpenRouterRole = (role: Message['role']): 'assistant' | 'user' =>
  role === 'bot' ? 'assistant' : 'user';

export const getFirstAidAiResponse = async (
  userInput: string,
  history: Message[],
  lang: Lang = 'en'
): Promise<BotMessage | null> => {
  const apiKey = (process.env.EXPO_PUBLIC_OPENROUTER_API_KEY ?? '').trim();
  const model = (process.env.EXPO_PUBLIC_OPENROUTER_MODEL ?? DEFAULT_MODEL).trim();

  if (!apiKey) return null;

  const contextMessages = history.slice(-8).map((msg) => ({
    role: toOpenRouterRole(msg.role),
    content: msg.text,
  }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  const startedAt = Date.now();

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://erdataya.app',
        'X-Title': 'Erdataya First Aid Assistant',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 500,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS[lang].trim() },
          ...contextMessages,
          { role: 'user', content: userInput },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn(`OpenRouter error ${response.status}: ${errText}`);
      return null;
    }

    const data: any = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const replyText = typeof content === 'string' ? content.trim() : '';

    if (!replyText) return null;

    const elapsed = Date.now() - startedAt;
    if (elapsed < 300) {
      await sleep(300 - elapsed);
    }

    return {
      role: 'bot',
      text: replyText,
      followUps: MIN_REPLY_FOLLOWUPS[lang],
    };
  } catch (error) {
    console.warn('OpenRouter request failed:', error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

