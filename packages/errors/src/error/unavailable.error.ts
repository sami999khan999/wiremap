import { AppError } from "./app.error.js";

// An upstream dependency failed. `UNAVAILABLE` is retryable in the catalog, which
// is what lets a queue consumer try again instead of dead-lettering a blip.
export class UnavailableError extends AppError {
  public constructor(dependency: string, status?: number) {
    super("UNAVAILABLE", status === undefined ? { dependency } : { dependency, status });
  }
}
