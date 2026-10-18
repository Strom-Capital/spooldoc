import 'server-only';

type PdfModule = typeof import('@spooldoc/core/pdf');

/**
 * `@spooldoc/core/pdf`, loaded by Node rather than bundled, so its lazy import of
 * playwright-core resolves from the package's own location.
 */
export async function loadPdf(): Promise<PdfModule> {
  return (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ '@spooldoc/core/pdf')) as PdfModule;
}

/** True when PDFs can be rendered: playwright-core and SPOOLDOC_CHROMIUM_PATH are there. */
export async function pdfAvailable(): Promise<boolean> {
  try {
    return await (await loadPdf()).pdfAvailable();
  } catch {
    return false;
  }
}

/** A failed PDF render as an HTTP status and message: 501 without Chromium, 504 on timeout, else 500. */
export function pdfErrorStatus(error: unknown): { status: number; message: string } {
  const message = error instanceof Error ? error.message.split('\n')[0]! : 'PDF rendering failed';
  if (error instanceof Error && error.name === 'PdfUnavailableError') {
    return { status: 501, message };
  }
  if (error instanceof Error && error.name === 'PdfTimeoutError') {
    return { status: 504, message };
  }
  return { status: 500, message: `PDF rendering failed: ${message}` };
}
