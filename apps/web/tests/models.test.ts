import { beforeEach, describe, expect, it } from 'vitest';
import { aiProviders, settings } from '@/lib/server/db/schema';
import { createModel, describeModel } from '@/lib/server/models';
import { updateAiSettings, type AiChange } from '@/lib/server/settings';
import { resetTables } from './helpers/db';
import { db } from './helpers/fixtures';

const KEY = 'test-key-0123456789';

beforeEach(async () => {
  await resetTables(db());
});

describe('describeModel', () => {
  it('is null while the chat is off', async () => {
    expect(await describeModel()).toBeNull();
    expect(await createModel()).toBeNull();
  });

  it('is null for a provider without a key', async () => {
    await updateAiSettings({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(await describeModel()).toBeNull();
  });

  it("uses the provider's default model when none is saved", async () => {
    await updateAiSettings({ provider: 'anthropic', apiKey: KEY });
    expect(await describeModel()).toEqual({ provider: 'anthropic', id: 'claude-sonnet-5-5' });
  });

  it('allows a local model without a key', async () => {
    await updateAiSettings({ provider: 'local', model: 'qwen3', baseUrl: 'http://localhost:11434/v1' });
    expect(await describeModel()).toEqual({ provider: 'local', id: 'qwen3' });
    expect((await createModel())?.secrets).toEqual([]);
  });
});

describe('createModel', () => {
  it.each<[AiChange, string, string]>([
    [{ provider: 'anthropic', model: 'claude-opus-5-5' }, 'anthropic', 'claude-opus-5-5'],
    [{ provider: 'google', model: 'gemini-pro-latest' }, 'google', 'gemini-pro-latest'],
    [{ provider: 'openai', model: 'gpt-5.5' }, 'openai', 'gpt-5.5'],
    [{ provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5' }, 'openrouter', 'anthropic/claude-sonnet-5.5'],
    [{ provider: 'gateway', model: 'anthropic/claude-sonnet-5.5' }, 'gateway', 'anthropic/claude-sonnet-5.5'],
    [{ provider: 'local', model: 'qwen3', baseUrl: 'http://localhost:11434/v1' }, 'local', 'qwen3'],
  ])('builds %j', async (change, provider, modelId) => {
    await updateAiSettings({ ...change, effort: 'medium', apiKey: KEY });
    const chat = await createModel();
    if (!chat || typeof chat.model === 'string') throw new Error('No model');
    expect(chat.model.provider).toContain(provider);
    expect(chat.model.modelId).toBe(modelId);
    expect(chat.reasoning).toBe('medium');
    expect(chat.secrets).toEqual([KEY]);
  });

  it('says so when the key cannot be decrypted', async () => {
    await db().insert(aiProviders).values({ provider: 'anthropic', apiKeyEnc: 'v1.bad.bad.bad' });
    await db().update(settings).set({ aiProvider: 'anthropic' });
    await expect(createModel()).rejects.toThrow('The stored API key cannot be decrypted');
  });
});
