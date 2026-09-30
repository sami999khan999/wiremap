// Everything this app takes from outside itself. `env.ts` is the one file that does not
// read from here, because it is parsed before anything else in the process exists.

// ── @loadbearing/application ─────────────────────────────────────────────────
// The principal a consumer runs as. `SystemPrincipal` narrows it; nothing here
// constructs a user's.
export {
  type ArchivedPartition,
  PartitionedTable,
  type PartitionedTableEntry,
  type PartitionedTableName,
  Principal,
  QueueName,
  RetentionRules,
  Shard,
  type TenantRunway,
} from "@loadbearing/application";

// ── @loadbearing/composition ─────────────────────────────────────────────────
// A value in `main.ts` and a type everywhere else. The worker never builds an adapter
// itself; it asks the container.
export { Container } from "@loadbearing/composition";

// ── @loadbearing/contracts ───────────────────────────────────────────────────
// The envelope, because a `deliver` job crosses Redis as JSON and has to be parsed back
// into a typed event rather than trusted.
export {
  type ActivityAction,
  DomainEvents,
  type OrganizationId,
  type UserId,
} from "@loadbearing/contracts";

// ── @loadbearing/infrastructure ──────────────────────────────────────────────
// `RedisConnection` is what applies `maxRetriesPerRequest: null`: a bare connection gets
// ioredis defaults, and the symptom is a worker that stops consuming silently.
export { RedisConnection } from "@loadbearing/infrastructure";

// ── @loadbearing/permissions ─────────────────────────────────────────────────
export { CapabilitySet, type PermissionKey, PermissionRegistry } from "@loadbearing/permissions";

// ── bullmq ───────────────────────────────────────────────────────────────────
// The one `import.ts` in the repository that names the queue library: a package naming
// it would be a package that has to run in this process.
export { type Job, Queue, Worker } from "bullmq";

// ── ioredis ──────────────────────────────────────────────────────────────────
// Type-only. Every connection is built by `RedisConnection` above.
export type { Redis } from "ioredis";
