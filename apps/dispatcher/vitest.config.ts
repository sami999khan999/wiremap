import { defineConfig } from "vitest/config";

// Plain Node, not the Workers pool: every handler here is fetch, WebCrypto and the queue
// bindings, and Node 24 has the first two while the specs fake the third.
export default defineConfig({
  test: { include: ["tests/**/*.spec.ts"] },
});
