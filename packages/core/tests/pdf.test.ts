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
});

describe("pdfAvailable", () => {
  it("returns a boolean without throwing", async () => {
    expect(typeof (await pdfAvailable())).toBe("boolean");
  });
});
