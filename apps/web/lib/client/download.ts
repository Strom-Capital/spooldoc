import { ApiError } from './api';

/** Save a response body as a file in the browser, named by its Content-Disposition or `fallback`. */
export async function download(response: Response, fallback: string): Promise<void> {
  const disposition = response.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallback;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * POST JSON and save the file that comes back.
 *
 * @throws ApiError with the server's message when the status is not 2xx
 */
export async function postForFile(path: string, body: unknown, fallback: string): Promise<void> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
    throw new ApiError(response.status, data.error ?? `Could not make the file (HTTP ${response.status}).`, { detail: data.detail });
  }
  await download(response, fallback);
}
