import {
  type LogEntry,
  type Logger,
  type LogQuery,
  LogReader,
  UnavailableError,
} from "../import.js";

export interface LokiConfig {
  // The query API, not the push endpoint: Alloy pushes by tailing stdout, which is what
  // keeps `JsonLogger` unaware the platform exists.
  readonly url: string;
  // Loki's multi-tenancy header. Unset locally, set on Grafana Cloud.
  readonly tenantId?: string;
  readonly timeoutMs?: number;
}

interface LokiStream {
  readonly stream: Readonly<Record<string, string>>;
  // `[unixNanoseconds, line]`, and the timestamp is a string because nanoseconds
  // do not survive a JSON number.
  readonly values: readonly (readonly [string, string])[];
}

interface LokiResponse {
  readonly data?: { readonly result?: readonly LokiStream[] };
}

// The only code that knows Loki exists — the write path is stdout, so a platform swap is
// this file and an Alloy config line. See docs/reference/loki.md.
export class LokiLogReader extends LogReader {
  private static readonly DEFAULT_TIMEOUT_MS = 15_000;
  // Loki's own ceiling is 5000. Asking for more is a 400, not a truncation.
  private static readonly MAX_LIMIT = 5_000;

  public constructor(
    private readonly config: LokiConfig,
    private readonly logger?: Logger,
  ) {
    super();
  }

  public override async query(query: LogQuery): Promise<readonly LogEntry[]> {
    const url = new URL("/loki/api/v1/query_range", this.config.url);
    url.searchParams.set("query", LokiLogReader.toLogQl(query));
    // Nanoseconds. Milliseconds are accepted and interpreted as nanoseconds, which
    // silently returns an empty window in 1970.
    url.searchParams.set("start", LokiLogReader.nanos(query.from));
    url.searchParams.set("end", LokiLogReader.nanos(query.to));
    url.searchParams.set("limit", String(Math.min(query.limit ?? 100, LokiLogReader.MAX_LIMIT)));
    // Newest first. Loki's default is `forward`, and the difference is invisible until
    // the window is wider than `limit`.
    url.searchParams.set("direction", "backward");

    const response = await fetch(url, {
      headers: this.config.tenantId ? { "x-scope-orgid": this.config.tenantId } : {},
      signal: AbortSignal.timeout(this.config.timeoutMs ?? LokiLogReader.DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      // The body carries the LogQL Loki rejected, which is a query over another
      // tenant's labels. It goes to the log, and the caller gets the status.
      const detail = (await response.text()).slice(0, 300);
      this.logger?.emit("dependency.request.failed", {
        dependency: "loki",
        status: response.status,
        detail,
      });
      throw new UnavailableError("loki", response.status);
    }

    const body = (await response.json()) as LokiResponse;
    return (body.data?.result ?? []).flatMap((stream) =>
      stream.values.map((value) => LokiLogReader.toEntry(stream.stream, value)),
    );
  }

  public override async healthy(): Promise<boolean> {
    try {
      const response = await fetch(new URL("/ready", this.config.url), {
        signal: AbortSignal.timeout(this.config.timeoutMs ?? LokiLogReader.DEFAULT_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // Four labels in the selector, everything else in the line filter: a label creates one
  // stream per distinct value, so a `userId` selector is 100k streams.
  private static toLogQl(query: LogQuery): string {
    const selector: string[] = [];
    if (query.app) selector.push(`app=${JSON.stringify(query.app)}`);
    if (query.env) selector.push(`env=${JSON.stringify(query.env)}`);
    if (query.level) selector.push(`level=${JSON.stringify(query.level)}`);
    if (query.eventCode) selector.push(`event_code=${JSON.stringify(query.eventCode)}`);

    // A selector cannot be empty, so an unfiltered query still names a label. `app=~".+"`
    // is the cheapest: Alloy binds `app` onto every stream.
    const stream = selector.length > 0 ? selector.join(",") : 'app=~".+"';

    // `| json` after the selector, so the parse cost is paid only on surviving streams.
    // `contains` matches the raw line, which is where high-cardinality fields belong.
    return query.contains
      ? `{${stream}} |= ${JSON.stringify(query.contains)} | json`
      : `{${stream}} | json`;
  }

  // A line that is not our JSON parses to nothing and keeps its raw text as the message,
  // which is correct: a third-party line is still a diagnostic.
  private static toEntry(
    labels: Readonly<Record<string, string>>,
    [timestamp, line]: readonly [string, string],
  ): LogEntry {
    const parsed = LokiLogReader.parse(line);

    return {
      // `Number` on the whole string loses precision above 2^53, so the division happens
      // on the string's own digits.
      timestamp: new Date(Number(BigInt(timestamp) / 1_000_000n)),
      app: labels.app ?? "unknown",
      env: labels.env ?? "unknown",
      level: labels.level ?? LokiLogReader.text(parsed.level) ?? "info",
      eventCode: labels.event_code ?? LokiLogReader.text(parsed.event) ?? "",
      message: LokiLogReader.text(parsed.message) ?? line,
      fields: parsed,
    };
  }

  private static parse(line: string): Readonly<Record<string, unknown>> {
    try {
      const value: unknown = JSON.parse(line);
      return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private static text(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  private static nanos(value: Date): string {
    return `${BigInt(value.getTime()) * 1_000_000n}`;
  }
}
