import { Buffer, ValidationError } from "../import.js";

// A line ordinal inside a named object, not a `(timestamp, id)` keyset — `KeysetCursor`
// is that one. Base64 for its reason: the client echoes back what it was given.
export class OrdinalCursor {
  private constructor() {}

  public static encode(ordinal: number): string {
    return Buffer.from(String(ordinal), "utf8").toString("base64url");
  }

  // A malformed cursor is a `ValidationError`, never a silent first page: a client that
  // reset to the top on every corrupt token would loop through the same rows forever.
  public static decode(cursor: string | null): number | null {
    if (cursor === null) return null;

    const ordinal = Number(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Number.isInteger(ordinal) || ordinal < 0) {
      throw new ValidationError([{ field: "cursor", rule: "invalid" }]);
    }

    return ordinal;
  }
}
