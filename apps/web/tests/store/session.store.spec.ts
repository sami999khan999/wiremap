import { CapabilitySet, type FlagKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { type SessionSnapshot, SessionStore } from "../../src/store/session.store.js";

const EXAMPLE_FLAG = "example.rollout" as FlagKey;

const OWNER: SessionSnapshot = {
  user: {
    id: "u1",
    email: "owner@example.com",
    name: "Owner",
    activeOrganizationId: "o1",
    organizations: [{ id: "o1", name: "Owner Org", roleName: "Owner" }],
    twoFactorEnabled: false,
  },
  capabilities: CapabilitySet.from({
    wildcard: false,
    org: { grants: ["rbac.role.read"], denies: [] },
    goals: {},
  }).toJSON(),
  isPlatformOrganization: false,
  googleEnabled: false,
  flags: [],
};

function counting(snapshot: SessionSnapshot) {
  let calls = 0;
  return {
    calls: () => calls,
    load: () => {
      calls += 1;
      return Promise.resolve(snapshot);
    },
  };
}

describe("SessionStore", () => {
  // The on-set crosses SSR with the rest, and an unresolved store holds none: a flagged
  // affordance renders hidden until the server says otherwise. Lite declares no flag.
  it("carries the flag on-set across the SSR boundary, and starts with none", () => {
    const store = new SessionStore();
    expect(store.flags).toEqual([]);

    store.restore({ ...OWNER, flags: [EXAMPLE_FLAG] });
    expect(store.flags).toEqual([EXAMPLE_FLAG]);
    expect(store.dehydrate().flags).toEqual([EXAMPLE_FLAG]);
  });

  // The security page picks the wizard or the panel from this field, and it used to be
  // read through a cast — `undefined` on every render, so the panel was unreachable.
  it("carries the two-factor flag across the SSR boundary", async () => {
    const store = new SessionStore();
    if (!OWNER.user) throw new Error("the fixture above is signed in");
    const enrolled: SessionSnapshot = {
      ...OWNER,
      user: { ...OWNER.user, twoFactorEnabled: true },
    };

    store.restore(enrolled);
    expect(store.user?.twoFactorEnabled).toBe(true);

    const fresh = new SessionStore();
    await fresh.ensure(() => Promise.resolve(enrolled));
    expect(fresh.user?.twoFactorEnabled).toBe(true);
  });

  it("starts signed out and denying everything", () => {
    const store = new SessionStore();

    // There is no loading state that grants access (23), so the initial value is the
    // safe one and resolution only ever widens it.
    expect(store.user).toBeNull();
    expect(CapabilitySet.from(store.dto).can("rbac.role.read")).toBe(false);
  });

  it("resolves once and never asks again", async () => {
    const store = new SessionStore();
    const loader = counting(OWNER);

    await store.ensure(loader.load);
    await store.ensure(loader.load);

    expect(loader.calls()).toBe(1);
    expect(store.user?.email).toBe("owner@example.com");
  });

  it("shares one request between concurrent callers", async () => {
    const store = new SessionStore();
    const loader = counting(OWNER);

    await Promise.all([store.ensure(loader.load), store.ensure(loader.load)]);

    // Two route matches resolving in the same tick must not become two round trips.
    expect(loader.calls()).toBe(1);
  });

  it("treats a restored snapshot as already resolved", async () => {
    const store = new SessionStore();
    const loader = counting(OWNER);

    store.restore(OWNER);
    await store.ensure(loader.load);

    // What keeps the browser from re-fetching during hydration: `hydrate` runs before the
    // first client render, so the root's `beforeLoad` is a no-op.
    expect(loader.calls()).toBe(0);
    expect(store.dehydrate()).toEqual(OWNER);
  });

  it("asks again after an invalidation, keeping the old answer until the new one lands", async () => {
    const store = new SessionStore();
    const loader = counting(OWNER);

    await store.ensure(loader.load);
    store.invalidate();

    // Without this a sign-in leaves the shell rendering signed-out for the life of the
    // tab — and the store must not flash anonymous in the meantime either.
    expect(store.user?.email).toBe("owner@example.com");

    await store.ensure(loader.load);
    expect(loader.calls()).toBe(2);
  });
});
