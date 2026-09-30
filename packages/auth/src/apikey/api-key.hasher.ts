import { ApiKeyRules, Token } from "../import.js";

// What authentication needs from a token, and nothing more: minting lives in
// `ApiKeyRules` because `application` is where a key is issued from.
export class ApiKeyHasher {
  private constructor() {}

  // Only the digest is stored, so a database dump contains no usable credential.
  public static hash(token: string): Promise<string> {
    return Token.hash(token);
  }

  // The indexed lookup column. Without it, authenticating a key is a scan-and-compare
  // over every key ever issued.
  public static prefixOf(token: string): string {
    return ApiKeyRules.prefixOf(token);
  }

  // Constant time in the length compared. The prefix already narrowed the candidate set,
  // so this costs nothing.
  public static timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }
}
