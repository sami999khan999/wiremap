// The bounds Better Auth enforces server-side, named once: a form advertising a shorter
// floor turns a rejection into an unexplained failure, and a longer one refuses early.
export class Password {
  private constructor() {}

  public static readonly MIN_LENGTH = 12;
  public static readonly MAX_LENGTH = 128;
}
