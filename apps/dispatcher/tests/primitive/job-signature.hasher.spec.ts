import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { JobSignatureHasher } from "../../src/primitive/index.js";

const NOW = 1_800_000_000_000;

describe("JobSignatureHasher (WebCrypto)", () => {
  // The web app signs with `node:crypto`. The two must agree byte for byte, or every
  // request between them is a 401.
  it("produces what node:crypto produces", async () => {
    const expected = `v1=${createHmac("sha256", "k").update(`${NOW}.{}`).digest("hex")}`;

    expect(await JobSignatureHasher.sign("k", NOW, "{}")).toBe(expected);
  });

  it("verifies its own signature and refuses a changed body or a stale timestamp", async () => {
    const signature = await JobSignatureHasher.sign("k", NOW, "{}");

    expect(await JobSignatureHasher.verify("k", String(NOW), signature, "{}", NOW)).toBe(true);
    expect(await JobSignatureHasher.verify("k", String(NOW), signature, "[]", NOW)).toBe(false);
    expect(
      await JobSignatureHasher.verify(
        "k",
        String(NOW),
        signature,
        "{}",
        NOW + JobSignatureHasher.WINDOW_MS + 1,
      ),
    ).toBe(false);
  });
});
