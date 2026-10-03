import { gzipSync } from "node:zlib";
import { GRAPH_VERSION, type OrganizationId, type ScanId } from "@loadbearing/contracts";
import { describe, expect, it } from "vitest";
import { HmacScanTokens } from "../../src/crypto/index.js";
import { GithubActionsScanRunner } from "../../src/github/index.js";
import { StorageGraphArchive } from "../../src/s3/index.js";

const ref = {
  organizationId: "018f8c00-0000-7000-8000-0000000000a0" as OrganizationId,
  scanId: "018f8c00-0000-7000-8000-0000000000e1" as ScanId,
};

const storage = (bytes: Uint8Array | null) =>
  ({
    sizeOf: () => Promise.resolve(bytes ? bytes.length : null),
    get: () => Promise.resolve(bytes ?? new Uint8Array()),
  }) as never;

const minimal = {
  version: GRAPH_VERSION,
  meta: {
    analyzer: "t",
    generatedAt: "2026-10-03T00:00:00.000Z",
    repositories: [{ name: "a/b", commit: null, branch: null }],
    timings: { totalMs: 1 },
  },
  languages: [],
  frameworks: [],
  files: [],
  edges: [],
  unresolved: [],
  coverage: { resolved: 0, total: 0 },
  routes: [],
  calls: [],
  insights: {
    mostDepended: [],
    cycles: [],
    unusedFiles: [],
    unusedExports: [],
    unguardedRoutes: [],
  },
};

describe("HmacScanTokens", () => {
  it("verifies its own token for that scan only", () => {
    const tokens = new HmacScanTokens("secret");
    const token = tokens.issue(ref);
    expect(tokens.verify(ref, token)).toBe(true);
    expect(
      tokens.verify({ ...ref, scanId: "018f8c00-0000-7000-8000-0000000000e2" as ScanId }, token),
    ).toBe(false);
    expect(new HmacScanTokens("other").verify(ref, token)).toBe(false);
    expect(tokens.verify(ref, null)).toBe(false);
  });

  // The workflow derives this with `openssl dgst -sha256 -hmac ... | base64url`; the value
  // is pinned so a change on either side is caught here, not in a failed run.
  it("matches what the runner workflow derives", () => {
    expect(new HmacScanTokens("secret").issue(ref)).toBe(
      "8teD7182V5iDI4QGp51QnOmB3hkMTGoJpd_HImQIyGc",
    );
  });
});

describe("StorageGraphArchive", () => {
  it("reads a valid graph and refuses a missing, foreign or wrong-version one", async () => {
    const good = gzipSync(JSON.stringify(minimal));
    expect(await new StorageGraphArchive(storage(good)).read("k")).toMatchObject({
      bytes: good.length,
    });
    expect(await new StorageGraphArchive(storage(null)).read("k")).toEqual({
      refused: "No graph was uploaded.",
    });
    expect(
      await new StorageGraphArchive(storage(new Uint8Array([1, 2, 3]))).read("k"),
    ).toMatchObject({ refused: expect.stringContaining("gzip") });
    expect(
      await new StorageGraphArchive(
        storage(gzipSync(JSON.stringify({ ...minimal, version: 2 }))),
      ).read("k"),
    ).toEqual({
      refused: "This server reads graph version 1; the upload is version 2.",
    });
  });
});

describe("GithubActionsScanRunner", () => {
  it("dispatches the workflow with the scan reference as its only input", async () => {
    const calls: { url: string; body: string }[] = [];
    const runner = new GithubActionsScanRunner({
      repository: "acme/wiremap",
      token: "t",
      fetch: ((url: string, init: RequestInit) => {
        calls.push({ url, body: init.body as string });
        return Promise.resolve(new Response(null, { status: 204 }));
      }) as never,
    });

    await runner.dispatch(ref);

    expect(calls[0]?.url).toBe(
      "https://api.github.com/repos/acme/wiremap/actions/workflows/scan.yml/dispatches",
    );
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      ref: "main",
      inputs: { scan: `${ref.organizationId}.${ref.scanId}` },
    });
  });
});
