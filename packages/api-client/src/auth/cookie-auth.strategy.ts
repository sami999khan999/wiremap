import { AuthStrategy, type RequestCredentials } from "./auth.strategy.js";

// The browser. Nothing to add to the headers: the cookie rides along because
// `credentials: "include"` tells fetch to send it cross-origin.
export class CookieAuthStrategy extends AuthStrategy {
  public override headers(): Promise<Record<string, string>> {
    return Promise.resolve({});
  }

  public override get credentials(): RequestCredentials {
    return "include";
  }
}
