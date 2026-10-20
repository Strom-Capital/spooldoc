import { describe, expect, it } from 'vitest';
import { withLatestCall } from '@/lib/client/server-state';

const connected = { lastError: null, errorCode: null, errorSince: null, lastCheckedAt: '2026-10-20T08:00:00.000Z' };
const unreachable = {
  lastError: 'Cannot reach ibmi.example.com: connection timed out.',
  errorCode: 'host' as const,
  errorSince: '2026-10-20T07:00:00.000Z',
  lastCheckedAt: '2026-10-20T07:00:00.000Z',
};
const at = '2026-10-20T09:00:00.000Z';

describe('withLatestCall', () => {
  it('shows a server the list called connected as failing once a call cannot reach it', () => {
    const error = { message: 'Cannot reach ibmi.example.com: unknown host. Check the host name on the Servers page.', code: 'host' };
    expect(withLatestCall(connected, { error, at })).toEqual({ lastError: error.message, errorCode: 'host', errorSince: at, lastCheckedAt: at });
  });

  it('shows a failed sign-on, keeping since when the server failed', () => {
    const error = { message: 'ibmi.example.com did not accept the password for DEMOUSER.', code: 'auth' };
    expect(withLatestCall(unreachable, { error, at })).toMatchObject({ errorCode: 'auth', errorSince: unreachable.errorSince });
  });

  it('shows the server connected once a call works again', () => {
    expect(withLatestCall(unreachable, { error: null, at })).toEqual({ lastError: null, errorCode: null, errorSince: null, lastCheckedAt: at });
  });

  it('leaves the server as it is for an error about one object, or without a call', () => {
    const notFound = { message: 'Output queue MYLIB/MYOUTQ does not exist on ibmi.example.com.', code: 'notfound' };
    expect(withLatestCall(connected, { error: notFound, at })).toBe(connected);
    expect(withLatestCall(connected, { error: null, at })).toBe(connected);
    expect(withLatestCall(unreachable, null)).toBe(unreachable);
  });
});
