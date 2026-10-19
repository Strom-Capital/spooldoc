import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";

/** What a Carbone server is: Enterprise or Community on-prem (from the probe), or Carbone Cloud. */
export type CarboneEdition = "enterprise" | "community" | "cloud";

/** The URL of Carbone Cloud. */
export const CARBONE_CLOUD_URL = "https://api.carbone.io";

/** How Spooldoc reaches a Carbone server. */
export interface CarboneServer {
  /** Base URL, such as `http://carbone:4000` or `https://api.carbone.io`. */
  url: string;
  /** The bearer token for each request: a fresh JWT on-prem, the API key on Carbone Cloud. */
  token?: () => string;
  /** Carbone Cloud: errors talk about the API key, not a token. */
  cloud?: boolean;
  /** Milliseconds before a request fails. Default 30 000. */
  timeoutMs?: number;
}

/** What went wrong, so callers can tell a server problem from a template problem. */
export type CarboneErrorKind = "unreachable" | "timeout" | "auth" | "template" | "file" | "edition" | "server";

/**
 * A Carbone request that failed. `message` says what went wrong and what to do;
 * `detail` is Carbone's own text, for support.
 */
export class CarboneError extends Error {
  readonly kind: CarboneErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;

  constructor(kind: CarboneErrorKind, message: string, info: { status?: number; code?: string; detail?: string } = {}) {
    super(message);
    this.name = "CarboneError";
    this.kind = kind;
    if (info.status !== undefined) this.status = info.status;
    if (info.code !== undefined) this.code = info.code;
    if (info.detail) this.detail = info.detail;
  }
}

/** True for a `CarboneError`, also one from another copy of this module. */
export function isCarboneError(error: unknown): error is CarboneError {
  return error instanceof Error && error.name === "CarboneError" && typeof (error as CarboneError).kind === "string";
}

const TIMEOUT_MS = 30_000;

/** The part of Carbone's error text worth reading: after "Unable to generate the document. Error: ". */
function carboneText(error: string): string {
  return error.replace(/^Unable to generate the document\.\s*(Error:\s*)?/i, "").trim() || error;
}

/**
 * Spooldoc's own sentence for a Carbone error, from its HTTP status, code (`w101`,
 * `w118`, ...) and text. Carbone's text stays in `detail`.
 */
export function carboneError(status: number, code: string | undefined, error: string, server: Pick<CarboneServer, "url" | "cloud">): CarboneError {
  const text = carboneText(error);
  const info = { status, ...(code ? { code } : {}), detail: text };
  if (status === 401 || status === 403) {
    return new CarboneError(
      "auth",
      server.cloud
        ? "Carbone Cloud refused the API key. Check the key in Settings, under Rendering."
        : "Carbone refused Spooldoc's token. Set CARBONE_AUTHENTICATION_PUBLIC_KEY on the Carbone service to the public key in Settings, under Rendering, and restart Carbone.",
      info,
    );
  }
  if (status === 429) {
    return new CarboneError("server", "Carbone is busy and asked Spooldoc to wait (HTTP 429). Try again in a minute.", info);
  }
  const community = /Formatter "([^"]+)" is disabled in the Community Edition/i.exec(text);
  if (community) {
    return new CarboneError(
      "edition",
      `The template uses :${community[1]}, which needs Carbone Enterprise. This Carbone server runs the Community Edition. Remove it from the template, or use a server with an Enterprise licence.`,
      info,
    );
  }
  if (/disabled in the Community Edition/i.test(text)) {
    return new CarboneError("edition", "The template uses a feature that needs Carbone Enterprise. This Carbone server runs the Community Edition.", info);
  }
  if (/no corresponding \[i\+1\]/i.test(text)) {
    return new CarboneError(
      "template",
      "A loop in the template has no end row. After the row with [i], add a row with [i+1], such as <tr><td>{d.doc.lines[i+1]}</td></tr>.",
      info,
    );
  }
  const unknown = /Formatter "([^"]+)" does not exist(?:\. Do you mean "([^"]+)"\?)?/i.exec(text);
  if (unknown) {
    return new CarboneError(
      "template",
      unknown[2]
        ? `The template uses :${unknown[1]}, which Carbone does not have. Did you mean :${unknown[2]}?`
        : `The template uses :${unknown[1]}, which Carbone does not have. Check the formatter's name.`,
      info,
    );
  }
  if (/does not exist\. Do you mean/i.test(text)) {
    return new CarboneError("template", "The template uses a name Carbone does not know. Check the spelling; Carbone's text below suggests one.", info);
  }
  if (/Missing showEnd|Missing (showEnd or )?hideEnd/i.test(text)) {
    return new CarboneError("template", "A showBegin or hideBegin in the template has no showEnd or hideEnd. Add the end tag after the part to show or hide.", info);
  }
  if (code === "w118" || status === 415) {
    return new CarboneError("file", "Carbone could not read the template. It is damaged or not an HTML document. Save it again.", info);
  }
  if (status >= 500 && /Document converter|converter .*unavailable/i.test(text)) {
    return new CarboneError("server", "Carbone could not convert the document. Check that the Carbone service has its converters (the full image).", info);
  }
  if (code === "w101") {
    return new CarboneError("template", "Carbone could not render the template. Its message below says where.", info);
  }
  return new CarboneError("server", `Carbone could not render the document (HTTP ${status}).`, info);
}

