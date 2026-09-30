import {
  AppError,
  type ErrorEnvelope,
  InternalError,
  type SchemaIssue,
  ValidationError,
} from "../error/index.js";

// The boundary every thrown value crosses before it is transported, logged, or rendered.
export class ErrorNormalizer {
  private constructor() {}

  public static normalize(thrown: unknown): AppError {
    // Before `isAppError`, which a transport error passes: it carries a known `code`
    // and a `toJSON`, so it would answer the transport's shape and not the envelope.
    const wrapped = ErrorNormalizer.wrappedEnvelope(thrown);
    // `from` refuses an unknown code, and the wrapper's own code is not a fallback:
    // adopting it would hand a caller the shape this branch exists to stop.
    if (wrapped !== null) return AppError.from(wrapped) ?? new InternalError(thrown);

    if (ErrorNormalizer.isAppError(thrown)) return thrown;
    if (ErrorNormalizer.isSchemaError(thrown)) return ValidationError.fromIssues(thrown.issues);
    return new InternalError(thrown);
  }

  // A decoded transport error wraps our envelope in `data` and puts its own `code` and
  // `message` on top. Nothing of ours carries `data`, so this matches only a wrapper.
  private static wrappedEnvelope(value: unknown): ErrorEnvelope | null {
    if (typeof value !== "object" || value === null) return null;

    const { data } = value as { data?: unknown };
    if (typeof data !== "object" || data === null) return null;

    const { code } = data as { code?: unknown };
    return typeof code === "string" ? (data as ErrorEnvelope) : null;
  }

  // Structural, not `instanceof` — two copies of this package have two class identities.
  private static isAppError(value: unknown): value is AppError {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as { code?: unknown; toJSON?: unknown };

    return (
      typeof candidate.code === "string" &&
      AppError.isKnownCode(candidate.code) &&
      typeof candidate.toJSON === "function"
    );
  }

  // Anything Zod-shaped, matched structurally so this package stays dependency-free.
  private static isSchemaError(value: unknown): value is { issues: readonly SchemaIssue[] } {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as { issues?: unknown };

    return (
      Array.isArray(candidate.issues) &&
      candidate.issues.every(
        (issue: unknown) =>
          typeof issue === "object" &&
          issue !== null &&
          Array.isArray((issue as { path?: unknown }).path) &&
          typeof (issue as { code?: unknown }).code === "string",
      )
    );
  }
}
