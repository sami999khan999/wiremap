// `lib.dom`'s `RequestCredentials`, restated: this package does not load the DOM lib,
// because it has to typecheck in a plain Node script too.
export type RequestCredentials = "omit" | "same-origin" | "include";

// How a request proves who is making it. Web sends a cookie, desktop sends a bearer
// token, and this seam is the entire difference between the two clients.
export abstract class AuthStrategy {
  public abstract headers(): Promise<Record<string, string>>;

  public abstract get credentials(): RequestCredentials;
}
