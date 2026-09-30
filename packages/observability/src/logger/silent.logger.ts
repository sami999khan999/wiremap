import type { LogEntry, LogFields } from "../event/index.js";
import { Logger, type LoggerOptions } from "./logger.js";

// Writes nothing. What `TestContainer` wires, and what a process uses when logging
// is genuinely off — a no-op sink rather than a null check at every call site.
export class SilentLogger extends Logger {
  public constructor(options: LoggerOptions = {}) {
    super(options);
  }

  public override child(bound: LogFields): SilentLogger {
    return new SilentLogger(this.merged(bound));
  }

  protected override write(_entry: LogEntry): void {
    // Intentionally nothing.
  }
}
