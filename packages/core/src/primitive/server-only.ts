import { ServerOnlyError } from "../import.js";

export class ServerOnly {
  private constructor() {}

  // Call at the top of every server-only package barrel.
  public static assert(packageName: string): void {
    // `globalThis.window`, not bare `window` — no DOM lib, so the identifier is TS2304.
    if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
      // No message. The words live in `content` as `error.serverOnly`.
      throw new ServerOnlyError(packageName);
    }
  }
}
