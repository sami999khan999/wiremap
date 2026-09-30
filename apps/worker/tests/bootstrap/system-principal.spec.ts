import { PermissionRegistry } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { SystemPrincipal } from "../../src/bootstrap/system-principal.js";

const ORG = "018f8c00-0000-7000-8000-000000000010";

describe("SystemPrincipal", () => {
  it("carries the organization it was asked for", () => {
    // There is no global system principal, because there is no global data — a job that
    // processes rows must know whose rows.
    expect(SystemPrincipal.forOrganization(ORG).organizationId).toBe(ORG);
  });

  it("acts as a system principal under a reserved actor id", () => {
    const principal = SystemPrincipal.forOrganization(ORG);

    expect(principal.kind).toBe("system");
    // Not the organization's own id: an actor column holding a tenant id reads as a user
    // to everyone who later queries the audit trail.
    expect(principal.userId).toBe(SystemPrincipal.USER_ID);
    expect(principal.userId).not.toBe(ORG);
  });

  it("holds exactly the two named grants and nothing else", () => {
    const principal = SystemPrincipal.forOrganization(ORG);

    expect(principal.can("ai.embedding.write")).toBe(true);
    expect(principal.can("ai.embedding.read")).toBe(true);

    // Never `PermissionRegistry.instance.all()`: this is the assertion that keeps the
    // list narrow as the catalog grows. `core.*` is excluded because no set grants it.
    const ungranted = PermissionRegistry.instance
      .all()
      .filter((key) => !["ai.embedding.write", "ai.embedding.read"].includes(key))
      .filter((key) => PermissionRegistry.instance.meta(key)?.module !== "core");

    expect(ungranted.length).toBeGreaterThan(0);
    for (const key of ungranted) expect(principal.can(key)).toBe(false);
  });

  // It writes audit rows, so it must hold this — and now does without being granted it.
  it("writes audit entries without a grant that says so", () => {
    const principal = SystemPrincipal.forOrganization(ORG);

    expect(principal.can("core.activity.write")).toBe(true);
    expect(principal.capabilities.toJSON().org.grants).not.toContain("core.activity.write");
  });

  it("is not a wildcard", () => {
    expect(SystemPrincipal.forOrganization(ORG).capabilities.toJSON().wildcard).toBe(false);
  });
});
