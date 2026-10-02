// The direct file, not `../registry/index.js`: that barrel loads `module-registry.ts`,
// which imports this folder back.
import { type PermissionKey, PermissionRegistry } from "../registry/permission-registry.js";

// Held by every resolved principal rather than granted through a role, so the rule is a
// lookup against `PermissionMeta.module`. Exported so a scope picker can exclude it.
export const CORE_MODULE = "core";

export interface ScopedSetDto {
  readonly grants: readonly PermissionKey[];
  readonly denies: readonly PermissionKey[];
}

// Frozen once rather than rebuilt per call: it is read on every `from()` and the arrays
// escape into a DTO that callers may hold.
const EMPTY_SET: ScopedSetDto = Object.freeze({
  grants: Object.freeze([]),
  denies: Object.freeze([]),
});

export interface CapabilitySetDto {
  readonly wildcard: boolean;
  readonly org: ScopedSetDto;
  readonly goals: Readonly<Record<string, ScopedSetDto>>;
  // Optional on the wire only. A DTO cached before this axis existed degrades to "no
  // platform rights", which is the safe reading; a required field would throw instead.
  readonly platform?: ScopedSetDto;
}

class ScopedSet {
  private readonly grants: ReadonlySet<PermissionKey>;
  private readonly denies: ReadonlySet<PermissionKey>;

  public constructor(dto: ScopedSetDto) {
    this.grants = new Set(dto.grants);
    this.denies = new Set(dto.denies);
  }

  public grantsPermission(permission: PermissionKey): boolean {
    return this.grants.has(permission);
  }

  public deniesPermission(permission: PermissionKey): boolean {
    return this.denies.has(permission);
  }
}

// Resolved capabilities for one principal — user or API key, same shape.
export class CapabilitySet {
  private readonly orgSet: ScopedSet;
  private readonly platformSet: ScopedSet;
  private readonly goalSets: ReadonlyMap<string, ScopedSet>;

  private constructor(private readonly dto: CapabilitySetDto) {
    this.orgSet = new ScopedSet(dto.org);
    this.platformSet = new ScopedSet(dto.platform ?? EMPTY_SET);
    this.goalSets = new Map(
      Object.entries(dto.goals).map(([id, s]): [string, ScopedSet] => [id, new ScopedSet(s)]),
    );
  }

  // The only way in, so the vocabulary boundary belongs here — a DTO also arrives from
  // Redis and from SSR, not just the database. The *sanitised* DTO is what gets stored.
  public static from(dto: CapabilitySetDto): CapabilitySet {
    return new CapabilitySet(CapabilitySet.sanitised(dto));
  }

  public static empty(): CapabilitySet {
    return new CapabilitySet({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {},
      platform: EMPTY_SET,
    });
  }

  private static union(
    left: readonly PermissionKey[],
    right: readonly PermissionKey[],
  ): PermissionKey[] {
    return [...new Set([...left, ...right])];
  }

  private static known(keys: readonly PermissionKey[]): PermissionKey[] {
    return keys.filter((key) => PermissionRegistry.instance.isKnown(key));
  }

  private static scopedSet(dto: ScopedSetDto): ScopedSetDto {
    return { grants: CapabilitySet.known(dto.grants), denies: CapabilitySet.known(dto.denies) };
  }

  // Goal keys survive an emptied set — `intersect()` unions goal keys across both sides.
  private static sanitised(dto: CapabilitySetDto): CapabilitySetDto {
    return {
      wildcard: dto.wildcard,
      org: CapabilitySet.scopedSet(dto.org),
      platform: CapabilitySet.scopedSet(dto.platform ?? EMPTY_SET),
      goals: Object.fromEntries(
        Object.entries(dto.goals).map(([id, set]): [string, ScopedSetDto] => [
          id,
          CapabilitySet.scopedSet(set),
        ]),
      ),
    };
  }

