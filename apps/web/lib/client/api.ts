/**
 * A failed API call, with the server's `{ error }` text and the HTTP status. For an IBM i
 * error, `code` is its class (`host`, `auth`, `notfound`, `authority`, `exists` or `other`), `detail`
 * the system's own text and `messageId` its message, such as `CPF2204`. `body` is the whole
 * JSON answer, for a route that says more than `{ error }`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly detail?: string;
  readonly messageId?: string;
  readonly body?: unknown;
  constructor(status: number, message: string, info: { code?: string; detail?: string; messageId?: string; body?: unknown } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (info.code) this.code = info.code;
    if (info.detail) this.detail = info.detail;
    if (info.messageId) this.messageId = info.messageId;
    if (info.body !== undefined) this.body = info.body;
  }
}

/**
 * Call one of the app's API routes: same-origin credentials, no cache, JSON in and out.
 *
 * @param path - Path such as `/api/samples`
 * @param init - Method and a JSON-serializable body, or `FormData` for an upload
 * @returns The parsed JSON, or undefined for 204
 * @throws ApiError with the server's message when the status is not 2xx
 */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: init.signal,
      // FormData sets its own multipart content type.
      headers: init.body === undefined || init.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : init.body instanceof FormData ? init.body : JSON.stringify(init.body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError(0, 'The server did not answer. Is it running?');
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string; detail?: string; messageId?: string };
  if (!response.ok) {
    throw new ApiError(response.status, data.error ?? `Request failed (HTTP ${response.status}).`, { code: data.code, detail: data.detail, messageId: data.messageId, body: data });
  }
  return data as T;
}

/** The message of anything thrown by `api`. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/**
 * An error to show: what went wrong and, for an IBM i error, the system's own text and
 * the class of error, which says whether Reconnect can help.
 */
export interface ShownError {
  message: string;
  detail?: string;
  code?: string;
}

/** The message, detail and code of anything thrown by `api`, for `ErrorNote`. */
export function shownError(error: unknown): ShownError {
  const message = errorText(error);
  const detail = error instanceof ApiError ? error.detail : undefined;
  const code = error instanceof ApiError ? error.code : undefined;
  return { message, ...(detail && detail !== message ? { detail } : {}), ...(code ? { code } : {}) };
}

/** True for an aborted fetch, which needs no message. */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
