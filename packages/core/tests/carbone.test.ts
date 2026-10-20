import { createPublicKey, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  carboneError,
  carbonePublicKey,
  carbonePublicKeyEnv,
  carboneRender,
  carboneStatus,
  generateCarboneKeys,
  isCarboneError,
  probeEdition,
  signCarboneToken,
  type CarboneError,
} from "../src/carbone.js";
import { renderDocument } from "../src/render.js";

const server = { url: "http://carbone.example.com:4000/", token: () => "tkn" };
const fetchMock = vi.fn<typeof fetch>();

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const fileResponse = (body: string, type = "application/pdf") => new Response(body, { status: 200, headers: { "content-type": type } });
const w101 = (error: string) => jsonResponse(500, { success: false, error: `Unable to generate the document. Error: ${error}`, code: "w101", data: { renderId: "" } });

/** The JSON body of the n-th request. */
const sent = (n = 0): Record<string, unknown> => JSON.parse(String(fetchMock.mock.calls[n]?.[1]?.body)) as Record<string, unknown>;

async function failure(promise: Promise<unknown>): Promise<CarboneError> {
  try {
    await promise;
  } catch (error) {
    if (isCarboneError(error)) return error;
    throw error;
  }
  throw new Error("expected a CarboneError");
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("carboneRender", () => {
  it("posts the template inline with the token and returns the file", async () => {
    fetchMock.mockResolvedValueOnce(fileResponse("%PDF-1.7"));
    const out = await carboneRender(server, { template: "<html>{d.pg.a}</html>", data: { pg: { a: 1 } }, convertTo: "pdf", converter: "C" });
    expect(Buffer.from(out).toString()).toBe("%PDF-1.7");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://carbone.example.com:4000/render/template?download=true");
    expect(init?.headers).toMatchObject({ "carbone-version": "5", "content-type": "application/json", authorization: "Bearer tkn" });
    expect(sent()).toEqual({ template: Buffer.from("<html>{d.pg.a}</html>").toString("base64"), data: { pg: { a: 1 } }, convertTo: "pdf", converter: "C", lang: "en-us" });
  });

  it("checks success, not only the status: Carbone Cloud answers some errors with 200", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: false, error: "Output format not allowed with a test key", code: "w117" }));
    const error = await failure(carboneRender({ ...server, cloud: true }, { template: "x", data: {}, convertTo: "html" }));
    expect(error.kind).toBe("server");
    expect(error.detail).toBe("Output format not allowed with a test key");
  });

  it.each([
    ["The marker {d.lines[i].item} has no corresponding [i+1] for array \"lines\".", "template", /no end row\. After the row with \[i\], add a row with \[i\+1\]/],
    ['Formatter "formatDate" does not exist. Do you mean "formatD"? Source: "{d.x:formatDate}"', "template", /uses :formatDate, which Carbone does not have\. Did you mean :formatD\?/],
    ['Formatter "nope" does not exist', "template", /uses :nope, which Carbone does not have\. Check the formatter's name\./],
    ["Missing showEnd or hideEnd of these tags: {d.a:ifNEM:showBegin}", "template", /has no showEnd or hideEnd/],
    ['Formatter "aggSum" is disabled in the Community Edition. Source: "{d.v[].n:aggSum}"', "edition", /uses :aggSum, which needs Carbone Enterprise/],
    ["Something else", "template", /Its message below says where/],
  ])("maps %s to Spooldoc's own sentence", async (text, kind, message) => {
    fetchMock.mockResolvedValueOnce(w101(text));
    const error = await failure(carboneRender(server, { template: "x", data: {}, convertTo: "html" }));
    expect(error.kind).toBe(kind);
    expect(error.message).toMatch(message);
    expect(error.detail).toBe(text);
    expect(error.code).toBe("w101");
  });

  it("says a file it can't read is damaged (w118)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(415, { success: false, error: "Template format not supported", code: "w118" }));
    const error = await failure(carboneRender(server, { template: "x", data: {}, convertTo: "html" }));
    expect(error).toMatchObject({ kind: "file", status: 415 });
    expect(error.message).toMatch(/damaged, or not an HTML, Word or Excel document/);
  });

  it("says where to fix a refused token, or a refused Cloud key", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(401, { success: false, error: "Unauthorized, please provide a valid access token" }));
    expect((await failure(carboneRender(server, { template: "x", data: {}, convertTo: "html" }))).message).toMatch(/CARBONE_AUTHENTICATION_PUBLIC_KEY/);
    expect((await failure(carboneRender({ ...server, cloud: true }, { template: "x", data: {}, convertTo: "html" }))).message).toMatch(/refused the API key/);
  });

  it("says when Carbone can't be reached, or does not answer in time", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED", message: "connect ECONNREFUSED 10.0.0.9:4000" } }));
    const unreachable = await failure(carboneRender(server, { template: "x", data: {}, convertTo: "html" }));
    expect(unreachable.kind).toBe("unreachable");
    expect(unreachable.message).toBe(
      "Could not reach Carbone at http://carbone.example.com:4000/. Check that the Carbone service runs and that the URL in Settings, under Rendering, is right.",
    );
    expect(unreachable.detail).toBe("ECONNREFUSED: connect ECONNREFUSED 10.0.0.9:4000");
    fetchMock.mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"));
    expect((await failure(carboneRender({ ...server, timeoutMs: 5000 }, { template: "x", data: {}, convertTo: "html" }))).message).toMatch(/did not answer within 5 s/);
  });
});

