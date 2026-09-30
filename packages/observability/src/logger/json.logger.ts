import type { LogEntry, LogFields } from "../event/index.js";
import { Logger, type LoggerOptions } from "./logger.js";

export interface JsonLoggerOptions extends LoggerOptions {
  // One line in, somewhere out. Defaults to stdout.
  readonly sink?: (line: string) => void;
  // Human-shaped output for a terminal. Never in production — a log collector wants
  // one JSON object per line and nothing else.
  readonly pretty?: boolean;
}

// `console` is not declared under `lib: ["ES2024"]`, so it is reached as an optional
// property of `globalThis` — the same call, spelled so this package compiles.
type ConsoleLike = { log(line: string): void };

// The one place allowed to call `console`, which is why the lint rule banning it
// everywhere else exempts exactly this file.
const stdout = (line: string): void => {
  (globalThis as { console?: ConsoleLike }).console?.log(line);
};

export class JsonLogger extends Logger {
  private readonly sink: (line: string) => void;
  private readonly pretty: boolean;

  public constructor(private readonly options: JsonLoggerOptions = {}) {
    super(options);
    this.sink = options.sink ?? stdout;
    this.pretty = options.pretty ?? false;
  }

  public override child(bound: LogFields): JsonLogger {
    return new JsonLogger({ ...this.options, ...this.merged(bound) });
  }

  protected override write(entry: LogEntry): void {
    this.sink(this.pretty ? JsonLogger.human(entry) : JsonLogger.line(entry));
  }

  // Fields are spread flat rather than nested under `fields`. Every aggregator
  // indexes top-level keys; a nested object needs a parsing rule per deployment.
  private static line(entry: LogEntry): string {
    return JSON.stringify({
      level: entry.level,
      time: entry.time,
      event: entry.event,
      ...entry.fields,
    });
  }

  private static human(entry: LogEntry): string {
    const fields = Object.entries(entry.fields)
      .map(([name, value]) => `${name}=${String(value)}`)
      .join(" ");
    return `${entry.time} ${entry.level.toUpperCase().padEnd(5)} ${entry.event} ${fields}`.trimEnd();
  }
}
