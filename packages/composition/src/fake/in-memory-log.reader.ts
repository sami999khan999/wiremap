import { type LogEntry, type LogQuery, LogReader } from "../import.js";

// The same four labels the real selector has, and nothing else: supporting `userId`
// would let a caller write a query the real Loki cannot serve.
export class InMemoryLogReader extends LogReader {
  public constructor(private readonly entries: readonly LogEntry[] = []) {
    super();
  }

  public override query(query: LogQuery): Promise<readonly LogEntry[]> {
    const matched = this.entries.filter(
      (entry) =>
        entry.timestamp >= query.from &&
        entry.timestamp < query.to &&
        (!query.app || entry.app === query.app) &&
        (!query.env || entry.env === query.env) &&
        (!query.level || entry.level === query.level) &&
        (!query.eventCode || entry.eventCode === query.eventCode) &&
        (!query.contains || JSON.stringify(entry.fields).includes(query.contains)),
    );

    // Newest first, matching `direction=backward`: insertion order hides a paging bug
    // that only shows when the window exceeds `limit`.
    return Promise.resolve(
      [...matched]
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, query.limit ?? 100),
    );
  }

  public override healthy(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
