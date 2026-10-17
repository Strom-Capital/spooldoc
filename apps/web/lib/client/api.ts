/** Session info from `GET /api/session`. */
export interface SessionInfo {
  connected: boolean;
  host?: string;
  user?: string;
  library?: string;
  model: { provider: string; id: string } | null;
  masking: boolean;
  pdf: boolean;
}

/** A failed API call, with the server's `{ error }` text and the HTTP status. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Call one of the app's API routes: same-origin credentials, no cache, JSON in and out.
 *
 * @param path - Path such as `/api/samples`
 * @param init - Method and a JSON-serializable body
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
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
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
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ApiError(response.status, data.error ?? `Request failed (HTTP ${response.status}).`);
  }
  return data as T;
}

/** The message of anything thrown by `api`. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/** True for an aborted fetch, which needs no message. */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
