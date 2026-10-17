import 'server-only';

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { getConfig } from './config';

/** Which model the server is set up with, without any key. */
export interface ModelInfo {
  provider: 'anthropic' | 'openai-compatible';
  id: string;
}

/**
 * The model from the server's environment: Anthropic when ANTHROPIC_API_KEY is set,
 * else the OpenAI-compatible endpoint when its base URL and model are set, else none.
 * Requests never supply a key.
 */
export function describeModel(): ModelInfo | null {
  const config = getConfig();
  if (config.anthropicApiKey) {
    return { provider: 'anthropic', id: config.model };
  }
  if (config.openaiCompatible?.model) {
    return { provider: 'openai-compatible', id: config.openaiCompatible.model };
  }
  return null;
}

/**
 * Build the language model described by `describeModel`.
 *
 * @returns The model, or null when no provider is configured
 */
export function createModel(): LanguageModel | null {
  const config = getConfig();
  const info = describeModel();
  if (!info) {
    return null;
  }
  if (info.provider === 'anthropic') {
    return createAnthropic({ apiKey: config.anthropicApiKey })(info.id);
  }
  const custom = config.openaiCompatible;
  if (!custom) {
    return null;
  }
  return createOpenAICompatible({
    name: 'custom',
    baseURL: custom.baseUrl,
    ...(custom.apiKey ? { apiKey: custom.apiKey } : {}),
  })(info.id);
}
