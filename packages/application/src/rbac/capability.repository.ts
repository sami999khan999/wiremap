import type { CapabilitySet, EntitlementMask, OrganizationId, UserId } from "../import.js";

// One live override, with what the screens need to say where it came from. Raw strings,
// like a role's: the registry decides what a stale key means.
export interface OverrideRecord {
  readonly id: string;
  readonly permission: string;
  readonly effect: "grant" | "deny";
  readonly goalId: string | null;
  // `platform` is a deny the tier set, which the org admin cannot clear.
  readonly authority: "org" | "platform";
  readonly reason: string | null;
  // Null on a deny, which never lapses. A grant always has one.
  readonly expiresAt: Date | null;
}

// The ingredients of a resolution, before they are folded into a `CapabilitySet`. The
// inspector names each answer's source from this; `resolveFor` is the fold.
export interface CapabilityExplanation {
  // Raw strings, as the rows hold them. `resolveFor` narrows through `isKnown`.
  readonly roleGrants: readonly string[];
  readonly goalGrants: Readonly<Record<string, readonly string[]>>;
  // Live only: an expired grant is already gone from the answer, so it is gone from here.
  readonly overrides: readonly OverrideRecord[];
  readonly entitlement: EntitlementMask;
}

// A repository port, so it lives with its subject rather than in `port/` — one
// file per slice there would grow forever.
export abstract class CapabilityRepository {
  // Both branded: two opaque uuids in a row, so a swap compiles and returns a
  // confidently wrong `CapabilitySet` rather than an error.
  public abstract resolveFor(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<CapabilitySet>;

  // The same four statements as `resolveFor`, unfolded. Never cached: the inspector reads
  // it to answer "why", and a cached answer to that question is the wrong one.
  public abstract explainFor(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<CapabilityExplanation>;

  // Keyed on the user alone: the tier is one organization, and the answer does not
  // change with whichever tenant the session is pointed at. **Only** the platform axis.
  public abstract resolvePlatformFor(userId: UserId): Promise<CapabilitySet>;

  // What the org's plan allows, adjustments and the kill switch included. `resolveFor`
  // already applies it; this is for a caller that must know the ceiling itself.
  public abstract entitlementFor(organizationId: OrganizationId): Promise<EntitlementMask>;
}
