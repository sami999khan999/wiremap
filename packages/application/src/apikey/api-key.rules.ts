import { type PermissionKey, PermissionRegistry, Token, ValidationError } from "../import.js";

export interface MintedApiKey {
  // Shown to the issuer exactly once, at creation. Never stored, anywhere, ever.
  readonly token: string;
  readonly prefix: string;
  readonly tokenHash: string;
}

// The token's format, in one place because two layers depend on it: this mints, and
// `ApiKeyResolver` in `auth` authenticates. Two copies would drift into a dead key.
export class ApiKeyRules {
  private constructor() {}

  // Greppable on purpose. A leaked key is findable in a log or by a secret scanner
  // precisely because it does not look like any other hex string.
  public static readonly TOKEN_PREFIX = "rk_";
  public static readonly PREFIX_LENGTH = 8;

  // A write on the read path, so it is throttled rather than issued per request. The
  // column answers "roughly when", which is all anything reads it for.
  public static readonly TOUCH_THROTTLE_MS = 300_000;

  public static async mint(): Promise<MintedApiKey> {
    const token = `${ApiKeyRules.TOKEN_PREFIX}${Token.random()}`;

    return { token, prefix: ApiKeyRules.prefixOf(token), tokenHash: await Token.hash(token) };
  }

  public static prefixOf(token: string): string {
    return token.slice(0, ApiKeyRules.PREFIX_LENGTH);
  }

  // Narrowed once, here, so a caller can ask `actor.can()` about what comes back.
  public static assertKnownScopes(scopes: readonly string[]): readonly PermissionKey[] {
    const registry = PermissionRegistry.instance;
    const unknown = scopes.filter((scope) => !registry.isKnown(scope));
    if (unknown.length > 0) throw new ValidationError([{ field: "scopes", rule: "unknown" }]);

    return scopes as readonly PermissionKey[];
  }
}
