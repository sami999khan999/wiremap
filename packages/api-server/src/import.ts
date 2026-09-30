// The one outside surface of the router side of the transport. `@orpc/server` is named here
// and in `apps/*/src/server/` only; the HTTP adapters stay in the apps.

// ── node ─────────────────────────────────────────────────────────────────────
// For the streaming wrap in `router/base.ts`: a snapshot taken inside the shard scope,
// called through on every frame. See packages/infrastructure/docs/reference/sharding.md.
export { AsyncLocalStorage } from "node:async_hooks";

// ── @loadbearing/application ─────────────────────────────────────────────────
// The channel builder, and the principal as a type. A router reaches everything else
// through a use-case on the container.
export { type Principal, RealtimeChannels } from "@loadbearing/application";

// ── @loadbearing/composition ─────────────────────────────────────────────────
export type { Container } from "@loadbearing/composition";

// ── @loadbearing/contracts ───────────────────────────────────────────────────
// `contract` is the shape every router mirrors, and `ProcedurePermissions` is the second
// of the four enforcement surfaces.
export { contract, ProcedurePermissions, type RealtimeMessage } from "@loadbearing/contracts";

// ── @loadbearing/errors ──────────────────────────────────────────────────────
// `HTTP_STATUS` is a transport concern, and this package is the transport's router half.
export {
  ErrorNormalizer,
  ForbiddenError,
  HTTP_STATUS,
  RateLimitedError,
  UnauthorizedError,
} from "@loadbearing/errors";

// ── @loadbearing/observability ───────────────────────────────────────────────
export { Correlation, type Logger, type TraceId } from "@loadbearing/observability";

// ── @orpc/server ─────────────────────────────────────────────────────────────
// Never `EventPublisher` from here. It is oRPC's own in-process fan-out, and reaching
// for it would put a second, replica-local realtime path beside the Redis one.
export { implement, ORPCError, os, withEventMeta } from "@orpc/server";
