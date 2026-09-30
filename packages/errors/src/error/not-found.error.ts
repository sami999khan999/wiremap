import { AppError } from "./app.error.js";

export class NotFoundError extends AppError {
  public constructor(resource: string, id: string) {
    super("NOT_FOUND", { resource, id });
  }
}
