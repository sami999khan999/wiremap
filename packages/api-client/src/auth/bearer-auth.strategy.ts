import { AuthStrategy, type RequestCredentials } from "./auth.strategy.js";
import type { TokenProvider } from "./token.provider.js";

// A Tauri webview runs on a `tauri://` origin, so a cookie set by the API is never
// sent with its requests. That is the entire reason this class exists (30).
export class BearerAuthStrategy extends AuthStrategy {
  public constructor(private readonly tokens: TokenProvider) {
    super();
  }

  public override async headers(): Promise<Record<string, string>> {
    const token = await this.tokens.get();
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  // `omit`, not `include`. Sending a cookie the server will not read is a header
  // that leaks the session to any origin the desktop shell happens to call.
  public override get credentials(): RequestCredentials {
    return "omit";
  }
}