/** A failed `fetch`: the server can't be reached, or it did not answer in time. */
function networkError(error: unknown, server: CarboneServer, timeoutMs: number): CarboneError {
  const err = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return new CarboneError("timeout", `Carbone at ${server.url} did not answer within ${Math.round(timeoutMs / 1000)} s. Check that the service runs and is not overloaded.`);
  }
  const detail = [err?.cause?.code, err?.cause?.message ?? err?.message].filter(Boolean).join(": ");
  return new CarboneError(
    "unreachable",
    server.cloud
      ? `Could not reach Carbone Cloud at ${server.url}. Check that the Spooldoc server can reach the internet.`
      : `Could not reach Carbone at ${server.url}. Check that the Carbone service runs and that the URL in Settings, under Rendering, is right.`,
    detail ? { detail } : {},
  );
}

function headers(server: CarboneServer, json: boolean): Record<string, string> {
  const out: Record<string, string> = { "carbone-version": "5" };
  if (json) out["content-type"] = "application/json";
  const token = server.token?.();
  if (token) out.authorization = `Bearer ${token}`;
  return out;
}

const base = (server: CarboneServer): string => server.url.replace(/\/+$/, "");

async function request(server: CarboneServer, path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<Response> {
  const timeoutMs = server.timeoutMs ?? TIMEOUT_MS;
  try {
    return await fetch(`${base(server)}${path}`, {
      method: init.method,
      headers: headers(server, init.body !== undefined),
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch (error) {
    throw networkError(error, server, timeoutMs);
  }
}

/** The JSON of a response, or undefined when it is not JSON. */
async function jsonOf(response: Response): Promise<Record<string, unknown> | undefined> {
  if (!(response.headers.get("content-type") ?? "").includes("json")) return undefined;
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** The version of a Carbone server, from `GET /status`. */
export async function carboneStatus(server: CarboneServer): Promise<{ version: string }> {
  const response = await request(server, "/status", { method: "GET" });
  const body = await jsonOf(response);
  if (!response.ok || !body || body.success === false) {
    throw carboneError(response.status, typeof body?.code === "string" ? body.code : undefined, typeof body?.error === "string" ? body.error : response.statusText, server);
  }
  return { version: typeof body.version === "string" ? body.version : "unknown" };
}

/** A render: the template text, the data (`d` in tags) and the format to make. */
export interface CarboneRenderRequest {
  template: string;
  data: unknown;
  convertTo: "html" | "pdf" | "txt";
  /** `C` (Chromium) for HTML to PDF. */
  converter?: "C" | "L" | "O" | "I";
  /** Separators for `:formatN` and names in `:formatD`. Default `en-us`. */
  lang?: string;
}

/**
 * Renders a template inline (`POST /render/template?download=true`): nothing stays on
 * the Carbone server. Checks `success` as well as the HTTP status, since Carbone Cloud
 * answers some errors with 200.
 *
 * @returns The rendered file
 * @throws CarboneError with Spooldoc's message and Carbone's text in `detail`
 */
export async function carboneRender(server: CarboneServer, input: CarboneRenderRequest): Promise<Uint8Array> {
  const response = await request(server, "/render/template?download=true", {
    method: "POST",
    body: {
      template: Buffer.from(input.template, "utf8").toString("base64"),
      data: input.data,
      convertTo: input.convertTo,
      ...(input.converter ? { converter: input.converter } : {}),
      lang: input.lang ?? "en-us",
    },
  });
  const body = await jsonOf(response);
  if (body) {
    if (body.success === false || !response.ok) {
      throw carboneError(response.status, typeof body.code === "string" ? body.code : undefined, typeof body.error === "string" ? body.error : JSON.stringify(body), server);
    }
    // A JSON answer to a download is not a file.
    throw new CarboneError("server", "Carbone answered with JSON instead of a file. Check the Carbone version.", { status: response.status, detail: JSON.stringify(body).slice(0, 500) });
  }
  if (!response.ok) {
    const text = (await response.text().catch(() => "")).slice(0, 500);
    throw carboneError(response.status, undefined, text || response.statusText, server);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** The probe template: an aggregator, which the Community Edition refuses. */
const PROBE = { template: "{d.v[].n:aggSum}", data: { v: [{ n: 1 }, { n: 2 }] } };

/**
 * Which edition an on-prem server runs. `/status` does not say, so this renders a
 * one-line TXT template with `:aggSum`: Enterprise renders it, Community refuses it with
 * "disabled in the Community Edition". A licence Carbone rejects looks the same as no
 * licence. Don't probe Carbone Cloud: each probe counts as a document there.
 *
 * @throws CarboneError for anything else, such as a refused token
 */
export async function probeEdition(server: CarboneServer): Promise<"enterprise" | "community"> {
  try {
    const out = Buffer.from(await carboneRender(server, { ...PROBE, convertTo: "txt" })).toString("utf8").trim();
    if (out === "3") return "enterprise";
    throw new CarboneError("server", "Carbone gave an unexpected answer to Spooldoc's edition check.", { detail: out.slice(0, 200) });
  } catch (error) {
    if (isCarboneError(error) && error.kind === "edition") return "community";
    throw error;
  }
}

/** A new ES512 key pair as PEM: the private key signs Spooldoc's tokens, Carbone checks them with the public key. */
export function generateCarboneKeys(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp521r1" });
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/** The public key of a private key, as PEM. */
export function carbonePublicKey(privateKeyPem: string): string {
  return createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "pem" }).toString();
}

/**
 * The public key as `CARBONE_AUTHENTICATION_PUBLIC_KEY` needs it: one line, with its
 * newlines written as `\n`. A real newline or a JSON string makes Carbone exit at start.
 */
export function carbonePublicKeyEnv(publicKeyPem: string): string {
  return publicKeyPem.trim().replace(/\r?\n/g, "\\n");
}

const b64url = (value: string | Buffer): string => Buffer.from(value).toString("base64url");

/**
 * A short-lived JWT for Carbone's `CARBONE_AUTHENTICATION`: ES512, `aud: "carbone-ee"`,
 * always with `exp` (Carbone accepts a token without one).
 *
 * @param privateKeyPem - Spooldoc's private key
 * @param lifetimeSeconds - Default 300
 */
export function signCarboneToken(privateKeyPem: string, lifetimeSeconds = 300, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: "ES512", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: "spooldoc", aud: "carbone-ee", iat, exp: iat + lifetimeSeconds }));
  const signature = sign("sha512", Buffer.from(`${head}.${claims}`), { key: privateKeyPem, dsaEncoding: "ieee-p1363" });
  return `${head}.${claims}.${b64url(signature)}`;
}
