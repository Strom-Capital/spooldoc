// The password rules and the messages for a failed name or password change, shared by
// the Profile page and the server's Better Auth setup (so this module must not import
// `server-only`).

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

/** An error as Better Auth's client returns it. */
export interface AuthError {
  code?: string;
  message?: string;
  status: number;
  statusText?: string;
}

/** What is wrong with a new password before it is sent, or null when it can be tried. */
export function newPasswordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `The new password is too short. Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `The new password is too long. Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/**
 * A failed account change as one sentence: what went wrong and what to do next.
 *
 * @param action - What was tried, such as `change the password`
 * @param error - Better Auth's error, or what the call threw (the server did not answer)
 */
export function accountErrorText(action: string, error: AuthError | unknown): string {
  const fail = (reason: string) => `Could not ${action}: ${reason}`;
  if (!isAuthError(error)) {
    return fail('the server did not answer. Check that it is running, then try again.');
  }
  switch (error.code) {
    case 'INVALID_PASSWORD':
      return fail('the current password is wrong. Type it again.');
    case 'PASSWORD_TOO_SHORT':
      return fail(`the new password is too short. Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    case 'PASSWORD_TOO_LONG':
      return fail(`the new password is too long. Use at most ${MAX_PASSWORD_LENGTH} characters.`);
  }
  if (error.status === 401) {
    return fail('you are signed out. Sign in again, then try again.');
  }
  if (error.status === 429) {
    return fail('too many tries. Wait a minute, then try again.');
  }
  const reason = (error.message || error.statusText || `HTTP ${error.status}`).replace(/\.$/, '');
  return fail(`${reason}. Try again.`);
}

function isAuthError(error: unknown): error is AuthError {
  return typeof error === 'object' && error !== null && typeof (error as AuthError).status === 'number';
}
