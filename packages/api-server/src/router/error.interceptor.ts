import { ErrorNormalizer, HTTP_STATUS, type Logger, ORPCError } from "../import.js";

export class ErrorInterceptor {
  private constructor() {}

  public static toTransport(thrown: unknown, log: Logger, traceId: string): never {
    // `normalize()` guarantees an `AppError` for anything thrown, so there is no
    // fall-through branch to get wrong and no CODE_MAP to keep in step.
    const error = ErrorNormalizer.normalize(thrown);

    // The one place every server-side failure passes through, so the one place that logs
    // it. `failure` reads the severity for its level.
    log.failure(error);

    // The envelope, not prose: the client reconstructs the class and renders it through
    // `content` in its own locale.
    throw new ORPCError(error.code, {
      status: HTTP_STATUS[error.code],
      data: { ...error.toJSON(), traceId },
    });
  }
}
