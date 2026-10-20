import type { z } from "zod";

/**
 * What Word and Excel designs share: the images a design places by name, and the error
 * that lists every problem of a design with its path.
 */

/** An image a design can place by name: an uploaded PNG or JPEG asset. */
export interface DesignImage {
  data: Uint8Array;
  type: "png" | "jpg";
  /** Size in pixels. */
  width: number;
  height: number;
}

/** Why a design could not be built: each problem with the path of the node or key it is about. */
export class DesignError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
    this.name = "DesignError";
  }
}

/** Where a node or key is in a design: keys and array indices. */
export type Path = (string | number)[];

/** A path as text: `sheets[0].cells[12].style`. */
export const pathText = (path: Path): string =>
  path.reduce<string>((text, part) => (typeof part === "number" ? `${text}[${part}]` : text ? `${text}.${part}` : part), "") || "(the document)";

/** A zod issue as a problem's message: unknown keys named, others as zod says them. */
export function issueMessage(issue: z.core.$ZodIssue): string {
  return issue.code === "unrecognized_keys" ? `Unknown key${issue.keys.length > 1 ? "s" : ""} ${issue.keys.map((k) => `"${k}"`).join(", ")}` : issue.message;
}

/**
 * The size in pixels and type of a PNG or JPEG image, from its bytes, or null for
 * anything else or a file too short to say.
 */
export function imageInfo(bytes: Uint8Array): { type: "png" | "jpg"; width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { type: "png", width, height } : null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    // Walk the markers to the first start-of-frame, which holds the size.
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1]!;
      const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (bytes[at + 5]! << 8) | bytes[at + 6]!;
        const width = (bytes[at + 7]! << 8) | bytes[at + 8]!;
        return width > 0 && height > 0 ? { type: "jpg", width, height } : null;
      }
      at += 2 + length;
    }
  }
  return null;
}
