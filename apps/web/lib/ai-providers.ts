// The chat model providers and reasoning levels, shared by the Settings page, the server
// and the database schema (so this module must not import `server-only`).

export const AI_PROVIDER_IDS = ['anthropic', 'google', 'openai', 'openrouter', 'gateway', 'local'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** The AI SDK reasoning levels. Each provider maps them onto its own setting. */
export const EFFORT_IDS = ['provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORT_IDS)[number];

export const EFFORTS: { id: Effort; label: string }[] = [
  { id: 'provider-default', label: 'Provider default' },
  { id: 'none', label: 'None' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
  { id: 'max', label: 'Max' },
];

export interface AiProvider {
  id: AiProviderId;
  label: string;
  /** False for a local model, which may run without a key. */
  needsKey: boolean;
  /** Where to get a key. */
  keyHint: string;
  /** Used when no model is saved. Empty when there is no sensible default. */
  defaultModel: string;
  /** Offered in the model field. Any other model id can be typed. */
  models: string[];
}

export const AI_PROVIDERS: AiProvider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    needsKey: true,
    keyHint: 'Create a key at console.anthropic.com under API keys.',
    defaultModel: 'claude-sonnet-5-5',
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
  },
  {
    id: 'google',
    label: 'Google',
    needsKey: true,
    keyHint: 'Create a Gemini API key at aistudio.google.com.',
    defaultModel: 'gemini-pro-latest',
    models: ['gemini-pro-latest', 'gemini-flash-latest', 'gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.5-flash'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    needsKey: true,
    keyHint: 'Create a key at platform.openai.com under API keys.',
    defaultModel: 'gpt-6.1-sol',
    models: ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6-astra', 'gpt-5.5'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    needsKey: true,
    keyHint: 'Create a key at openrouter.ai under Keys. Model ids are vendor/model.',
    defaultModel: 'anthropic/claude-sonnet-5.5',
    models: ['anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5', 'anthropic/claude-haiku-5.5', 'openai/gpt-6.1-sol', 'google/gemini-4-argon'],
  },
  {
    id: 'gateway',
    label: 'Vercel AI Gateway',
    needsKey: true,
    keyHint: 'Create a key in the Vercel dashboard under AI Gateway. Model ids are vendor/model.',
    defaultModel: 'anthropic/claude-sonnet-5.5',
    models: ['anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5', 'anthropic/claude-haiku-5.5', 'openai/gpt-6.1-sol', 'google/gemini-4-argon'],
  },
  {
    id: 'local',
    label: 'Local model',
    needsKey: false,
    keyHint: 'Only if the server asks for one.',
    defaultModel: '',
    models: ['gpt-oss:20b', 'qwen3', 'llama3.3'],
  },
];

/** The base URL a local model starts with (Ollama). LM Studio and vLLM use their own. */
export const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434/v1';

export function aiProvider(id: AiProviderId): AiProvider {
  const provider = AI_PROVIDERS.find((entry) => entry.id === id);
  if (!provider) {
    throw new Error(`Unknown AI provider: ${id}`);
  }
  return provider;
}
