/**
 * OpenAI-compatible LLM client for content extraction.
 * Works with any OpenAI-compatible API (OpenAI, Claude, local models, etc.)
 */

import { config } from '../config.js';
import { logger } from '../utils/logger.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  choices: Array<{
    message: { content: string; reasoning_content?: string };
  }>;
}

export async function chat(messages: ChatMessage[]): Promise<string> {
  const resp = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.llm.apiKey}`,
    },
    body: JSON.stringify({
      model: config.llm.model,
      messages,
      temperature: 0.1,
      max_tokens: 4096,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM API error ${resp.status}: ${text}`);
  }

  const data = (await resp.json()) as ChatResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty LLM response');

  logger.debug('LLM response length:', content.length);
  return content;
}
