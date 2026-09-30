import { describe, expect, it } from "vitest";
import { Identifiers } from "../../src/primitive/index.js";
import { RoleContract, type RoleDto } from "../../src/role/role.contract.js";
import { RoleEntity } from "../../src/role/role.entity.js";
import { RoleProcedures } from "../../src/role/role.procedures.js";

// Typed as the DTO rather than inferred: `id` is branded, so an object literal is not
// assignable to it without going through `Identifiers`. That is the brand doing its job.
const VALID: RoleDto = {
  id: Identifiers.roleId.parse("018f8c00-0000-7000-8000-000000000010"),
  key: "admin",
  name: "Administrator",
  description: null,
  scope: "org" as const,
  isSystem: true,
  permissions: ["rbac.role.read", "member.read"],
};

describe("RoleContract", () => {
  it("brands the id, so a user id in its place is a compile error and a parse failure", () => {
    expect(() => RoleContract.entity.parse({ ...VALID, id: "not-a-uuid" })).toThrow();
  });

  it("accepts only the two scopes the schema declares", () => {
    expect(RoleContract.entity.parse({ ...VALID, scope: "goal" }).scope).toBe("goal");
    expect(() => RoleContract.entity.parse({ ...VALID, scope: "global" })).toThrow();
  });

  it("keeps a permission the catalog no longer knows", () => {
    // Filtering here would hide a rename behind a shorter list. The registry decides
    // what is still a permission, at the point of use — never the wire format.
    const parsed = RoleContract.entity.parse({ ...VALID, permissions: ["finance.invent"] });
    expect(parsed.permissions).toEqual(["finance.invent"]);
  });

  it("caps the list query in the schema rather than in a handler", () => {
    // A denial-of-service guard that applies to the worker and to any offline queue,
    // not only to whatever the HTTP layer happens to check.
    expect(() => RoleContract.listQuery.parse({ limit: 1000, offset: 0 })).toThrow();
    expect(RoleContract.listQuery.parse({}).limit).toBe(25);
  });
});

describe("RoleProcedures", () => {
  it("mounts every procedure it declares under `all`", () => {
    // The merge point in `procedure/index.ts` mounts `all` and nothing else, so a
    // procedure missing from it is a procedure that exists and is unreachable.
    expect(Object.keys(RoleProcedures.all).sort()).toEqual([
      "create",
      "effective",
      "entitlement",
      "grant",
      "list",
      "remove",
      "revoke",
      "update",
    ]);
    expect(RoleProcedures.all.list).toBe(RoleProcedures.list);
  });
});

describe("RoleEntity", () => {
  it("refuses to be built from a shape the contract rejects", () => {
    expect(() => RoleEntity.from({ ...VALID, name: "" })).toThrow();
  });

  it("answers whether a role may be edited", () => {
    // A seeded role is rewritten by `SystemRoleSeed` on every deploy, so an edit to one
    // survives until the next deploy and then silently disappears.
    expect(RoleEntity.from(VALID).editable).toBe(false);
    expect(RoleEntity.from({ ...VALID, isSystem: false }).editable).toBe(true);
  });

  it("names the wildcard role rather than leaving a full row unexplained", () => {
    expect(RoleEntity.from({ ...VALID, key: "owner" }).grantsEverything).toBe(true);
    expect(RoleEntity.from(VALID).grantsEverything).toBe(false);
  });
});
