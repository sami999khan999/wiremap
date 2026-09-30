import { describe, expect, it } from "vitest";
import { ByteFormat } from "../../src/format/byte-format.js";

describe("ByteFormat", () => {
  it("shows whole bytes below a kilobyte", () => {
    expect(ByteFormat.size(0)).toBe("0 B");
    expect(ByteFormat.size(1023)).toBe("1023 B");
  });

  it("steps in binary multiples", () => {
    expect(ByteFormat.size(1024)).toBe("1.0 KB");
    expect(ByteFormat.size(1536)).toBe("1.5 KB");
    expect(ByteFormat.size(1024 ** 3)).toBe("1.0 GB");
  });

  // Stops at the largest unit rather than running off the end of the table, which is
  // what an index past the last entry would do — `undefined` in the string.
  it("clamps at petabytes", () => {
    expect(ByteFormat.size(1024 ** 6)).toBe("1024.0 PB");
  });

  // A byte count is never negative, and a sum over an empty group can arrive as one.
  it("treats a negative as zero", () => {
    expect(ByteFormat.size(-5)).toBe("0 B");
  });
});
