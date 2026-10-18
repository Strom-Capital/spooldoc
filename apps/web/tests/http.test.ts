import { describe, expect, it } from 'vitest';
import { checkFetchSite, checkOrigin, redact } from '@/lib/server/http';

const request = (method: string, headers: Record<string, string>) =>
  new Request('http://localhost:3000/api/x', { method, headers: { host: 'localhost:3000', ...headers } });

describe('checkOrigin', () => {
  it('lets GET through', () => {
    expect(checkOrigin(request('GET', {}))).toBeUndefined();
  });

  it('accepts APP_URL and the request host', () => {
    expect(checkOrigin(request('POST', { origin: 'http://localhost:3000' }))).toBeUndefined();
    expect(checkOrigin(new Request('http://127.0.0.1:3000/api/x', { method: 'PUT', headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' } }))).toBeUndefined();
  });

  it('falls back to the Referer', () => {
    expect(checkOrigin(request('DELETE', { referer: 'http://localhost:3000/samples/X' }))).toBeUndefined();
    expect(checkOrigin(request('DELETE', { referer: 'https://evil.example.com/' }))?.status).toBe(403);
  });

  it('refuses another origin and a missing one', async () => {
    const refused = checkOrigin(request('POST', { origin: 'https://evil.example.com' }));
    expect(refused?.status).toBe(403);
    expect(await refused?.json()).toEqual({ error: 'Cross-origin request refused.' });
    expect(checkOrigin(request('POST', {}))?.status).toBe(403);
    expect(checkOrigin(request('PUT', { origin: 'null' }))?.status).toBe(403);
  });
});

describe('checkFetchSite', () => {
  it('refuses cross-site reads only', () => {
    expect(checkFetchSite(request('GET', { 'sec-fetch-site': 'cross-site' }))?.status).toBe(403);
    expect(checkFetchSite(request('GET', { 'sec-fetch-site': 'same-origin' }))).toBeUndefined();
    expect(checkFetchSite(request('GET', { 'sec-fetch-site': 'none' }))).toBeUndefined();
    expect(checkFetchSite(request('GET', {}))).toBeUndefined();
  });
});

describe('redact', () => {
  it('removes the password in any case and keeps the first line', () => {
    expect(redact(new Error('Sign-on failed for pw Secret99\nstack'), ['Secret99'])).toBe('Sign-on failed for pw ***');
    expect(redact(new Error('PASSWORD SECRET99 WRONG'), ['Secret99'])).toBe('PASSWORD *** WRONG');
    expect(redact('not an error')).toBe('Request failed');
  });
});
