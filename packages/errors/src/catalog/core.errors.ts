import type { ErrorMeta } from "./index.js";

export const coreErrors = {
  UNAUTHORIZED: { retryable: false, severity: "expected" },
  FORBIDDEN: { retryable: false, severity: "expected" },
  NOT_FOUND: { retryable: false, severity: "expected" },
  CONFLICT: { retryable: false, severity: "expected" },
  BAD_REQUEST: { retryable: false, severity: "expected" },
  TWO_FACTOR_REQUIRED: { retryable: false, severity: "expected" },
  ACCOUNT_SUSPENDED: { retryable: false, severity: "expected" },
  RATE_LIMITED: { retryable: true, severity: "expected" },
  UNAVAILABLE: { retryable: true, severity: "unexpected" },
  INTERNAL: { retryable: false, severity: "unexpected" },
  // A server-only module reached a client bundle. A build defect, never a request.
  SERVER_ONLY: { retryable: false, severity: "unexpected" },
} as const satisfies Record<string, ErrorMeta>;
