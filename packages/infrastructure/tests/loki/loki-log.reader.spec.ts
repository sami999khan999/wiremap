import { UnavailableError } from "@loadbearing/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LokiLogReader } from "../../src/loki/loki-log.reader.js";
import { RecordingLogger } from "../support/recording.logger.js";

const failWith = (status: number, body: string) =>
  vi.fn().mockResolvedValue({ ok: false, status, text: () => Promise.resolve(body) });

const reader = (logger?: RecordingLogger) => new LokiLogReader({ url: "http://stub:3100" }, logger);

const window = { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-01-02T00:00:00Z") };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LokiLogReader", () => {
  it("keeps the response body out of the thrown error", async () => {
    vi.stubGlobal("fetch", failWith(400, 'parse error: {user_id="u-42"}'));

    const thrown = await reader()
      .query(window)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(UnavailableError);
    expect(JSON.stringify((thrown as UnavailableError).toJSON())).not.toContain("u-42");
  });

  it("names the dependency and the status in the error context", async () => {
    vi.stubGlobal("fetch", failWith(502, "bad gateway"));

    const thrown = (await reader()
      .query(window)
      .catch((error: unknown) => error)) as UnavailableError;

    expect(thrown.context).toMatchObject({ dependency: "loki", status: 502 });
  });

  it("logs the body at the level the catalog gives the event", async () => {
    vi.stubGlobal("fetch", failWith(400, "parse error"));
    const logger = new RecordingLogger();

    await reader(logger)
      .query(window)
      .catch(() => undefined);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: "warn",
      event: "dependency.request.failed",
      fields: { dependency: "loki", status: 400, detail: "parse error" },
    });
  });
});
