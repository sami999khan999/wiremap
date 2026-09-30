// Everything this package takes from outside itself. No relative re-exports, which is
// what keeps it cycle-free — and no UI framework or cache library, ever.

// ── @loadbearing/contracts ───────────────────────────────────────────────────
export type { AppContract } from "@loadbearing/contracts";

// ── @loadbearing/errors ──────────────────────────────────────────────────────
// The transport is where a foreign error shape becomes one of ours. Free to load:
// `errors` carries no runtime dependency and no prose.
export {
  AccountSuspendedError,
  type AppError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  RateLimitedError,
  TwoFactorRequiredError,
  UnauthorizedError,
  ValidationError,
} from "@loadbearing/errors";

// ── @orpc/client ─────────────────────────────────────────────────────────────
export { createORPCClient } from "@orpc/client";
export { RPCLink } from "@orpc/client/fetch";

// ── @orpc/client/plugins ─────────────────────────────────────────────────────
// `retry` defaults to 0 and is read from the client context, so an ordinary call keeps
// its no-retry semantics and only the stream opts in.
export {
  ClientRetryPlugin,
  type ClientRetryPluginContext,
} from "@orpc/client/plugins";

// ── @orpc/contract ───────────────────────────────────────────────────────────
export type { ContractRouterClient } from "@orpc/contract";

// ── better-auth ──────────────────────────────────────────────────────────────
export { createAuthClient } from "better-auth/client";
export { twoFactorClient } from "better-auth/client/plugins";
