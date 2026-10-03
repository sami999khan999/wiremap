import { describe, expect, it } from "vitest";
import { type PermissionKey, PermissionRegistry } from "../../src/registry/permission-registry.js";

const registry = PermissionRegistry.instance;

describe("PermissionRegistry", () => {
  it("accepts a key the catalog defines and rejects one it does not", () => {
    expect(registry.isKnown("rbac.role.read")).toBe(true);
    expect(registry.isKnown("rbac.role.delete")).toBe(false);
    expect(registry.isKnown("")).toBe(false);
  });

  it("does not mistake an inherited object property for a permission", () => {
    expect(registry.isKnown("toString")).toBe(false);
    expect(registry.isKnown("constructor")).toBe(false);
  });

  it("lists every key exactly once", () => {
    const all = registry.all();

    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain("apikey.manage");
  });

  it("groups keys by module and returns nothing for a module it has never seen", () => {
    // Insertion order of the fragments merged in `catalog/index.ts`.
    expect(registry.modules()).toEqual([
      "core",
      "rbac",
      "member",
      "notification",
      "apikey",
      "ai",
      "platform",
      "doc",
      "organization",
      "audit",
      "project",
    ]);

    const grouped = registry.modules().flatMap((module) => registry.byModule(module));
    expect(grouped).toHaveLength(registry.all().length);

    expect(registry.byModule("finance")).toEqual([]);
  });

  // The regression guard: `member.*` and `apikey.*` declared `module: "rbac"`, so
  // `byModule("member")` answered nothing about a module that has a gate.
  it("declares the module its key opens with", () => {
    for (const key of registry.all()) {
      expect(key.startsWith(`${registry.meta(key)?.module}.`)).toBe(true);
    }
  });

  it("carries scope on the permission rather than the check", () => {
    expect(registry.scopeOf("rbac.role.read")).toBe("org");
    expect(registry.meta("member.invite")?.label).toBe("Invite members");
  });

  // Reachable only at runtime — a cast, or a cached DTO naming a deleted permission.
  // Blind indexing turned that into a `TypeError` inside `can()`, and a 403 into a 500.
  it("returns undefined rather than throwing for a key it does not define", () => {
    const gone = "task.archive" as PermissionKey;

    expect(registry.meta(gone)).toBeUndefined();
    expect(registry.scopeOf(gone)).toBeUndefined();
  });

  it("returns the same array instance across calls", () => {
    expect(registry.all()).toBe(registry.all());
    expect(registry.modules()).toBe(registry.modules());
    expect(registry.byModule("rbac")).toBe(registry.byModule("rbac"));
  });
});

// `requires` is closed over on an add and its mirror on a remove or a deny. A requirement
// in another scope would let a tenant grant pull a platform key in behind it.
describe("PermissionRegistry — requirements", () => {
  it("names only known keys, each in the scope of the key that needs it", () => {
    for (const key of registry.all()) {
      const declared = registry.meta(key)?.requires ?? [];

      expect(registry.requirementsOf(key)).toHaveLength(declared.length);
      for (const requirement of registry.requirementsOf(key)) {
        expect(registry.scopeOf(requirement)).toBe(registry.scopeOf(key));
      }
    }
  });

  it("closes an add over what it needs, transitively and input first", () => {
    expect(registry.closure(["member.invite"])).toEqual([
      "member.invite",
      "member.read",
      "rbac.role.read",
    ]);
    expect(registry.closure(["member.read"])).toEqual(["member.read"]);
  });

  // The reason `RV.13` exists: without the role list, the invite form's picker is empty.
  it("closes a remove over what depends on it", () => {
    const taken = registry.dependentClosure(["rbac.role.read"]);

    expect(taken[0]).toBe("rbac.role.read");
    expect(taken).toContain("member.invite");
    expect(taken).toContain("member.role.change");
    expect(taken).toContain("rbac.role.manage");
    expect(taken).not.toContain("member.read");
  });

  it("is idempotent in both directions", () => {
    for (const key of registry.all()) {
      const up = registry.closure([key]);
      const down = registry.dependentClosure([key]);

      expect(registry.closure(up)).toEqual(up);
      expect(registry.dependentClosure(down)).toEqual(down);
    }
  });

  // The walk keeps a visited set, so a cycle would end rather than hang. The catalog
  // has none, and a key that ended up requiring itself would be a declaration mistake.
  it("has no cycle, and closing over every key ends", () => {
    for (const key of registry.all()) {
      const others = registry.closure(registry.requirementsOf(key));
      expect(others).not.toContain(key);
    }
    expect(registry.closure(registry.all())).toHaveLength(registry.all().length);
  });
});
