import { Identifiers } from "@loadbearing/contracts";
import { ForbiddenError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";
import { ListRolesUseCase } from "../../src/rbac/list-roles.use-case.js";
import type { RolePage, RoleRecord, RoleRepository } from "../../src/rbac/role.repository.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const OTHER_ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-0000000000b0");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

function actorHolding(...grants: readonly PermissionKey[]): Principal {
  return new Principal(
    ORG,
    USER,
    CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} }),
  );
}

class RecordingRoleRepository implements RoleRepository {
  public readonly calls: { organizationId: string; limit: number; offset: number }[] = [];

  public list(
    organizationId: typeof ORG,
    page: { limit: number; offset: number },
  ): Promise<RolePage> {
    // Named one at a time, not `...page`: spreading would record the forged
    // `organizationId` the last test sends and assert on this double instead.
    this.calls.push({ organizationId, limit: page.limit, offset: page.offset });
    return Promise.resolve({
      items: [
        {
          id: Identifiers.roleId.parse("018f8c00-0000-7000-8000-0000000000c1"),
          key: "owner",
          name: "Owner",
          description: null,
          scope: "org",
          isSystem: true,
          permissions: ["rbac.role.read"],
        },
      ],
      total: 4,
    });
  }

  public findById(): Promise<RoleRecord | null> {
    throw new Error("not under test");
  }

  public findByKey(): Promise<RoleRecord | null> {
    throw new Error("not under test");
  }

  public save(): Promise<void> {
    throw new Error("not under test");
  }

  public delete(): Promise<void> {
    throw new Error("not under test");
  }

  public countAssignments(): Promise<number> {
    throw new Error("not under test");
  }
  public savePermission(): Promise<void> {
    throw new Error("not under test");
  }

  public deletePermission(): Promise<void> {
    throw new Error("not under test");
  }
}

describe("ListRolesUseCase", () => {
  it("denies a principal without rbac.role.read", async () => {
    const repository = new RecordingRoleRepository();
    const useCase = new ListRolesUseCase(new Authorizer(), repository);

    await expect(
      useCase.execute(actorHolding("member.read"), { limit: 25, offset: 0 }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // And denies *before* reading: a check after the query leaks what it returned into a
    // log or a timing.
    expect(repository.calls).toEqual([]);
  });

  it("returns the page for a principal that holds the permission", async () => {
    const useCase = new ListRolesUseCase(new Authorizer(), new RecordingRoleRepository());

    const result = await useCase.execute(actorHolding("rbac.role.read"), { limit: 10, offset: 20 });

    expect(result.items).toHaveLength(1);
    // The tenant's total, not the page's: what a pager needs and what `items.length`
    // cannot give it.
    expect(result.total).toBe(4);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(20);
  });

  it("takes the tenant from the principal and never from the input", async () => {
    const repository = new RecordingRoleRepository();
    const useCase = new ListRolesUseCase(new Authorizer(), repository);

    // No field on the input can reach another organization. The cast is how a spec states
    // that: even forced, it is ignored.
    await useCase.execute(actorHolding("rbac.role.read"), {
      limit: 25,
      offset: 0,
      ...({ organizationId: OTHER_ORG } as Record<string, unknown>),
    });

    expect(repository.calls).toEqual([{ organizationId: ORG, limit: 25, offset: 0 }]);
  });
});
