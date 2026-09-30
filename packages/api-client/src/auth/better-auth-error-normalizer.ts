import {
  AccountSuspendedError,
  type AppError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
} from "../import.js";

// Declared structurally rather than imported: the library's error type is generic over
// the configured plugins, and this file reads three fields.
export interface BetterAuthError {
  readonly code?: string | undefined;
  readonly status?: number | undefined;
  readonly message?: string | undefined;
}

// Only the codes a form branches on; everything else falls through to the status, then
// to `INTERNAL`. See docs/reference/better-auth.md.
const BY_CODE: Readonly<Record<string, () => AppError>> = {
  USER_ALREADY_EXISTS: () => new ConflictError("user", "email"),
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: () => new ConflictError("user", "email"),
  // One rule for every way a token can be unusable: both mean "ask for a new one".
  INVALID_TOKEN: () => new ValidationError([{ field: "token", rule: "invalid" }]),
  TOKEN_EXPIRED: () => new ValidationError([{ field: "token", rule: "invalid" }]),
  INVALID_OR_EXPIRED_TOKEN: () => new ValidationError([{ field: "token", rule: "invalid" }]),
  PASSWORD_TOO_SHORT: () => new ValidationError([{ field: "password", rule: "tooShort" }]),
  PASSWORD_TOO_LONG: () => new ValidationError([{ field: "password", rule: "tooLong" }]),
  // `NOT_FOUND` rather than `FORBIDDEN` for a dead invitation: it is the code the landing
  // page has copy for, and a 403 reads as "please sign in".
  NOT_A_MEMBER: () => new ForbiddenError("organization.switch"),
  INVITATION_NOT_CLAIMABLE: () => new NotFoundError("invitation", "token"),
  // Ours, thrown by the session hook. Without it the 403 reads as the generic refusal.
  ACCOUNT_SUSPENDED: () => new AccountSuspendedError(),
};

// Where a foreign error shape becomes one of ours. Not cosmetic: anything that is not an
// `AppError` maps to `INTERNAL` downstream, making every code branch unreachable.
export class BetterAuthErrorNormalizer {
  private constructor() {}

  public static normalize(error: BetterAuthError | null | undefined): AppError {
    // `Object.hasOwn` before the index: their code is a string from outside, and
    // `BY_CODE["toString"]` is a truthy function that returns no `AppError` when called.
    const code = error?.code;
    const mapped = code && Object.hasOwn(BY_CODE, code) ? BY_CODE[code] : undefined;
    if (mapped) return mapped();

    // The status, not the message: `error.message` is English prose that breaks on their
    // next release and in every locale but one.
    switch (error?.status) {
      case 429:
        return new RateLimitedError("auth");
      // No violation entry, because there is no field to name: one with an empty `field`
      // rendered as " is not valid.", a sentence opening on a space.
      case 400:
        return new ValidationError([]);
      case 401:
        return new UnauthorizedError("rejected");
      // Not `UNAUTHORIZED`: a 403 is a signed-in user who may not, and `error.unauthorized`
      // says "please sign in" — advice that cannot help and reads as a broken session.
      case 403:
        return new ForbiddenError("rejected");
      default:
        return new InternalError();
    }
  }
}
