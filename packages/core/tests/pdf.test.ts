import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { closePdfBrowser, pdfAvailable, renderPdf } from "../src/pdf.js";

const enabled = Boolean(process.env.SPOOLDOC_CHROMIUM_PATH);

describe.skipIf(!enabled)("renderPdf", () => {
  afterAll(async () => {
    await closePdfBrowser();
  });

  it("renders a PDF", async () => {
    expect(await pdfAvailable()).toBe(true);
    const pdf = await renderPdf("<html><body><h1>Hello</h1></body></html>");
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
  });

  it("makes no network requests for the document", async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.end("x");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const pdf = await renderPdf(`<html><body><img src="http://127.0.0.1:${port}/a.png"><link rel="stylesheet" href="http://127.0.0.1:${port}/s.css">Hi</body></html>`);
      expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });
});

describe("pdfAvailable", () => {
  it("returns a boolean without throwing", async () => {
    expect(typeof (await pdfAvailable())).toBe("boolean");
  });
});
