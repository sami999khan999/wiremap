// The two HTTP entrypoints as the browser addresses them. This file exists because `Env`
// cannot reach the client bundle — see docs/reference/env.md.
export class Endpoint {
  private constructor() {}

  // Same-origin, so there is no host to configure. Kept in step with the handler's
  // `prefix` and with the file routes, which spell the path again.
  public static readonly rpcPath = "/api/rpc";
  // The stream process, behind the same origin: Vite proxies it in development and the
  // reverse proxy in production. See docs/infra/deployment.md.
  public static readonly realtimePath = "/api/realtime";
  public static readonly authPath = "/api/auth";

  // oRPC's `RPCLink` resolves this through `new URL()` with no second argument, so a
  // relative value throws `Invalid URL` on the first call — in the browser too.
  public static get rpc(): string {
    return `${Endpoint.origin()}${Endpoint.rpcPath}`;
  }

  public static get realtime(): string {
    return `${Endpoint.origin()}${Endpoint.realtimePath}`;
  }

  // Better Auth resolves `baseURL` through `new URL()` in its constructor, the same way.
  public static get auth(): string {
    return `${Endpoint.origin()}${Endpoint.authPath}`;
  }

  // `.invalid` never resolves, so a call that slips into SSR fails loudly rather than
  // quietly reaching some other localhost — see docs/reference/env.md.
  private static origin(): string {
    return typeof window === "undefined" ? "https://ssr.invalid" : window.location.origin;
  }
}
