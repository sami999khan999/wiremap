import { AppError } from "./app.error.js";

// Optimistic-concurrency and uniqueness failures.
export class ConflictError extends AppError {
  public constructor(resource: string, reason: string) {
    super("CONFLICT", { resource, reason });
  }
}
