import type { ErrorSeverity } from "../import.js";

// Four, and closed. No `trace`, no `fatal` — a fifth level buys nothing except an
// argument about which one a given line deserves.
export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

const ALL: readonly LogLevel[] = Object.freeze(["debug", "info", "warn", "error"] as const);

export class LogLevels {
  private constructor() {}

  public static readonly ALL: readonly LogLevel[] = ALL;
  public static readonly DEFAULT: LogLevel = "info";

  // The boundary that narrows LOG_LEVEL before it can configure a sink.
  public static is(value: string | null | undefined): value is LogLevel {
    return value !== null && value !== undefined && ALL.includes(value as LogLevel);
  }

  public static atLeast(level: LogLevel, threshold: LogLevel): boolean {
    return ORDER[level] >= ORDER[threshold];
  }

  // The first consumer `ErrorMeta.severity` has ever had. `expected` is someone
  // trying what they cannot do; `unexpected` is us being broken. Only one pages.
  public static fromSeverity(severity: ErrorSeverity): LogLevel {
    return severity === "unexpected" ? "error" : "warn";
  }
}
