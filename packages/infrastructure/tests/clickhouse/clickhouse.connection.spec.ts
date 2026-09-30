import { UnavailableError } from "@loadbearing/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClickHouseConnection } from "../../src/clickhouse/clickhouse.connection.js";
import { RecordingLogger } from "../support/recording.logger.js";

const failWith = (status: number, body: string) =>
  vi.fn().mockResolvedValue({ ok: false, status, text: () => Promise.resolve(body) });

const ok = () => vi.fn().mockResolvedValue(new Response(""));

// A body delivered in the pieces given, so a row can be split across two of them.
const streaming = (...pieces: readonly string[]) =>
  vi.fn().mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece));
          controller.close();
        },
      }),
    ),
  );

// The URL `send()` built, read back through `URLSearchParams` so the assertion is about
// the value ClickHouse receives rather than about percent-encoding.
function paramOf(fetch: ReturnType<typeof vi.fn>, name: string): string | null {
  const url = fetch.mock.calls[0]?.[0] as URL;
  return url.searchParams.get(`param_${name}`);
}

const connection = (logger?: RecordingLogger) =>
  new ClickHouseConnection(
    { url: "http://stub:8123", database: "analytics", username: "u", password: "p" },
    logger,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ClickHouseConnection", () => {
  // `CR.41`. Parsed as the lines arrive, so a row split across two chunks has to be joined
  // rather than parsed in halves, and a last line with no newline still counts.
  it("parses rows split across chunks, and a last row with no newline", async () => {
    vi.stubGlobal("fetch", streaming('{"n":1}\n{"n"', ':2}\n{"n":3}'));

    expect(await connection().query<{ n: number }>("SELECT n")).toEqual([
      { n: 1 },
      { n: 2 },
      { n: 3 },
    ]);
  });

  // The regression guard: the body was interpolated into the error message, and
  // `AppError.toJSON()` serialises the context straight to the client.
  it("keeps the response body out of the thrown error", async () => {
    vi.stubGlobal("fetch", failWith(500, "Code: 62. DB::Exception: user@example.test"));

    const thrown = await connection()
      .query("SELECT 1")
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(UnavailableError);
    expect(JSON.stringify((thrown as UnavailableError).toJSON())).not.toContain("example.test");
  });

  it("names the dependency and the status in the error context", async () => {
    vi.stubGlobal("fetch", failWith(503, "unavailable"));

    const thrown = (await connection()
      .query("SELECT 1")
      .catch((error: unknown) => error)) as UnavailableError;

    expect(thrown.context).toMatchObject({ dependency: "clickhouse", status: 503 });
  });

  it("logs the body at the level the catalog gives the event", async () => {
    vi.stubGlobal("fetch", failWith(500, "Code: 62. DB::Exception: bad row"));
    const logger = new RecordingLogger();

    await connection(logger)
      .query("SELECT 1")
      .catch(() => undefined);

    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: "warn",
      event: "dependency.request.failed",
      fields: { dependency: "clickhouse", status: 500, detail: "Code: 62. DB::Exception: bad row" },
    });
  });

  it("throws without a logger", async () => {
    vi.stubGlobal("fetch", failWith(500, "boom"));

    await expect(connection().command("INSERT INTO t VALUES")).rejects.toThrow(UnavailableError);
  });

  // An array parameter is the one value sent as a literal, so an element carrying a quote
  // used to close its own string and become two — a filter matching rows nobody named.
  it("escapes a quote inside an array parameter rather than splitting the element", async () => {
    const fetch = ok();
    vi.stubGlobal("fetch", fetch);

    await connection().query("SELECT 1", { ids: ["a'b", "c"] });

    expect(paramOf(fetch, "ids")).toBe("['a\\'b','c']");
  });

  it("escapes a backslash before the quote it would otherwise cancel", async () => {
    const fetch = ok();
    vi.stubGlobal("fetch", fetch);

    // Escaping the quote first would leave `\` in front of the escape and hand ClickHouse
    // a literal quote again.
    await connection().query("SELECT 1", { ids: ["a\\", "b'c"] });

    expect(paramOf(fetch, "ids")).toBe("['a\\\\','b\\'c']");
  });

  it("sends a scalar unquoted, so nothing in it needs escaping", async () => {
    const fetch = ok();
    vi.stubGlobal("fetch", fetch);

    await connection().query("SELECT 1", { name: "o'brien" });

    expect(paramOf(fetch, "name")).toBe("o'brien");
  });
});
