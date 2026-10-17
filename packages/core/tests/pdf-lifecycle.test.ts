import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const launches = vi.fn();
let delayMs = 0;

vi.mock("playwright-core", () => ({
  chromium: {
    launch: async (options: unknown) => {
      launches(options);
      await new Promise((r) => setTimeout(r, 5));
      let connected = true;
      return {
        isConnected: () => connected,
        close: async () => {
          connected = false;
        },
        newPage: async () => ({
          route: async () => undefined,
          setContent: async () => {
            if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
          },
          pdf: async () => new TextEncoder().encode("%PDF-1.4 fake"),
          close: async () => undefined,
        }),
      };
    },
  },
}));

const { closePdfBrowser, pdfAvailable, renderPdf, PdfTimeoutError, PdfUnavailableError } = await import("../src/pdf.js");

describe("renderPdf browser lifecycle (mocked playwright-core)", () => {
  const saved = process.env.SPOOLDOC_CHROMIUM_PATH;
  beforeEach(async () => {
    await closePdfBrowser();
    launches.mockClear();
    delayMs = 0;
    // Any executable file passes the availability check; the launch itself is mocked.
    process.env.SPOOLDOC_CHROMIUM_PATH = process.execPath;
  });
  afterEach(async () => {
    vi.useRealTimers();
    await closePdfBrowser();
    if (saved === undefined) delete process.env.SPOOLDOC_CHROMIUM_PATH;
    else process.env.SPOOLDOC_CHROMIUM_PATH = saved;
  });

  it("launches one browser for parallel renders and reuses it", async () => {
    const [a, b] = await Promise.all([renderPdf("<p>a</p>"), renderPdf("<p>b</p>")]);
    await renderPdf("<p>c</p>");
    expect(new TextDecoder().decode(a.subarray(0, 4))).toBe("%PDF");
    expect(b.length).toBe(a.length);
    expect(launches).toHaveBeenCalledTimes(1);
  });

  it("closes the browser after 60 s idle and relaunches on demand", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    await renderPdf("<p>a</p>");
    await vi.advanceTimersByTimeAsync(59_000);
    await renderPdf("<p>b</p>");
    expect(launches).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(61_000);
    await renderPdf("<p>c</p>");
    expect(launches).toHaveBeenCalledTimes(2);
  });

  it("fails with PdfTimeoutError when a render takes too long", async () => {
    delayMs = 200;
    await expect(renderPdf("<p>slow</p>", { timeoutMs: 50 })).rejects.toBeInstanceOf(PdfTimeoutError);
  });

  it("throws PdfUnavailableError when the executable is missing", async () => {
    process.env.SPOOLDOC_CHROMIUM_PATH = "/nonexistent/chromium";
    await expect(renderPdf("<p>x</p>")).rejects.toBeInstanceOf(PdfUnavailableError);
    expect(await pdfAvailable()).toBe(false);
    process.env.SPOOLDOC_CHROMIUM_PATH = process.execPath;
    expect(await pdfAvailable()).toBe(true);
  });
});
