import { describe, expect, it } from "vitest";
import { JobSignatureHasher } from "../../src/cloudflare/job-signature.hasher.js";

const SECRET = "s3cret";
const NOW = 1_800_000_000_000;

describe("JobSignatureHasher", () => {
  it("accepts what it signed", () => {
    const signature = JobSignatureHasher.sign(SECRET, NOW, '{"a":1}');

    expect(JobSignatureHasher.verify(SECRET, String(NOW), signature, '{"a":1}', NOW)).toBe(true);
  });

  it("refuses a changed body, a wrong secret and a missing header", () => {
    const signature = JobSignatureHasher.sign(SECRET, NOW, '{"a":1}');

    expect(JobSignatureHasher.verify(SECRET, String(NOW), signature, '{"a":2}', NOW)).toBe(false);
    expect(JobSignatureHasher.verify("other", String(NOW), signature, '{"a":1}', NOW)).toBe(false);
    expect(JobSignatureHasher.verify(SECRET, null, signature, '{"a":1}', NOW)).toBe(false);
    expect(JobSignatureHasher.verify(SECRET, String(NOW), null, '{"a":1}', NOW)).toBe(false);
  });

  // A captured request must stop working, or the signature is a password sent in clear.
  it("refuses a timestamp outside the window", () => {
    const old = NOW - JobSignatureHasher.WINDOW_MS - 1;
    const signature = JobSignatureHasher.sign(SECRET, old, "{}");

    expect(JobSignatureHasher.verify(SECRET, String(old), signature, "{}", NOW)).toBe(false);
  });

  it("refuses a malformed timestamp rather than throwing", () => {
    expect(JobSignatureHasher.verify(SECRET, "soon", "v1=00", "{}", NOW)).toBe(false);
  });
});