describe("carboneStatus and probeEdition", () => {
  it("reads the version", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, code: 200, message: "OK", version: "5.15.5" }));
    expect(await carboneStatus(server)).toEqual({ version: "5.15.5" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://carbone.example.com:4000/status");
  });

  it("finds Enterprise when the aggregator renders", async () => {
    fetchMock.mockResolvedValueOnce(fileResponse("3", "text/plain"));
    expect(await probeEdition(server)).toBe("enterprise");
    expect(sent()).toMatchObject({ template: Buffer.from("{d.v[].n:aggSum}").toString("base64"), convertTo: "txt", data: { v: [{ n: 1 }, { n: 2 }] } });
  });

  it("finds Community when Carbone refuses it as a Community Edition feature", async () => {
    fetchMock.mockResolvedValueOnce(w101('Formatter "aggSum" is disabled in the Community Edition. Source: "{d.v[].n:aggSum}"'));
    expect(await probeEdition(server)).toBe("community");
  });

  it("passes on anything else, such as a refused token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { success: false, error: "Unauthorized" }));
    expect((await failure(probeEdition(server))).kind).toBe("auth");
  });
});

describe("renderDocument", () => {
  it("sends a prepared template and uses Chromium for PDF, landscape for a wide page", async () => {
    fetchMock.mockImplementation(async () => fileResponse("%PDF"));
    await renderDocument(server, { template: "<p>{asset('logo')} {d.pg.a}</p>", data: { pg: { a: 1 }, splf: {} }, format: "pdf", pageWidth: 198, asset: () => "data:,x" });
    const template = Buffer.from(String(sent().template), "base64").toString();
    expect(template).toContain("<html>");
    expect(template).toContain("data:,x {d.pg.a}");
    expect(template).toContain('<carbone-pdf-options landscape="true">');
    expect(sent()).toMatchObject({ convertTo: "pdf", converter: "C" });
    await renderDocument(server, { template: "<p>x</p>", data: { pg: {}, splf: {} }, format: "html", pageWidth: 198 });
    expect(Buffer.from(String(sent(1).template), "base64").toString()).not.toContain("landscape");
    expect(sent(1).converter).toBeUndefined();
  });

  it("sends a Word template's bytes: DOCX with hardRefresh false, PDF with ICE, or LibreOffice for PAGEREF fields", async () => {
    fetchMock.mockImplementation(async () => fileResponse("PK"));
    const template = new Uint8Array([0x50, 0x4b, 3, 4, 0xff]);
    const data = { pg: {}, splf: {} };
    await renderDocument(server, { kind: "docx", template, data, format: "docx" });
    expect(sent()).toEqual({ template: Buffer.from(template).toString("base64"), data, convertTo: "docx", hardRefresh: false, lang: "en-us" });
    await renderDocument(server, { kind: "docx", template, data, format: "pdf", converter: "I" });
    expect(sent(1)).toMatchObject({ convertTo: "pdf", converter: "I" });
    expect(sent(1).hardRefresh).toBeUndefined();
    await renderDocument(server, { kind: "docx", template, data, format: "pdf", converter: "L" });
    expect(sent(2).converter).toBe("L");
  });
});

describe("keys and tokens", () => {
  it("signs an ES512 token for carbone-ee that always expires", () => {
    const { privateKey, publicKey } = generateCarboneKeys();
    expect(carbonePublicKey(privateKey)).toBe(publicKey);
    const token = signCarboneToken(privateKey, 300, Date.UTC(2026, 9, 19));
    const [head, claims, signature] = token.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(head, "base64url").toString())).toEqual({ alg: "ES512", typ: "JWT" });
    const iat = Date.UTC(2026, 9, 19) / 1000;
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({ iss: "spooldoc", aud: "carbone-ee", iat, exp: iat + 300 });
    const ok = verify("sha512", Buffer.from(`${head}.${claims}`), { key: createPublicKey(publicKey), dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
    expect(ok).toBe(true);
  });

  it("writes the public key on one line, with \\n for each newline", () => {
    const env = carbonePublicKeyEnv("-----BEGIN PUBLIC KEY-----\nABC\nDEF\n-----END PUBLIC KEY-----\n");
    expect(env).toBe("-----BEGIN PUBLIC KEY-----\\nABC\\nDEF\\n-----END PUBLIC KEY-----");
  });

  it("trims trailing slashes from the URL, however many", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, version: "5.15.5" }));
    await carboneStatus({ url: `http://carbone.example.com${"/".repeat(100_000)}` });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://carbone.example.com/status");
  });

  it("maps a status code alone", () => {
    expect(carboneError(429, undefined, "Too many requests", server).message).toMatch(/busy/);
    expect(carboneError(502, undefined, "Bad gateway", server).message).toBe("Carbone could not render the document (HTTP 502).");
  });
});
