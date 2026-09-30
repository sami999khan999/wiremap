import type { ErrorCode } from "../catalog/index.js";

// The only place in this package that knows HTTP exists. `@loadbearing/application`
// may not import it — ESLint bans the name there. Total, so a new code needs a status.
export const HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BAD_REQUEST: 400,
  TWO_FACTOR_REQUIRED: 401,
  ACCOUNT_SUSPENDED: 403,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
  INTERNAL: 500,
  // Unreachable over HTTP — the guard fires at module load. Present to stay total.
  SERVER_ONLY: 500,
};
