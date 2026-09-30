import { AppError } from "./app.error.js";

export class ForbiddenError extends AppError {
  public constructor(permission: string, goalId?: string) {
    super("FORBIDDEN", goalId ? { permission, goalId } : { permission });
  }
}
