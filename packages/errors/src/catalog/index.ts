import { coreErrors } from "./core.errors.js";

// `expected` belongs in a log line; `unexpected` belongs in an alert.
export type ErrorSeverity = "expected" | "unexpected";

export interface ErrorMeta {
  // Whether retrying the same call could produce a different answer.
  readonly retryable: boolean;
  readonly severity: ErrorSeverity;
}

// The closed vocabulary of failures, merged from team-owned fragments — add them here.
// Metadata is transport-agnostic: `query` and the worker read the same `retryable`.
export const ERROR_CATALOG = {
  ...coreErrors,
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOG;
