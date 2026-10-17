import { encoderFor } from "../../src/ebcdic.js";

/** Builds *SCS byte streams for parser tests: text in a chosen code page plus control bytes. */
export class ScsBuilder {
  private readonly bytes: number[] = [];
  private readonly encode: (text: string) => Uint8Array;

  constructor(codePage = 273) {
    this.encode = encoderFor(codePage);
  }

  text(s: string): this {
    this.bytes.push(...this.encode(s));
    return this;
  }
  raw(...b: number[]): this {
    this.bytes.push(...b);
    return this;
  }
  /** Form feed (0x0C). */
  ff(): this {
    return this.raw(0x0c);
  }
  /** New line (0x15). */
  nl(count = 1): this {
    for (let i = 0; i < count; i++) this.raw(0x15);
    return this;
  }
  /** Line feed (0x25), keeps the column. */
  lf(): this {
    return this.raw(0x25);
  }
  /** Carriage return (0x0D). */
  cr(): this {
    return this.raw(0x0d);
  }
  /** Horizontal tab (0x05). */
  tab(): this {
    return this.raw(0x05);
  }
  /** Backspace (0x16). */
  bs(): this {
    return this.raw(0x16);
  }
  /** Absolute horizontal position (34 C0 n). */
  col(n: number): this {
    return this.raw(0x34, 0xc0, n);
  }
  /** Relative horizontal position (34 C8 n). */
  right(n: number): this {
    return this.raw(0x34, 0xc8, n);
  }
  /** Absolute vertical position (34 C4 n). */
  line(n: number): this {
    return this.raw(0x34, 0xc4, n);
  }
  /** Relative vertical position (34 4C n). */
  down(n: number): this {
    return this.raw(0x34, 0x4c, n);
  }
  /** A 2B class/length control with parameters (length counts itself and the parameters). */
  ctl(cls: number, ...params: number[]): this {
    return this.raw(0x2b, cls, params.length + 1, ...params);
  }
  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}
