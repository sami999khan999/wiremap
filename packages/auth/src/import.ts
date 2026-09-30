// Everything this package takes from outside itself, in one place. No relative
// re-exports live here — that is what keeps it cycle-free.

// ── @loadbearing/application ─────────────────────────────────────────────────
export {
  type ApiKeyRecord,
  ApiKeyRepository,
  ApiKeyRules,
  type CacheStore,
  type CapabilityRepository,
  type PlatformReader,
  Principal,
  type RequestHeaders,
  type ResolvedSession,
  SessionGateway,
  SessionResolver,
} from "@loadbearing/application";

// ── @loadbearing/content ─────────────────────────────────────────────────────
// The locale vocabulary, because a recipient's language rides every message this
// package sends. `content` sits left of `application`, so the edge runs the right way.
export { type Locale, Locales } from "@loadbearing/content";

// ── @loadbearing/contracts ───────────────────────────────────────────────────
export { type OrganizationId, Password, type UserId } from "@loadbearing/contracts";

// ── @loadbearing/core ────────────────────────────────────────────────────────
export { ServerOnly, Token, Uuid } from "@loadbearing/core";

// ── @loadbearing/infrastructure ──────────────────────────────────────────────
export { Database } from "@loadbearing/infrastructure";

// ── @loadbearing/permissions ─────────────────────────────────────────────────
export {
  CapabilitySet,
  type CapabilitySetDto,
  type PermissionKey,
  PermissionRegistry,
} from "@loadbearing/permissions";

// ── better-auth ──────────────────────────────────────────────────────────────
export {
  type BetterAuthOptions,
  type BetterAuthPlugin,
  betterAuth,
  type GenericEndpointContext,
  type User,
} from "better-auth";
export { drizzleAdapter } from "better-auth/adapters/drizzle";
// The plugin authoring surface, for `OrganizationPlugin` and nothing else. The same
// three names Better Auth's own organization plugin is written against.
export { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
export { setSessionCookie } from "better-auth/cookies";
export { getSchema } from "better-auth/db";
export { bearer, twoFactor } from "better-auth/plugins";

// ── zod ──────────────────────────────────────────────────────────────────────
// Only for the plugin's request bodies. Better Auth validates an endpoint's `body`
// with whatever standard schema it is handed, and the catalog pins one zod.
export { z } from "zod";
