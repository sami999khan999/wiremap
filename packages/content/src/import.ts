// Everything this package takes from outside itself, in one place. No relative
// re-exports live here — that is what keeps it cycle-free.

// ── @loadbearing/asset ────────────────────────────────────────────────
// Type-only for the key union, plus the manifest `StaticMediaResolver` reads. Content
// records hold `"brand.logo"`, never a path, which is what makes a CDN one resolver.
export { type IconName, type ImageKey, ImageManifest } from "@loadbearing/asset";

// ── @loadbearing/errors ───────────────────────────────────────────────
export type { ErrorCode, ErrorEnvelope, FieldViolation } from "@loadbearing/errors";

// ── @loadbearing/permissions ──────────────────────────────────────────
// Key types only: content titles the security surface and never defines it, and the two
// symbols that would let it are banned in ESLint. `WIDGET_COPY` is total over `WidgetKey`.
export type { ModuleKey, WidgetKey, ZoneKey } from "@loadbearing/permissions";

// ── zod ───────────────────────────────────────────────────────────────
export { z } from "zod";
