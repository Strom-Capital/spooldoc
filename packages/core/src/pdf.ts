/** Thrown when PDF rendering is not available: playwright-core or the Chromium executable is missing. */
export class PdfUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfUnavailableError";
  }
}

/** Thrown when a render takes longer than the timeout. */
export class PdfTimeoutError extends Error {
  constructor(ms: number) {
    super(`PDF rendering did not finish within ${Math.round(ms / 1000)} s.`);
    this.name = "PdfTimeoutError";
  }
}

/** Options for `renderPdf`. */
export interface PdfOptions {
  format?: "A4" | "Letter";
  landscape?: boolean;
  /** Milliseconds before the render fails with `PdfTimeoutError`. Default 30 000. */
  timeoutMs?: number;
}

interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
  isConnected(): boolean;
}
interface PageLike {
  setContent(html: string, options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number }): Promise<void>;
  pdf(options: { format?: string; landscape?: boolean; printBackground?: boolean; preferCSSPageSize?: boolean }): Promise<Uint8Array>;
  close(): Promise<void>;
  route(url: (url: URL) => boolean, handler: (route: { abort(): Promise<void> }) => Promise<void>): Promise<void>;
}
interface PlaywrightLike {
  chromium: { launch(options: { executablePath: string; headless: boolean; timeout?: number; args?: string[] }): Promise<BrowserLike> };
}

interface BrowserCache {
  /** The running or launching browser. One launch is shared by parallel callers. */
  browser: Promise<BrowserLike> | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** Renders in progress; the idle timer only runs when this is 0. */
  active: number;
  /** `pdfAvailable` results per executable path. */
  available: Map<string, Promise<boolean>>;
}

const IDLE_MS = 60_000;
const TIMEOUT_MS = 30_000;
const KEY = Symbol.for("spooldoc.pdf.browser");
const cache = ((globalThis as Record<symbol, unknown>)[KEY] ??= {
  browser: null,
  timer: null,
  active: 0,
  available: new Map(),
}) as BrowserCache;

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
  const { access, constants } = await import("node:fs/promises");
  try {
    await access(path, constants.X_OK);
  } catch {
    throw new PdfUnavailableError(`Chromium executable not found at SPOOLDOC_CHROMIUM_PATH (${path}).`);
  }
  return path;
}

async function launch(): Promise<BrowserLike> {
  const pw = await loadPlaywright();
  const exe = await executablePath();
  return pw.chromium.launch({ executablePath: exe, headless: true, timeout: TIMEOUT_MS, args: ["--no-first-run", "--disable-gpu"] });
}

async function browser(): Promise<BrowserLike> {
  for (let current = cache.browser; current; current = cache.browser) {
    const b = await current.catch(() => null);
    if (b?.isConnected()) return b;
    // A failed launch or a closed browser: forget it, unless another caller already replaced it.
    if (cache.browser === current) cache.browser = null;
  }
  const launching = launch();
  cache.browser = launching;
  launching.catch(() => {
    if (cache.browser === launching) cache.browser = null;
  });
  return launching;
}

function scheduleClose(): void {
  if (cache.timer) clearTimeout(cache.timer);
  cache.timer = null;
  if (cache.active > 0 || !cache.browser) return;
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
 * `SPOOLDOC_CHROMIUM_PATH`. One browser per process: parallel calls share one launch,
 * and it closes after 60 s idle. A `@page { size }` in the HTML wins over `format`.
 * Throws `PdfUnavailableError` when playwright-core or the executable is missing and
 * `PdfTimeoutError` after `timeoutMs` (30 s).
 */
export async function renderPdf(html: string, options: PdfOptions = {}): Promise<Uint8Array> {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  cache.active++;
  if (cache.timer) clearTimeout(cache.timer);
  cache.timer = null;
  let page: PageLike | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PdfTimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    const work = (async () => {
      const b = await browser();
      page = await b.newPage();
      // No network: a template is local HTML, so every request it would make is refused.
      await page.route(() => true, (route) => route.abort());
      await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
      return page.pdf({
        format: options.format ?? "A4",
        landscape: options.landscape ?? false,
        printBackground: true,
        preferCSSPageSize: true,
      });
    })();
    // The page closes when the work settles, also after a timeout.
    void work.then(
      () => page?.close().catch(() => undefined),
      () => page?.close().catch(() => undefined),
    );
    return new Uint8Array(await Promise.race([work, timeout]));
  } finally {
    clearTimeout(timer);
    cache.active--;
    scheduleClose();
  }
}

/**
 * True when playwright-core can be loaded and `SPOOLDOC_CHROMIUM_PATH` points at an
 * executable file. The answer is cached for the process (per path).
 */
export async function pdfAvailable(): Promise<boolean> {
  const key = process.env.SPOOLDOC_CHROMIUM_PATH ?? "";
  let result = cache.available.get(key);
  if (!result) {
    result = (async () => {
      try {
        await loadPlaywright();
        await executablePath();
        return true;
      } catch {
        return false;
      }
    })();
    cache.available.set(key, result);
  }
  return result;
}
