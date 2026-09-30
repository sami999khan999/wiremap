import type { AppClientContext } from "~/import.js";
import { container } from "./container.js";
import { createRouterClient } from "./import.js";
import { appRouter } from "./orpc/app.router.js";

// SSR without a network hop. **Pass the real request headers** — in-process skips
// serialisation and nothing else. See docs/reference/server-functions.md.
export function createServerRpcClient(request: Request) {
  // The client context is named even though nothing in process reads it: `AppClient`
  // carries it since the retry plugin landed, and a client without it does not fit.
  return createRouterClient<typeof appRouter, AppClientContext>(appRouter, {
    context: { container, headers: request.headers },
  });
}
