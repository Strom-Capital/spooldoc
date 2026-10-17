import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, getConfig, repoRoot, resetConfig } from '@/lib/server/config';

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

  it('fails with a readable message without SESSION_SECRET', () => {
    withEnv({ SESSION_SECRET: undefined });
    expect(() => getConfig()).toThrow(/SESSION_SECRET is not set/);
  });

  it('fails when SESSION_SECRET is short', () => {
    withEnv({ SESSION_SECRET: 'short' });
    expect(() => getConfig()).toThrow(/at least 32 characters/);
  });

  it('lists every problem at once', () => {
    withEnv({ SESSION_SECRET: 'short', SPOOLDOC_DEFAULT_CCSID: 'abc', APP_URL: 'ftp://x' });
    expect(() => getConfig()).toThrow(/SESSION_SECRET[\s\S]*APP_URL[\s\S]*SPOOLDOC_DEFAULT_CCSID/);
  });

  it('has defaults', () => {
    withEnv({ SPOOLDOC_WORKSPACE: undefined, APP_URL: undefined, SPOOLDOC_MASK: undefined, SPOOLDOC_MODEL: undefined });
    const config = getConfig();
    expect(config.workspace).toBe(path.join(repoRoot(), 'workspace'));
    expect(path.basename(repoRoot())).not.toBe('web');
    expect(config.appUrl).toBeUndefined();
    expect(config.mask).toBe(true);
    expect(config.model).toBe(DEFAULT_MODEL);
    expect(config.allowedHosts).toEqual([]);
    expect(config.defaultCcsid).toBeUndefined();
    expect(config.openaiCompatible).toBeUndefined();
  });

  it('reads the optional settings', () => {
    withEnv({
      SPOOLDOC_WORKSPACE: 'tmp/ws',
      SPOOLDOC_MASK: 'false',
      SPOOLDOC_DEFAULT_CCSID: '37',
      SPOOLDOC_ALLOWED_HOSTS: ' IBMI.example.com, other.example.com ,',
      OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:11434/v1/',
      OPENAI_COMPATIBLE_MODEL: 'local-model',
    });
    const config = getConfig();
    expect(config.workspace).toBe(path.join(repoRoot(), 'tmp/ws'));
    expect(config.mask).toBe(false);
    expect(config.defaultCcsid).toBe(37);
    expect(config.allowedHosts).toEqual(['ibmi.example.com', 'other.example.com']);
    expect(config.openaiCompatible).toEqual({ baseUrl: 'http://localhost:11434/v1', apiKey: undefined, model: 'local-model' });
  });
});
