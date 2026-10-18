import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, getConfig, resetConfig } from '@/lib/server/config';

const saved = { ...process.env };

function withEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfig();
}

describe('getConfig', () => {
  afterEach(() => {
    process.env = { ...saved };
    resetConfig();
  });

  it('fails with a readable message without BETTER_AUTH_SECRET', () => {
    withEnv({ BETTER_AUTH_SECRET: undefined });
    expect(() => getConfig()).toThrow(/BETTER_AUTH_SECRET is not set/);
  });

  it('fails when BETTER_AUTH_SECRET is short', () => {
    withEnv({ BETTER_AUTH_SECRET: 'short' });
    expect(() => getConfig()).toThrow(/at least 32 characters/);
  });

  it('needs a 32-byte SPOOLDOC_SECRET_KEY', () => {
    withEnv({ SPOOLDOC_SECRET_KEY: undefined });
    expect(() => getConfig()).toThrow(/SPOOLDOC_SECRET_KEY is not set/);
    withEnv({ SPOOLDOC_SECRET_KEY: Buffer.alloc(16).toString('base64') });
    expect(() => getConfig()).toThrow(/32 bytes in base64/);
  });

  it('lists every problem at once', () => {
    withEnv({ BETTER_AUTH_SECRET: 'short', SPOOLDOC_DEFAULT_CCSID: 'abc', APP_URL: 'ftp://x' });
    expect(() => getConfig()).toThrow(/BETTER_AUTH_SECRET[\s\S]*APP_URL[\s\S]*SPOOLDOC_DEFAULT_CCSID/);
  });

  it('has defaults', () => {
    withEnv({ APP_URL: undefined, SPOOLDOC_MASK: undefined, SPOOLDOC_MODEL: undefined, SPOOLDOC_WATCHER: undefined, DATABASE_URL: undefined });
    const config = getConfig();
    expect(config.databaseUrl).toBeUndefined();
    expect(config.secretKey).toHaveLength(32);
    expect(config.watcher).toBe(true);
    expect(config.appUrl).toBeUndefined();
    expect(config.mask).toBe(true);
    expect(config.model).toBe(DEFAULT_MODEL);
    expect(config.allowedHosts).toEqual([]);
    expect(config.defaultCcsid).toBeUndefined();
    expect(config.openaiCompatible).toBeUndefined();
  });

  it('reads the optional settings', () => {
    withEnv({
      DATABASE_URL: 'postgres://localhost/spooldoc',
      SPOOLDOC_WATCHER: 'off',
      SPOOLDOC_MASK: 'false',
      SPOOLDOC_DEFAULT_CCSID: '37',
      SPOOLDOC_ALLOWED_HOSTS: ' IBMI.example.com, other.example.com ,',
      OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:11434/v1/',
      OPENAI_COMPATIBLE_MODEL: 'local-model',
    });
    const config = getConfig();
    expect(config.databaseUrl).toBe('postgres://localhost/spooldoc');
    expect(config.watcher).toBe(false);
    expect(config.mask).toBe(false);
    expect(config.defaultCcsid).toBe(37);
    expect(config.allowedHosts).toEqual(['ibmi.example.com', 'other.example.com']);
    expect(config.openaiCompatible).toEqual({ baseUrl: 'http://localhost:11434/v1', apiKey: undefined, model: 'local-model' });
  });
});
