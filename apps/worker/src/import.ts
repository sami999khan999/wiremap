// Everything this app takes from outside itself. `env.ts` is the one file that does not
// read from here, because it is parsed before anything else in the process exists.

// ── @loadbearing/application ─────────────────────────────────────────────────
export { QueueName } from "@loadbearing/application";

// ── @loadbearing/composition ─────────────────────────────────────────────────
// The worker never builds an adapter or runs a use-case itself: the container builds,
// and the registry holds every queue's consumer, shared with the web app's job route.
export { ConsumerRegistry, Container, type QueueJob } from "@loadbearing/composition";

// ── @loadbearing/infrastructure ──────────────────────────────────────────────
// `RedisConnection` is what applies `maxRetriesPerRequest: null`: a bare connection gets
// ioredis defaults, and the symptom is a worker that stops consuming silently.
export { RedisConnection } from "@loadbearing/infrastructure";

// ── bullmq ───────────────────────────────────────────────────────────────────
// The one `import.ts` in the repository that names the queue library: a package naming
// it would be a package that has to run in this process.
export { type Job, Queue, Worker } from "bullmq";

// ── ioredis ──────────────────────────────────────────────────────────────────
// Type-only. Every connection is built by `RedisConnection` above.
export type { Redis } from "ioredis";
