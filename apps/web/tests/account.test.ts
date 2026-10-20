import { describe, expect, it } from 'vitest';
import { accountErrorText, newPasswordProblem } from '@/lib/account';

describe('newPasswordProblem', () => {
  it('asks for at least 10 characters and at most 128', () => {
    expect(newPasswordProblem('short')).toBe('The new password is too short. Use at least 10 characters.');
    expect(newPasswordProblem('x'.repeat(129))).toBe('The new password is too long. Use at most 128 characters.');
    expect(newPasswordProblem('correct-horse-battery')).toBeNull();
  });
});

describe('accountErrorText', () => {
  const action = 'change the password';

  it('says the current password is wrong', () => {
    expect(accountErrorText(action, { code: 'INVALID_PASSWORD', message: 'Invalid password', status: 400 })).toBe(
      'Could not change the password: the current password is wrong. Type it again.',
    );
  });

  it('says the new password is too short or too long', () => {
    expect(accountErrorText(action, { code: 'PASSWORD_TOO_SHORT', status: 400 })).toBe(
      'Could not change the password: the new password is too short. Use at least 10 characters.',
    );
    expect(accountErrorText(action, { code: 'PASSWORD_TOO_LONG', status: 400 })).toBe(
      'Could not change the password: the new password is too long. Use at most 128 characters.',
    );
  });

  it('says to sign in again when the session ended, and to wait after too many tries', () => {
    expect(accountErrorText('save the name', { status: 401, statusText: 'Unauthorized' })).toBe(
      'Could not save the name: you are signed out. Sign in again, then try again.',
    );
    expect(accountErrorText(action, { status: 429 })).toBe('Could not change the password: too many tries. Wait a minute, then try again.');
  });

  it('says the server did not answer when the call threw', () => {
    expect(accountErrorText(action, new TypeError('Failed to fetch'))).toBe(
      'Could not change the password: the server did not answer. Check that it is running, then try again.',
    );
  });

  it("keeps the server's own message for anything else", () => {
    expect(accountErrorText('save the name', { code: 'FAILED_TO_UPDATE_USER', message: 'Failed to update user.', status: 500 })).toBe(
      'Could not save the name: Failed to update user. Try again.',
    );
    expect(accountErrorText('save the name', { status: 502 })).toBe('Could not save the name: HTTP 502. Try again.');
  });
});
