import type { ErrorCode, ErrorEnvelope, FieldViolation } from "../import.js";
import type { Translator } from "../translator/index.js";
import type { ShellMessageKey } from "./namespace.js";

// The only place a failure gets words. `ShellMessageKey` as the value type is what stops
// a code being mapped into a lazy namespace and rendering as its own raw key.
export const ERROR_COPY: Readonly<Record<ErrorCode, ShellMessageKey>> = {
  UNAUTHORIZED: "error.unauthorized",
  FORBIDDEN: "error.forbidden",
  NOT_FOUND: "error.notFound",
  CONFLICT: "error.conflict",
  BAD_REQUEST: "error.unexpected",
  TWO_FACTOR_REQUIRED: "error.twoFactorRequired",
  ACCOUNT_SUSPENDED: "error.accountSuspended",
  RATE_LIMITED: "error.rateLimited",
  UNAVAILABLE: "error.unexpected",
  INTERNAL: "error.unexpected",
  SERVER_ONLY: "error.serverOnly",
};

// Field-level rules from a `ValidationError`. Open where `ERROR_COPY` is closed — a
// rule name is whatever a schema produced. Anything unlisted falls back in `ErrorCopy`.
export const FIELD_RULE_COPY: Readonly<Record<string, ShellMessageKey>> = {
  required: "error.field.required",
  tooShort: "error.field.tooShort",
  tooLong: "error.field.tooLong",
  invalidFormat: "error.field.invalidFormat",
  invalid: "error.field.invalid",
  // The five the domain actually emits. Unlisted they fell through to "Something went
  // wrong", which tells a person nothing about the field their form is pointing at.
  format: "error.field.invalidFormat",
  unknown: "error.field.unknown",
  past: "error.field.past",
  range: "error.field.range",
  min: "error.field.min",
  // A unique slug, a path two pages would share. The domain's own, not a schema's.
  taken: "error.field.taken",
  // A grant on a space only its author may read.
  private: "error.field.private",
};

// The seam an error page, boundary, or toast calls. Writes the unknown-rule fallback once.
export class ErrorCopy {
  private constructor() {}

  // Shown at the top of an error page. Interpolates the envelope's context.
  public static message(translator: Translator, envelope: ErrorEnvelope): string {
    return translator.t(ERROR_COPY[envelope.code], envelope.context);
  }

  // One sentence per violation, in envelope order. Empty for a non-validation error.
  public static fields(translator: Translator, envelope: ErrorEnvelope): readonly string[] {
    return (envelope.fields ?? []).map((violation) => ErrorCopy.field(translator, violation));
  }

  // Every `error.field.*` template opens with `{field}`, so a violation naming none gets
  // the generic sentence rather than " is not valid." — a sentence starting on a space.
  public static field(translator: Translator, violation: FieldViolation): string {
    if (violation.field.length === 0) return translator.t("error.unexpected");

    return translator.t(ErrorCopy.ruleKey(violation.rule), {
      field: violation.field,
      ...violation.params,
    });
  }

  // `Object.hasOwn` before the index, not `??` after it: a rule arrives in the envelope
  // from outside, and `FIELD_RULE_COPY["toString"]` is a truthy function `??` never sees.
  private static ruleKey(rule: string): ShellMessageKey {
    const own = Object.hasOwn(FIELD_RULE_COPY, rule) ? FIELD_RULE_COPY[rule] : undefined;

    return own ?? "error.unexpected";
  }
}
