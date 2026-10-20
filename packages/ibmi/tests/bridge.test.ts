import { describe, expect, it } from "vitest";
import { writeAllAsync, type JavaModule } from "../src/jt400/bridge.js";

interface FakeBuffer {
  bytes: Buffer;
  hasRemainingSync(): boolean;
  done(): void;
}

/** A stand-in for the Java side: Latin-1 strings become buffers, and the channel collects them. */
function fakeJava() {
  const chunks: Buffer[] = [];
  let flushed = false;
  const java: JavaModule = {
    import: () =>
      class {
        flush = async () => {
          flushed = true;
        };
      },
    newArray: () => undefined,
    callStaticMethodSync: (_className: string, method: string) => {
      if (method === "forName") {
        return {
          encodeSync: (text: string): FakeBuffer => {
            let left = true;
            return { bytes: Buffer.from(text, "latin1"), hasRemainingSync: () => left, done: () => (left = false) };
          },
        };
      }
      return {
        write: async (chunk: FakeBuffer) => {
          chunks.push(chunk.bytes);
          chunk.done();
        },
      };
    },
  };
  return { java, chunks, flushed: () => flushed };
}

describe("writeAllAsync", () => {
  it("hands every byte to Java unchanged, in chunks, and flushes", async () => {
    const fake = fakeJava();
    const bytes = new Uint8Array(2.5 * 1024 * 1024).map((_, i) => (i * 31 + (i >> 8)) & 0xff);
    await writeAllAsync(fake.java, {}, bytes);
    expect(fake.chunks).toHaveLength(3);
    expect(Buffer.compare(Buffer.concat(fake.chunks), bytes)).toBe(0);
    expect(fake.flushed()).toBe(true);
  });
});
