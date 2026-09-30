import { afterAll, describe, expect, inject, it } from "vitest";
import { S3StorageGateway, StorageKey } from "../../src/s3/index.js";
import type {} from "./support/stack.js";

const storage = new S3StorageGateway(inject("stack").storage);

const keys: string[] = [];

const probe = () => {
  const key = StorageKey.build("smoke", `probe-${Date.now()}.txt`, new Date());
  keys.push(key);
  return key;
};

afterAll(async () => {
  for (const key of keys) await storage.delete(key);
});

describe("S3StorageGateway against the running object store", () => {
  it("writes, reads back the same bytes, and reports the object gone once deleted", async () => {
    const key = probe();

    const stored = await storage.put(key, new TextEncoder().encode("hello"), "text/plain");

    expect(new TextDecoder().decode(await storage.get(key))).toBe("hello");
    expect(await storage.exists(key)).toBe(true);
    // The SHA-256 of "hello", so a checksum computed over the wrong bytes — or over the
    // encoded body rather than the payload — fails here rather than at a verification.
    expect(stored.checksum).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  // The two methods nothing else in the repository exercises: the browser uploads and
  // downloads directly, so a URL that is wrong is wrong in the browser and nowhere else.
  it("signs a download URL that fetches the object without credentials", async () => {
    const key = probe();
    await storage.put(key, new TextEncoder().encode("signed"), "text/plain");

    const url = await storage.presignDownload(key, 60);
    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("signed");
  });

  it("signs an upload URL that accepts a PUT of the content type it was signed for", async () => {
    const key = probe();

    const url = await storage.presignUpload(key, "text/plain", 60);
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: "uploaded",
    });

    expect(response.ok).toBe(true);
    expect(new TextDecoder().decode(await storage.get(key))).toBe("uploaded");
  });

  it("signs a URL that expires, and says so in the query it carries", async () => {
    const key = probe();

    const url = new URL(await storage.presignDownload(key, 60));

    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    // Signed, not a bare object URL: a gateway that returned the plain path would pass
    // the fetch above against a public bucket and leak every object.
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });
});
