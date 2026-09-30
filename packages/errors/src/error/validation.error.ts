import { AppError, type FieldViolation } from "./app.error.js";

// The minimum of a Zod issue this package needs, declared structurally.
export interface SchemaIssue {
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly minimum?: number | bigint;
  readonly maximum?: number | bigint;
}

// Zod's default messages are discarded, not forwarded — an issue becomes
// `{ field, rule, params }` and `content` renders the sentence.
export class ValidationError extends AppError {
  public constructor(fields: readonly FieldViolation[]) {
    super("BAD_REQUEST", { fieldCount: fields.length }, fields);
  }

  public static fromIssues(issues: readonly SchemaIssue[]): ValidationError {
    return new ValidationError(issues.map((issue) => ValidationError.toViolation(issue)));
  }

  private static toViolation(issue: SchemaIssue): FieldViolation {
    const field = issue.path.join(".");
    const rule = ValidationError.ruleFor(issue);
    const params = ValidationError.paramsFor(issue);

    return params ? { field, rule, params } : { field, rule };
  }

  // Zod codes are an open set, so an unknown one becomes `"invalid"` rather than leaking.
  private static ruleFor(issue: SchemaIssue): string {
    switch (issue.code) {
      case "invalid_type":
        return "required";
      case "too_small":
        return "tooShort";
      case "too_big":
        return "tooLong";
      case "invalid_format":
      case "invalid_string":
        return "invalidFormat";
      default:
        return "invalid";
    }
  }

  // Both bounds, not the first one found: a `min(8).max(64)` issue carries `minimum` and
  // `maximum`, and `error.field.tooLong` renders `{max}` literally when it is missing.
  private static paramsFor(issue: SchemaIssue): Record<string, number> | undefined {
    const params: Record<string, number> = {};
    if (issue.minimum !== undefined) params.min = Number(issue.minimum);
    if (issue.maximum !== undefined) params.max = Number(issue.maximum);

    return Object.keys(params).length > 0 ? params : undefined;
  }
}
