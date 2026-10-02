import type { DispatchedMessage } from "./primitive/index.js";

// The Worker's bindings and secrets, as `wrangler.toml` and `wrangler secret put` give
// them. A Worker has no `process.env`: Cloudflare hands this object to every handler.
export interface Env {
  readonly JOBS: Queue<DispatchedMessage>;
  // Where a message goes once it has used every attempt it asked for. Read by hand.
  readonly DEAD: Queue<DispatchedMessage>;
  // The web app's origin; each delivery is a POST to `<WEB_URL>/api/internal/job`.
  readonly WEB_URL: string;
  // Checks what the web app enqueues, and signs what goes back to it.
  readonly DISPATCHER_SECRET: string;
  readonly INTERNAL_JOB_SECRET: string;
}
