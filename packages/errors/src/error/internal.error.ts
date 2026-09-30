import { AppError } from "./app.error.js";

// What anything unrecognised becomes. `cause` is non-enumerable, so the original
// reaches the logger but never the envelope.
export class InternalError extends AppError {
  public override readonly cause: unknown;

  public constructor(cause?: unknown) {
    super("INTERNAL");
    Object.defineProperty(this, "cause", {
      value: cause,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
}
