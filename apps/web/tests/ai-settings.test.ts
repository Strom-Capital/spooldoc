import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { aiProviders } from '@/lib/server/db/schema';
import type { SettingsView } from '@/lib/types';
import { signedIn } from './helpers/auth';
import { resetTables } from './helpers/db';
import { db } from './helpers/fixtures';
import { appRequest } from './helpers/mocks';

const route = await import('@/app/api/settings/route');

const KEY = 'sk-ant-test-0123456789abcdef-never-shown';
let auth: Record<string, string>;

const put = (body: unknown) => route.PUT(appRequest('/api/settings', { method: 'PUT', body, headers: auth }));
const get = () => route.GET(appRequest('/api/settings', { headers: auth }));
const ai = async () => ((await (await get()).json()) as SettingsView).ai;

beforeEach(async () => {
  await resetTables(db());
  auth = await signedIn();
});

describe('AI settings', () => {
  it('starts with the chat off and nothing saved', async () => {
    const view = await ai();
    expect(view.provider).toBeNull();
    expect(view.providers.anthropic).toEqual({ model: null, effort: 'provider-default', baseUrl: null, hasKey: false });
    expect(Object.keys(view.providers).sort()).toEqual(['anthropic', 'gateway', 'google', 'local', 'openai', 'openrouter']);
  });

  it('saves a provider, its model, effort and an encrypted key, and never sends the key back', async () => {
    const response = await put({ ai: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high', apiKey: KEY } });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(KEY);

    const text = await (await get()).text();
    expect(text).not.toContain(KEY);
    expect((JSON.parse(text) as SettingsView).ai).toMatchObject({
      provider: 'anthropic',
      providers: { anthropic: { model: 'claude-opus-5-5', effort: 'high', hasKey: true } },
    });
    const [row] = await db().select().from(aiProviders).where(eq(aiProviders.provider, 'anthropic'));
    expect(row?.apiKeyEnc).toMatch(/^v1\./);
    expect(row?.apiKeyEnc).not.toContain(KEY);
  });

  it('keeps the key when none or an empty one is sent, and removes it on null', async () => {
    await put({ ai: { provider: 'openai', apiKey: KEY } });
    const before = (await db().select().from(aiProviders))[0]?.apiKeyEnc;

    await put({ ai: { provider: 'openai', model: 'gpt-5.5' } });
    await put({ ai: { provider: 'openai', apiKey: '' } });
    expect((await db().select().from(aiProviders))[0]?.apiKeyEnc).toBe(before);
    expect((await ai()).providers.openai).toMatchObject({ model: 'gpt-5.5', hasKey: true });

    await put({ ai: { provider: 'openai', apiKey: null } });
    expect((await ai()).providers.openai.hasKey).toBe(false);
  });

  it("keeps each provider's settings when switching, and turning the chat off keeps them too", async () => {
    await put({ ai: { provider: 'anthropic', model: 'claude-haiku-5-5', apiKey: KEY } });
    await put({ ai: { provider: 'local', model: 'qwen3', baseUrl: 'http://ollama:11434/v1/' } });
    let view = await ai();
    expect(view.provider).toBe('local');
    expect(view.providers.local).toMatchObject({ model: 'qwen3', baseUrl: 'http://ollama:11434/v1', hasKey: false });
    expect(view.providers.anthropic).toMatchObject({ model: 'claude-haiku-5-5', hasKey: true });

    await put({ ai: { provider: null } });
    view = await ai();
    expect(view.provider).toBeNull();
    expect(view.providers.anthropic.hasKey).toBe(true);
  });

  it('saves the AI and watcher settings together', async () => {
    const response = await put({ retentionDays: 10, ai: { provider: 'google' } });
    expect(response.status).toBe(200);
    expect((await response.json()) as SettingsView).toMatchObject({ retentionDays: 10, ai: { provider: 'google' } });
  });

  it.each([
    [{ provider: 'mistral' }, { error: 'Choose a provider from the list.', field: 'ai.provider' }],
    [{ provider: 'anthropic', effort: 'huge' }, { error: 'Choose an effort from the list.', field: 'ai.effort' }],
    [{ provider: 'anthropic', model: '  ' }, { error: 'Enter a model.', field: 'ai.model' }],
    [{ provider: 'local', model: 'qwen3', baseUrl: 'ftp://host' }, { error: 'Enter an http or https URL.', field: 'ai.baseUrl' }],
    [{ provider: 'local', model: 'qwen3' }, { error: 'Enter the base URL of the local model.', field: 'ai.baseUrl' }],
    [{ provider: 'local', baseUrl: 'http://localhost:11434/v1' }, { error: 'Enter a model.', field: 'ai.model' }],
    [{ provider: 'anthropic', apiKey: 'x'.repeat(501) }, { error: 'The key is too long.', field: 'ai.apiKey' }],
  ])('refuses %j', async (body, message) => {
    const response = await put({ ai: body });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(message);
    expect((await ai()).provider).toBeNull();
  });

  it('needs a session', async () => {
    expect((await route.PUT(appRequest('/api/settings', { method: 'PUT', body: { ai: { provider: 'anthropic', apiKey: KEY } } }))).status).toBe(401);
    expect((await route.GET(appRequest('/api/settings'))).status).toBe(401);
  });
});
