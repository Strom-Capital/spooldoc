/** Thrown when PDF rendering is not available: playwright-core or the Chromium executable is missing. */
export class PdfUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfUnavailableError";
  }
}

/** Options for `renderPdf`. */
export interface PdfOptions {
  format?: "A4" | "Letter";
  landscape?: boolean;
}

interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
  isConnected(): boolean;
}
interface PageLike {
  setContent(html: string, options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" }): Promise<void>;
  pdf(options: { format?: string; landscape?: boolean; printBackground?: boolean; preferCSSPageSize?: boolean }): Promise<Uint8Array>;
  close(): Promise<void>;
}
interface PlaywrightLike {
  chromium: { launch(options: { executablePath: string; headless: boolean }): Promise<BrowserLike> };
}

interface BrowserCache {
  browser: Promise<BrowserLike> | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const IDLE_MS = 60_000;
const KEY = Symbol.for("spooldoc.pdf.browser");
const cache = ((globalThis as Record<symbol, unknown>)[KEY] ??= { browser: null, timer: null }) as BrowserCache;

async function loadPlaywright(): Promise<PlaywrightLike> {
  try {
    const name = "playwright-core";
    return (await import(name)) as PlaywrightLike;
  } catch {
    throw new PdfUnavailableError("playwright-core is not installed. Install it to render PDFs.");
  }
}

async function executablePath(): Promise<string> {
  const path = process.env.SPOOLDOC_CHROMIUM_PATH;
  if (!path) throw new PdfUnavailableError("SPOOLDOC_CHROMIUM_PATH is not set. Point it at a Chromium or Chrome executable.");
  const { access } = await import("node:fs/promises");
  try {
    await access(path);
  } catch {
    throw new PdfUnavailableError(`Chromium executable not found at SPOOLDOC_CHROMIUM_PATH (${path}).`);
  }
  return path;
}

async function browser(): Promise<BrowserLike> {
  if (cache.browser) {
    const b = await cache.browser.catch(() => null);
    if (b?.isConnected()) return b;
    cache.browser = null;
  }
  const pw = await loadPlaywright();
  const exe = await executablePath();
  cache.browser = pw.chromium.launch({ executablePath: exe, headless: true });
  return cache.browser;
}

function scheduleClose(): void {
  if (cache.timer) clearTimeout(cache.timer);
  cache.timer = setTimeout(() => {
    const b = cache.browser;
    cache.browser = null;
    cache.timer = null;
    void b?.then((x) => x.close()).catch(() => undefined);
  }, IDLE_MS);
  cache.timer.unref?.();
}

/** Closes the cached browser now, if one is open. */
export async function closePdfBrowser(): Promise<void> {
  if (cache.timer) clearTimeout(cache.timer);
  cache.timer = null;
  const b = cache.browser;
  cache.browser = null;
  if (b) await (await b.catch(() => null))?.close();
}

/**
 * Renders HTML to PDF with headless Chromium (playwright-core, loaded lazily) from
 * `SPOOLDOC_CHROMIUM_PATH`. The browser is reused and closed after 60 s idle.
 * Throws `PdfUnavailableError` when playwright-core or the executable is missing.
 */
export async function renderPdf(html: string, options: PdfOptions = {}): Promise<Uint8Array> {
  const b = await browser();
  if (cache.timer) clearTimeout(cache.timer);
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: options.format ?? "A4",
      landscape: options.landscape ?? false,
      printBackground: true,
      preferCSSPageSize: true,
    });
    return new Uint8Array(pdf);
  } finally {
    await page.close().catch(() => undefined);
    scheduleClose();
  }
}

/** True when playwright-core can be loaded and `SPOOLDOC_CHROMIUM_PATH` points at a file. */
export async function pdfAvailable(): Promise<boolean> {
  try {
    await loadPlaywright();
    await executablePath();
    return true;
  } catch {
    return false;
  }
}
