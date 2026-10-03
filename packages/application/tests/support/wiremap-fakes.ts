import { Identifiers, type OrganizationId, type RoleId, type UserId } from "@loadbearing/contracts";
import { CapabilitySet, EntitlementMask, type PermissionKey } from "@loadbearing/permissions";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../../src/port/index.js";
import { Principal } from "../../src/primitive/principal.js";
import type { CapabilityRepository } from "../../src/rbac/capability.repository.js";
import type { RoleRecord, RoleRepository } from "../../src/rbac/role.repository.js";

// Shared by the wiremap slices' specs: one tenant, one actor, and the fakes every
// use-case constructor asks for. The kit's own specs keep their local copies.
export const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-0000000000a0");
export const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-0000000000a1");
export const OTHER = Identifiers.userId.parse("018f8c00-0000-7000-8000-0000000000a2");
export const OWNER_ROLE = Identifiers.roleId.parse("018f8c00-0000-7000-8000-0000000000b1");
export const ADMIN_ROLE = Identifiers.roleId.parse("018f8c00-0000-7000-8000-0000000000b2");
export const MEMBER_ROLE = Identifiers.roleId.parse("018f8c00-0000-7000-8000-0000000000b3");

export const CLOCK = { now: () => new Date("2026-10-03T00:00:00.000Z") };

export function holding(...grants: readonly PermissionKey[]): Principal {
  return new Principal(
    ORG,
    ACTOR,
    CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} }),
  );
}

export class RecordingActivity implements ActivityLogger {
  public readonly records: { action: string; payload: Record<string, unknown> }[] = [];

  public record(_actor: Principal, action: string, payload: Readonly<Record<string, unknown>>) {
    this.records.push({ action, payload: { ...payload } });
    return Promise.resolve();
  }

  public actions(): string[] {
    return this.records.map((record) => record.action);
  }
}

export class DirectUnitOfWork implements UnitOfWork {
  public run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

export class RecordingInvalidator implements CapabilityInvalidator {
  public readonly users: UserId[] = [];
  public organizations = 0;

  public invalidate(_org: OrganizationId, userId: UserId) {
    this.users.push(userId);
    return Promise.resolve();
  }

  public invalidateOrganization() {
    this.organizations += 1;
    return Promise.resolve();
  }

  public invalidatePlatform() {
    return Promise.resolve();
  }

  public invalidateAll() {
    return Promise.resolve();
  }
}

const role = (id: RoleId, key: string, permissions: readonly PermissionKey[]): RoleRecord =>
  ({ id, key, name: key, scope: "org", isSystem: true, permissions }) as unknown as RoleRecord;

// Owner, admin and member, granting `member.read` only, so any actor holding it may hand
// each out. The assignability rule itself is `RoleRules`', tested in the rbac specs.
export function stubRoles(): RoleRepository {
  const roles = [
    role(OWNER_ROLE, "owner", ["member.read"]),
    role(ADMIN_ROLE, "admin", ["member.read"]),
    role(MEMBER_ROLE, "member", ["member.read"]),
  ];
  return {
    findById: (_org: OrganizationId, id: RoleId) =>
      Promise.resolve(roles.find((candidate) => candidate.id === id) ?? null),
    findByKey: (_org: OrganizationId, key: string) =>
      Promise.resolve(roles.find((candidate) => candidate.key === key) ?? null),
  } as unknown as RoleRepository;
}

export const unlimited = {
  entitlementFor: () =>
    Promise.resolve(
      EntitlementMask.from({ plan: "all", added: [], removed: [], disabledModules: [] }),
    ),
} as unknown as CapabilityRepository;
