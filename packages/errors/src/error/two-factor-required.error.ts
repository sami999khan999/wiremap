import { AppError } from "./app.error.js";

// A fork in the flow, not a failure — the sign-in form branches on this code.
export class TwoFactorRequiredError extends AppError {
  public constructor() {
    super("TWO_FACTOR_REQUIRED");
  }
}
