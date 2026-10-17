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
