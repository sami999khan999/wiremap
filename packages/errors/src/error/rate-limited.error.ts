import { AppError } from "./app.error.js";

// Thrown where a 429 comes back from a rate-limited endpoint. Retryable and expected,
// per the catalog.
export class RateLimitedError extends AppError {
  // The endpoint that refused, never the identity: a user id or IP here is a
  // high-cardinality value one hop from a log label.
  public constructor(scope = "request") {
    super("RATE_LIMITED", { scope });
  }
}
