import { type Logger, UnavailableError } from "../import.js";

export interface ClickHouseConfig {
  // The HTTP interface, not the native port. `http://clickhouse:8123` in compose,
  // `https://…` for ClickHouse Cloud — the same client reaches both.
  readonly url: string;
  readonly database: string;
  readonly username: string;
  readonly password: string;
  // Analytics reads are allowed to be slow and not allowed to be unbounded.
  readonly timeoutMs?: number;
}

// `fetch` over the HTTP interface, not `@clickhouse/client`, so ClickHouse stays a Tier 0
// dependency. See docs/reference/clickhouse.md.
export class ClickHouseConnection {
  private static readonly DEFAULT_TIMEOUT_MS = 30_000;

  public constructor(
    private readonly config: ClickHouseConfig,
    private readonly logger?: Logger,
  ) {}

  // `JSONEachRow` rather than `JSON`: one object per line, so each row is parsed as its
  // line arrives. The rows are still returned whole; what never exists is the whole text.
  public async query<T>(sql: string, params: Readonly<Record<string, unknown>> = {}): Promise<T[]> {
    const response = await this.send(`${sql}\nFORMAT JSONEachRow`, params);
    if (!response.body) return [];
    const rows: T[] = [];
    let pending = "";

    // `CR.41`: this was `text()` then `split`, the body and its lines held at once under a
    // comment that said it streamed.
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.length > 0) rows.push(JSON.parse(line) as T);
    }
    if (pending.length > 0) rows.push(JSON.parse(pending) as T);

    return rows;
  }

  // Nothing is returned, and nothing should be: a caller that reads an insert's response
  // is treating the derived store as authoritative.
  public async command(sql: string, params: Readonly<Record<string, unknown>> = {}): Promise<void> {
    await (await this.send(sql, params)).body?.cancel();
  }

  // Batched, because ClickHouse merges on write: a thousand single-row inserts create a
  // thousand parts the background merge never catches up with.
  public async insert(
    table: string,
    rows: readonly Readonly<Record<string, unknown>>[],
  ): Promise<void> {
    if (rows.length === 0) return;

    const payload = rows.map((row) => JSON.stringify(row)).join("\n");
    const response = await this.send(
      `INSERT INTO ${this.qualified(table)} FORMAT JSONEachRow\n${payload}`,
    );
    await response.body?.cancel();
  }

  public async healthy(): Promise<boolean> {
    try {
      await this.query<{ readonly one: number }>("SELECT 1 AS one");
      return true;
    } catch {
      return false;
    }
  }

  // Nothing to release — `fetch` holds no pool. Present so adding a pooled client later
  // changes this file rather than the container.
  public async close(): Promise<void> {}

  // Qualified on the way out: ClickHouse resolves an unqualified name against the session
  // default, which is why a table can look missing while it exists.
  public qualified(table: string): string {
    return table.includes(".") ? table : `${this.config.database}.${table}`;
  }

  // The response, unread: `query` decodes it line by line, and the other two discard it.
  private async send(
    sql: string,
    params: Readonly<Record<string, unknown>> = {},
  ): Promise<Response> {
    const url = new URL(this.config.url);
    url.searchParams.set("database", this.config.database);
    // Server-side bound parameters, never interpolation: this store holds every tenant's
    // rows, so an injected predicate is a cross-tenant read.
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(`param_${key}`, ClickHouseConnection.encode(value));
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-clickhouse-user": this.config.username,
        "x-clickhouse-key": this.config.password,
      },
      body: sql,
      signal: AbortSignal.timeout(this.config.timeoutMs ?? ClickHouseConnection.DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      // ClickHouse puts the whole error in the body and a bare 500 in the status, and a
      // failed INSERT echoes the offending row — so the body is logged, never thrown.
      const detail = (await response.text()).slice(0, 500);
      this.logger?.emit("dependency.request.failed", {
        dependency: "clickhouse",
        status: response.status,
        detail,
      });
      throw new UnavailableError("clickhouse", response.status);
    }

    return response;
  }

  // `DateTime64(3)`: ClickHouse rejects the `T` and `Z` of an ISO string with a 400,
  // which is at least loud.
  private static encode(value: unknown): string {
    if (value instanceof Date) return value.toISOString().replace("T", " ").replace("Z", "");

    if (Array.isArray(value)) {
      const items = value.map((v) => `'${ClickHouseConnection.escape(String(v))}'`);
      return `[${items.join(",")}]`;
    }

    // A scalar rides its own query-string parameter and is never quoted, so there is
    // nothing here for an escape to protect.
    return String(value);
  }

  // An array is the one parameter sent as a literal, so an unescaped `'` splits one element
  // into two. Backslash first, or the escape this writes gets escaped by the next pass.
  private static escape(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  }
}