  // Deny by default; an explicit deny beats every grant, wildcard included. An undefined
  // permission is denied rather than thrown on — a `TypeError` here would be a 500.
  public can(permission: PermissionKey, goalId?: string): boolean {
    const scope = PermissionRegistry.instance.scopeOf(permission);
    if (!scope) return false;

    // The whole branch, and every line of it is load-bearing: a tenant's `wildcard` does
    // not reach a platform key, and `isCore` is not consulted. See docs/reference.
    if (scope === "platform") {
      if (this.platformSet.deniesPermission(permission)) return false;
      return this.platformSet.grantsPermission(permission);
    }

    if (scope === "goal") {
      if (!goalId) return false;
      const goal = this.goalSets.get(goalId);
      if (goal?.deniesPermission(permission)) return false;
      if (this.orgSet.deniesPermission(permission)) return false;
      if (this.dto.wildcard || CapabilitySet.isCore(permission)) return true;
      return (
        (goal?.grantsPermission(permission) ?? false) || this.orgSet.grantsPermission(permission)
      );
    }

    return this.allowsAtOrg(permission);
  }

  // Held for every goal at once: the org level, which a goal-scoped key also reads. What a
  // role hands out is judged by this, since a role is not assigned inside one goal.
  public canTenantWide(permission: PermissionKey): boolean {
    const scope = PermissionRegistry.instance.scopeOf(permission);
    if (!scope) return false;
    if (scope === "platform") return this.can(permission);
    return this.allowsAtOrg(permission);
  }

  // The first key of a role this set may not hand out, or null. No escalation by assignment:
  // unknown keys and keys the plan masks are skipped, since nobody can hold those.
  public cannotAssign(
    permissions: readonly string[],
    isEntitled: (permission: PermissionKey) => boolean,
  ): PermissionKey | null {
    for (const permission of permissions) {
      if (!PermissionRegistry.instance.isKnown(permission)) continue;
      if (!isEntitled(permission)) continue;
      if (!this.canTenantWide(permission)) return permission;
    }
    return null;
  }

  public canAll(permissions: readonly PermissionKey[], goalId?: string): boolean {
    return permissions.every((permission) => this.can(permission, goalId));
  }

  public canAny(permissions: readonly PermissionKey[], goalId?: string): boolean {
    return permissions.some((permission) => this.can(permission, goalId));
  }

  // The candidate set is required because this object cannot produce it: a wildcard or
  // org-level grant holds the permission in goals its own DTO never names.
  public goalsWith(permission: PermissionKey, amongGoalIds: readonly string[]): readonly string[] {
    return [...new Set(amongGoalIds)].filter((id) => this.can(permission, id));
  }

  // Denies union, grants intersect, goal keys union — see docs/reference/capability-set.md.
  // Org candidates use `allowsAtOrg`, not `can()`.
  public intersect(other: CapabilitySet): CapabilitySet {
    const goalIds = new Set([...Object.keys(this.dto.goals), ...Object.keys(other.dto.goals)]);
    const orgCandidates = CapabilitySet.union(this.dto.org.grants, other.dto.org.grants);

    return CapabilitySet.from({
      wildcard: this.dto.wildcard && other.dto.wildcard,
      // Emptied, never intersected. An API key is issued by a user who may be a platform
      // admin, and a key that could act as one is a platform admin nobody can revoke.
      platform: EMPTY_SET,
      org: {
        grants: orgCandidates.filter(
          (permission) => this.allowsAtOrg(permission) && other.allowsAtOrg(permission),
        ),
        denies: CapabilitySet.union(this.dto.org.denies, other.dto.org.denies),
      },
      goals: Object.fromEntries(
        [...goalIds].map((goalId): [string, ScopedSetDto] => {
          const mine = this.dto.goals[goalId];
          const theirs = other.dto.goals[goalId];

          return [
            goalId,
            {
              grants: CapabilitySet.union(mine?.grants ?? [], theirs?.grants ?? []).filter(
                (permission) => this.can(permission, goalId) && other.can(permission, goalId),
              ),
              denies: CapabilitySet.union(mine?.denies ?? [], theirs?.denies ?? []),
            },
          ];
        }),
      ),
    });
  }

  public toJSON(): CapabilitySetDto {
    return this.dto;
  }

  // `can()` for an org-scoped permission — and the org half of a goal-scoped one.
  private allowsAtOrg(permission: PermissionKey): boolean {
    if (this.orgSet.deniesPermission(permission)) return false;
    if (this.dto.wildcard || CapabilitySet.isCore(permission)) return true;
    return this.orgSet.grantsPermission(permission);
  }

  // The one exception to deny-by-default, and it is checked after denies like the
  // wildcard is — see docs/reference/capability-set.md.
  private static isCore(permission: PermissionKey): boolean {
    return PermissionRegistry.instance.meta(permission)?.module === CORE_MODULE;
  }
}
