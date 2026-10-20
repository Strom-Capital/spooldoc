import 'server-only';

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGateway } from '@ai-sdk/gateway';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import { aiProvider, type AiProviderId, type Effort } from '../ai-providers';
import { decryptSecret } from './secrets';
import { getAiRows } from './settings';

/** Which model the chat uses, without any key. */
export interface ModelInfo {
  provider: AiProviderId;
  id: string;
}

/** A model ready for `streamText`, with its reasoning level and the key to redact from errors. */
export interface ChatModel {
  model: LanguageModel;
  /** Which model it is. */
  info: ModelInfo;
  reasoning: Effort;
  secrets: string[];
}

interface Resolved extends ModelInfo {
  apiKeyEnc: string | null;
  effort: Effort;
  baseUrl: string | null;
}

/** The chosen provider's settings, or null when the chat is off or the provider is not set up. */
async function resolve(): Promise<Resolved | null> {
  const { provider, rows } = await getAiRows();
  if (!provider) {
    return null;
  }
  const meta = aiProvider(provider);
  const row = rows.find((entry) => entry.provider === provider);
  const id = row?.model || meta.defaultModel;
  if (!id || (meta.needsKey && !row?.apiKeyEnc) || (provider === 'local' && !row?.baseUrl)) {
    return null;
  }
  return { provider, id, apiKeyEnc: row?.apiKeyEnc ?? null, effort: (row?.effort ?? 'provider-default') as Effort, baseUrl: row?.baseUrl ?? null };
}

/** The model chosen in Settings, or null when the chat is off or the provider lacks a key or model. */
export async function describeModel(): Promise<ModelInfo | null> {
  const resolved = await resolve();
  return resolved ? { provider: resolved.provider, id: resolved.id } : null;
}

/** Model vendors whose current models read PDFs and images in tool results. */
const FILE_VENDORS = ['anthropic', 'openai', 'google'] as const;

/**
 * True when the model takes files (a PDF, a PNG) in tool results, so a Word or Excel render can
 * show it the document. The Anthropic, OpenAI and Google providers do. Behind the
 * Gateway or OpenRouter, only those vendors' models (`anthropic/...`) are trusted to; a
 * model that cannot read a file would fail the whole answer. The local provider sends
 * a file as base64 text, so it gets the text only.
 */
export function takesFiles(model: ModelInfo): boolean {
  if ((FILE_VENDORS as readonly string[]).includes(model.provider)) return true;
  if (model.provider === 'gateway' || model.provider === 'openrouter') {
    return FILE_VENDORS.some((vendor) => model.id.startsWith(`${vendor}/`));
  }
  return false;
}

/** OpenRouter reads the effort from its model settings, not the call, and has no `max`. */
function openRouterReasoning(effort: Effort) {
  if (effort === 'provider-default') return undefined;
  return { effort: effort === 'max' ? 'xhigh' : effort } as const;
}

/**
 * Build the model chosen in Settings.
 *
 * @returns The model, or null when the chat is off or not set up
 * @throws Error when the saved key cannot be decrypted
 */
export async function createModel(): Promise<ChatModel | null> {
  const resolved = await resolve();
  if (!resolved) {
    return null;
  }
  const apiKey = resolved.apiKeyEnc ? decryptSecret(resolved.apiKeyEnc, 'API key') : undefined;
  const { id, effort } = resolved;
  const model = ((): LanguageModel => {
    switch (resolved.provider) {
      case 'anthropic':
        return createAnthropic({ apiKey })(id);
      case 'google':
        return createGoogleGenerativeAI({ apiKey })(id);
      case 'openai':
        return createOpenAI({ apiKey })(id);
      case 'openrouter':
        return createOpenRouter({ apiKey })(id, { reasoning: openRouterReasoning(effort) });
      case 'gateway':
        return createGateway({ apiKey })(id);
      case 'local':
        return createOpenAICompatible({ name: 'local', baseURL: resolved.baseUrl ?? '', ...(apiKey ? { apiKey } : {}) })(id);
    }
  })();
  return { model, info: { provider: resolved.provider, id }, reasoning: effort, secrets: apiKey ? [apiKey] : [] };
}
