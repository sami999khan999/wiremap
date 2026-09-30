import { AppError } from "./app.error.js";

export class UnauthorizedError extends AppError {
  public constructor(reason = "no-session") {
    super("UNAUTHORIZED", { reason });
  }
}
