import { describe, expect, it, vi } from "vitest";

// The endpoint module reaches for the container at import; its path parsing does not.
vi.mock("../../src/server/container.js", () => ({ container: {} }));

const { StorageEndpoint } = await import("../../src/server/storage.server.js");

describe("StorageEndpoint.keyFrom", () => {
  it("decodes one key from the path", () => {
    expect(StorageEndpoint.keyFrom("/api/storage/graphs/o/p/scan%201.json.gz")).toBe(
      "graphs/o/p/scan 1.json.gz",
    );
  });

  // A link signs one object; a path that walks or is empty names a different one.
  it("refuses a path that walks, is empty, or is not under the route", () => {
    for (const path of [
      "/api/storage/graphs/../secrets",
      "/api/storage/graphs/%2e%2e/secrets",
      "/api/storage/graphs//x",
      "/api/storage/",
      "/api/storage/%E0%A4%A",
      "/api/other/graphs/x",
    ]) {
      expect(StorageEndpoint.keyFrom(path), path).toBeNull();
    }
  });
});
