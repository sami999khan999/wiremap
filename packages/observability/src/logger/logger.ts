import { EVENT_CATALOG, type EventCode, type EventMeta } from "../catalog/index.js";
import type { EventFields, LogEntry, LogFields } from "../event/index.js";
import {
  type Clock,
  ERROR_CATALOG,
  ErrorNormalizer,
  type ErrorSeverity,
  type FieldViolation,
  SystemClock,
} from "../import.js";
import { type LogLevel, LogLevels } from "../primitive/index.js";
import { Redactor } from "./redactor.js";

export interface LoggerOptions {
  // Lines below this are dropped before anything is serialised.
  readonly level?: LogLevel;
  // Merged into every line. This is how a trace id rides a request with no ambient
  // state anywhere — see `child()`.
  readonly bound?: LogFields;
  readonly clock?: Clock;
  readonly random?: () => number;
}

// Deliberately not in `EVENT_CATALOG`: its level comes from `ERROR_CATALOG`, and it is
// the only line whose level is decided by the thing being logged.
export const ERROR_EVENT = "error.raised";

// Enough frames to find the throw, short enough that a retry storm does not become
// the whole log bill.
const STACK_LIMIT = 2000;

export abstract class Logger {
  protected readonly level: LogLevel;
  protected readonly bound: LogFields;
  protected readonly clock: Clock;
  protected readonly random: () => number;

  protected constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? LogLevels.DEFAULT;
    this.bound = options.bound ?? {};
    this.clock = options.clock ?? new SystemClock();
    this.random = options.random ?? Math.random;
  }

  // The only method a sink implements: level, sampling, bound fields and redaction are
  // already applied, because they are properties of the seam.
  protected abstract write(entry: LogEntry): void;

  // A logger that merges `bound` into every line it writes.
  public abstract child(bound: LogFields): Logger;

  public threshold(): LogLevel {
    return this.level;
  }

  // The call site says what happened, the catalog how loudly — so one event cannot be
  // `info` here and `error` there.
  public emit<C extends EventCode>(code: C, fields: EventFields<C>): void {
    // Annotated, not inferred. `as const satisfies` keeps the literal types, so an
    // entry that omits `sample` genuinely has no such property in the union.
    const meta: EventMeta = EVENT_CATALOG[code];
    this.record(meta.level, code, fields, meta.sample);
  }

  // Normalised first, so the raw original stays on the non-enumerable `cause` —
  // the one thing a logger may read and the wire may not.
  public failure(thrown: unknown, fields: LogFields = {}): void {
    const error = ErrorNormalizer.normalize(thrown);
    const severity = ERROR_CATALOG[error.code].severity;

    this.record(LogLevels.fromSeverity(severity), ERROR_EVENT, {
      ...fields,
      ...error.context,
      code: error.code,
      ...Logger.violations(error.fields),
      ...Logger.cause(error.cause, severity),
    });
  }

  protected merged(bound: LogFields): LoggerOptions {
    return {
      level: this.level,
      bound: { ...this.bound, ...bound },
      clock: this.clock,
      random: this.random,
    };
  }

  private record(
    level: LogLevel,
    event: EventCode | typeof ERROR_EVENT,
    fields: LogFields,
    sample?: number,
  ): void {
    if (!LogLevels.atLeast(level, this.level)) return;
    if (sample !== undefined && this.random() >= sample) return;

    this.write({
      level,
      time: this.clock.now().toISOString(),
      event,
      fields: Redactor.apply({ ...this.bound, ...fields }),
    });
  }

  // A violation list is an array and a log field is flat. The names are what you
  // filter on; the rules and params already reached the user in the response.
  private static violations(fields: readonly FieldViolation[] | undefined): LogFields {
    if (!fields || fields.length === 0) return {};
    return { violations: fields.map((violation) => violation.field).join(",") };
  }

  // Only for `unexpected`: an expected failure is the system working, and its stack is
  // noise on every 403 the product serves.
  private static cause(cause: unknown, severity: ErrorSeverity): LogFields {
    if (cause === undefined || cause === null) return {};

    const described = Logger.describe(cause);
    if (severity !== "unexpected") return { cause: described };

    const stack = cause instanceof Error ? cause.stack : undefined;
    return stack ? { cause: described, stack: stack.slice(0, STACK_LIMIT) } : { cause: described };
  }

  // `String(thrown)` yields "[object Object]". Serialise instead, and let anything that
  // resists name its own type.
  private static describe(cause: unknown): string {
    if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
    if (typeof cause === "string") return cause;

    try {
      return JSON.stringify(cause) ?? Object.prototype.toString.call(cause);
    } catch {
      return Object.prototype.toString.call(cause);
    }
  }
}
