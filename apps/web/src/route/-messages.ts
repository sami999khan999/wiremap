import type { ClientNamespace } from "~/import.js";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    // Namespaces this route's subtree may call `t()` with, beyond the shell. Readable
    // by a prefetcher or a coverage test without executing the loader.
    readonly messages?: readonly ClientNamespace[];
  }
}
