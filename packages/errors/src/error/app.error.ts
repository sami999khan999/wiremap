import { ERROR_CATALOG, type ErrorCode } from "../catalog/index.js";
import { TraceIds } from "../transport/index.js";

// `Error.captureStackTrace` is a V8 extension, absent from `lib: ["ES2024"]`.
type StackTraceCapture = {
  captureStackTrace?: (target: object, constructorOpt?: unknown) => void;
};

// Structured, JSON-safe, interpolated into copy by `content`. Never prose.
export type ErrorContext = Readonly<Record<string, string | number | boolean>>;

export interface FieldViolation {
  readonly field: string;
  // A rule name, never a sentence. `content` maps it to a message key.
  readonly rule: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

export interface ErrorEnvelope {
  readonly code: ErrorCode;
  readonly context: ErrorContext;
  readonly fields?: readonly FieldViolation[];
  readonly traceId?: string;
}

// The one failure shape, thrown on the server and rebuilt on the client. It carries
// no message — every word lives in `content`, keyed by code. See docs/reference.
export abstract class AppError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    public readonly context: ErrorContext = {},
    public readonly fields?: readonly FieldViolation[],
  ) {
    // The code *is* the message. Nothing else is ever assigned here.
    super(code);
    this.name = new.target.name;
    (Error as StackTraceCapture).captureStackTrace?.(this, new.target);
  }

  // `Object.hasOwn`, not `in` — `in` walks the prototype chain and admits `toString`.
  public static isKnownCode(value: string): value is ErrorCode {
    return Object.hasOwn(ERROR_CATALOG, value);
  }

  // Rebuild from the wire. `null` for an unrecognised code rather than trusting it, and
  // the trace id is checked for the same reason: everything here arrived from outside.
  public static from(envelope: ErrorEnvelope): AppError | null {
    if (!AppError.isKnownCode(envelope.code)) return null;

    return new TransportError(
      envelope.code,
      envelope.context,
      envelope.fields,
      TraceIds.sanitise(envelope.traceId) ?? undefined,
    );
  }

  public get retryable(): boolean {
    return ERROR_CATALOG[this.code].retryable;
  }

  public toJSON(): ErrorEnvelope {
    return {
      code: this.code,
      context: this.context,
      ...(this.fields ? { fields: this.fields } : {}),
    };
  }
}

// What `AppError.from()` produces — code and context survive, the class does not. It
// carries the trace id because the id belongs to the request, not to the error.
export class TransportError extends AppError {
  public constructor(
    code: ErrorCode,
    context?: ErrorContext,
    fields?: readonly FieldViolation[],
    public readonly traceId?: string,
  ) {
    super(code, context, fields);
  }

  public override toJSON(): ErrorEnvelope {
    return { ...super.toJSON(), ...(this.traceId ? { traceId: this.traceId } : {}) };
  }
}
