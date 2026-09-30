import { AppError } from "./app.error.js";

// The platform's lock on the whole account. Told only after the password was right, so
// it answers nothing about whether an address has an account.
export class AccountSuspendedError extends AppError {
  public constructor() {
    super("ACCOUNT_SUSPENDED");
  }
}
