import { Identifiers } from "@loadbearing/contracts";
import { ForbiddenError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const USER = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

const actorWith = (...grants: readonly PermissionKey[]): Principal =>
  new Principal(
    ORG,
    USER,
    CapabilitySet.from({ wildcard: false, org: { grants, denies: [] }, goals: {} }),
  );

describe("Authorizer", () => {
  const authorizer = new Authorizer();

  it("passes silently when the permission is held", () => {
    expect(() => authorizer.assert(actorWith("rbac.role.read"), "rbac.role.read")).not.toThrow();
  });

  it("throws ForbiddenError when it is not", () => {
    expect(() => authorizer.assert(actorWith(), "rbac.role.read")).toThrow(ForbiddenError);
  });

  // The code and the context, never prose. A status code is a transport concern
  // and never reaches this package.
  it("throws a coded error carrying the permission", () => {
    try {
      authorizer.assert(actorWith(), "rbac.role.read");
      expect.unreachable("assert should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).code).toBe("FORBIDDEN");
      expect((error as ForbiddenError).context).toEqual({ permission: "rbac.role.read" });
    }
  });

  it("carries the goal id when the permission is goal-scoped", () => {
    try {
      authorizer.assert(actorWith(), "rbac.role.read", "goal-1");
      expect.unreachable("assert should have thrown");
    } catch (error) {
      expect((error as ForbiddenError).context).toEqual({
        permission: "rbac.role.read",
        goalId: "goal-1",
      });
    }
  });

  it("assertAll fails on the first permission not held", () => {
    const actor = actorWith("rbac.role.read");

    expect(() => authorizer.assertAll(actor, ["rbac.role.read", "rbac.role.manage"])).toThrow(
      ForbiddenError,
    );
  });
});
