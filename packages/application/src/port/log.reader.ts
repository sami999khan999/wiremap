// One diagnostic line, as the log platform returns it. `fields` is whatever the line
// carried beyond the four labels — correlation id, trace id, tenant, duration.
export interface LogEntry {
  readonly timestamp: Date;
  readonly app: string;
  readonly env: string;
  readonly level: string;
  readonly eventCode: string;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

// Closed on purpose: the four labels are the only indexed fields, and a `userId`
// promoted to one creates a stream per user. See docs/reference/ports.md.
export interface LogQuery {
  readonly from: Date;
  readonly to: Date;
  readonly app?: string;
  readonly env?: string;
  readonly level?: string;
  readonly eventCode?: string;
  // Matched against the line body, never against a label. This is where a trace id,
  // a correlation id or an organization id belongs.
  readonly contains?: string;
  readonly limit?: number;
}

// Read-only, and not on the write path: `JsonLogger` writes to stdout and has never
// heard of a log platform. Absent when none is configured, rather than silent.
export abstract class LogReader {
  public abstract query(query: LogQuery): Promise<readonly LogEntry[]>;

  public abstract healthy(): Promise<boolean>;
}
