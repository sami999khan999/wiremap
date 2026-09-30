import type { LogEntry, LogFields } from "@loadbearing/observability";
import { Logger, type LoggerOptions } from "@loadbearing/observability";

// The sink is the only thing a spec needs to see, so this keeps the entries rather
// than serialising them: `JsonLogger` would put the assertion behind a parse.
export class RecordingLogger extends Logger {
  public readonly entries: LogEntry[] = [];

  public constructor(options: LoggerOptions = {}) {
    super(options);
  }

  public override child(bound: LogFields): RecordingLogger {
    return new RecordingLogger(this.merged(bound));
  }

  protected override write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}
