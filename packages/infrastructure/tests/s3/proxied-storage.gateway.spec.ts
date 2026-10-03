import { describe, expect, it } from "vitest";
import { ProxiedStorageGateway } from "../../src/s3/proxied-storage.gateway.js";

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const KEY = "graphs/org-1/project-1/scan 1.json.gz";

const gateway = (now = NOW) =>
  new ProxiedStorageGateway({} as never, "https://wiremap.example/", "s".repeat(40), () => now);

const parts = (link: string) => {
  const url = new URL(link);
  return { url, exp: url.searchParams.get("exp"), sig: url.searchParams.get("sig") };
};

describe("ProxiedStorageGateway", () => {
  it("links to the web app, the key encoded segment by segment", async () => {
    const { url, exp } = parts(await gateway().presignDownload(KEY, 300));
    expect(url.origin).toBe("https://wiremap.example");
    expect(url.pathname).toBe("/api/storage/graphs/org-1/project-1/scan%201.json.gz");
    expect(Number(exp)).toBe(NOW / 1000 + 300);
  });

  it("verifies the method, key and expiry it signed, and nothing else", async () => {
    const proxy = gateway();
    const download = parts(await proxy.presignDownload(KEY, 300));
    const upload = parts(await proxy.presignUpload(KEY, "application/gzip", 300));

    expect(proxy.verify("GET", KEY, download.exp, download.sig)).toBe(true);
    expect(proxy.verify("PUT", KEY, upload.exp, upload.sig)).toBe(true);
    // A download link cannot write, and an upload link cannot read.
    expect(proxy.verify("PUT", KEY, download.exp, download.sig)).toBe(false);
    expect(proxy.verify("GET", KEY, upload.exp, upload.sig)).toBe(false);
    // Another key, a stretched expiry, a tampered or missing signature.
    expect(proxy.verify("GET", `${KEY}x`, download.exp, download.sig)).toBe(false);
    expect(proxy.verify("GET", KEY, String(Number(download.exp) + 1), download.sig)).toBe(false);
    expect(proxy.verify("GET", KEY, download.exp, `${download.sig}x`)).toBe(false);
    expect(proxy.verify("GET", KEY, download.exp, null)).toBe(false);
    expect(proxy.verify("GET", KEY, "soon", download.sig)).toBe(false);
  });

  it("refuses a link once it expires", async () => {
    const link = parts(await gateway().presignDownload(KEY, 300));
    expect(gateway(NOW + 299_000).verify("GET", KEY, link.exp, link.sig)).toBe(true);
    expect(gateway(NOW + 301_000).verify("GET", KEY, link.exp, link.sig)).toBe(false);
  });

  it("refuses a link signed with another secret", async () => {
    const link = parts(await gateway().presignDownload(KEY, 300));
    const other = new ProxiedStorageGateway(
      {} as never,
      "https://wiremap.example",
      "t".repeat(40),
      () => NOW,
    );
    expect(other.verify("GET", KEY, link.exp, link.sig)).toBe(false);
  });

  it("passes every other call to the bucket it wraps", async () => {
    const calls: string[] = [];
    const inner = new Proxy(
      {},
      {
        get:
          (_target, name) =>
          (...args: unknown[]) => {
            calls.push(`${String(name)}:${String(args[0])}`);
            return Promise.resolve(null);
          },
      },
    );
    const proxy = new ProxiedStorageGateway(inner as never, "https://w.example", "s".repeat(40));
    await proxy.exists("a");
    await proxy.delete("b");
    await proxy.list("c/");
    expect(calls).toEqual(["exists:a", "delete:b", "list:c/"]);
  });
});
