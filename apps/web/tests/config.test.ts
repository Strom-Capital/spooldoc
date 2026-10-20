import { afterEach, describe, expect, it } from 'vitest';
import { getConfig, resetConfig, retiredSettings } from '@/lib/server/config';

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
    withEnv({ APP_URL: undefined, SPOOLDOC_WATCHER: undefined, DATABASE_URL: undefined, SPOOLDOC_LOG_LEVEL: undefined });
    const config = getConfig();
    expect(config.databaseUrl).toBeUndefined();
    expect(config.secretKey).toHaveLength(32);
    expect(config.watcher).toBe(true);
    expect(config.appUrl).toBeUndefined();
    expect(config.allowedHosts).toEqual([]);
    expect(config.defaultCcsid).toBeUndefined();
    expect(config.logLevel).toBe('info');
  });

  it('reads the log level in any case, and refuses an unknown one', () => {
    withEnv({ SPOOLDOC_LOG_LEVEL: 'WARN' });
    expect(getConfig().logLevel).toBe('warn');
    withEnv({ SPOOLDOC_LOG_LEVEL: 'verbose' });
    expect(() => getConfig()).toThrow(/SPOOLDOC_LOG_LEVEL must be one of off, error, warn, info, debug/);
  });

  it('reads the optional settings', () => {
    withEnv({
      DATABASE_URL: 'postgres://localhost/spooldoc',
      SPOOLDOC_WATCHER: 'off',
      SPOOLDOC_DEFAULT_CCSID: '37',
      SPOOLDOC_ALLOWED_HOSTS: ' IBMI.example.com, other.example.com ,',
    });
    const config = getConfig();
    expect(config.databaseUrl).toBe('postgres://localhost/spooldoc');
    expect(config.watcher).toBe(false);
    expect(config.defaultCcsid).toBe(37);
    expect(config.allowedHosts).toEqual(['ibmi.example.com', 'other.example.com']);
  });

  it('says where a setting it no longer reads went', () => {
    expect(retiredSettings({})).toEqual([]);
    expect(retiredSettings({ SPOOLDOC_MASK: 'false' })).toEqual(['SPOOLDOC_MASK is no longer read. Masking is set in the app, under Settings, Agent.']);
    // A value it does not read is no longer an error either.
    withEnv({ SPOOLDOC_MASK: 'maybe' });
    expect(() => getConfig()).not.toThrow();
  });
});
