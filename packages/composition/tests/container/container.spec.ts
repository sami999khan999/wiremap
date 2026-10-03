import {
  AuthFactory,
  DomainJoiningEnroller,
  InvitationClaimingEnroller,
  NullMembershipEnroller,
} from "@loadbearing/auth";
import {
  PgBootstrapMembershipEnroller,
  PgPersonalOrganizationEnroller,
} from "@loadbearing/infrastructure";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContainerConfig } from "../../src/container/container.config.js";
import { Container } from "../../src/container/container.js";
import { authConfig, baseConfig } from "../support/config.js";

// Every container built here is disposed, or the two Redis sockets its constructor opens
// keep the run alive after the last assertion.
const open: Container[] = [];

const build = (overrides: Partial<ContainerConfig> = {}) => {
  const container = new Container({ ...baseConfig(), ...overrides });
  open.push(container);
  return container;
};

afterEach(async () => {
  await Promise.all(open.splice(0).map((container) => container.dispose()));
  vi.restoreAllMocks();
});

// The enroller is a local in the constructor, so it is read at the one seam it crosses:
// `AuthFactory.create`. `spyOn` calls through, so the container built is the real one.
const enrolerFor = (mode: "personal" | "bootstrap" | "invite") => {
  const created = vi.spyOn(AuthFactory, "create");
  build({ auth: authConfig(mode) });

  const call = created.mock.calls[0];
  if (!call) throw new Error("AuthFactory.create was not called");
  return call[4];
};

describe("Container — the enrolment branch", () => {
  // The one line in the system that knows which mode is bound, and binding the wrong one
  // means a sign-up completes and the account belongs to no tenant.
  it("binds the personal enroller under `personal`", () => {
    const enroller = enrolerFor("personal");

    expect(enroller).toBeInstanceOf(InvitationClaimingEnroller);
    expect(inner(enroller)).toBeInstanceOf(PgPersonalOrganizationEnroller);
  });

  it("binds the bootstrap enroller under `bootstrap`", () => {
    expect(inner(enrolerFor("bootstrap"))).toBeInstanceOf(PgBootstrapMembershipEnroller);
  });

  it("binds nothing but the claimer under `invite`", () => {
    expect(inner(enrolerFor("invite"))).toBeInstanceOf(NullMembershipEnroller);
  });

  // Every mode is wrapped, which is what makes an invited address join the organization
  // that invited it before the mode is consulted at all.
  it("wraps all three in the invitation claimer", () => {
    for (const mode of ["personal", "bootstrap", "invite"] as const) {
      expect(enrolerFor(mode)).toBeInstanceOf(InvitationClaimingEnroller);
      vi.restoreAllMocks();
    }
  });
});

// The wrapper holds its inner enroller privately; reading it is the only way to say
// which of the three was chosen without standing up three deployments.
// ──
// Two layers since wiremap: the invitation claim wraps the domain join, which wraps the mode.
function inner(enroller: unknown): unknown {
  const domains = (enroller as { inner: unknown }).inner;
  expect(domains).toBeInstanceOf(DomainJoiningEnroller);
  return (domains as { inner: unknown }).inner;
}

describe("Container — what a process built without auth cannot reach", () => {
  // One `it` per name rather than a loop: all five throw the same sentence, and a loop
  // over them passes with a getter wired to the wrong field.
  it("throws for `auth`", () => {
    expect(() => build().auth).toThrow("without an auth config");
  });

  it("throws for `apiKey`", () => {
    expect(() => build().apiKey).toThrow("without an auth config");
  });

  it("throws for `member`", () => {
    expect(() => build().member).toThrow("without an auth config");
  });

  it("throws for `sessions`", () => {
    expect(() => build().sessions).toThrow("without an auth config");
  });

  it("throws for `principals`", () => {
    expect(() => build().principals).toThrow("without an auth config");
  });

  it("hands all five back once an auth config is present", () => {
    const container = build({ auth: authConfig("invite") });

    expect(container.auth).toBeDefined();
    expect(container.apiKey.createApiKey).toBeDefined();
    expect(container.member.inviteMember).toBeDefined();
    expect(container.sessions).toBeDefined();
    expect(container.principals).toBeDefined();
  });
});

describe("Container — the derived stores", () => {
  it("builds the archive with no derived store configured", () => {
    const container = build();

    expect(container.partitionArchive).toBeDefined();
  });
});

describe("Container — the vector driver", () => {
  it("refuses a driver it does not know rather than returning undefined", () => {
    // The union has one member, so the unknown case is unreachable in types and is
    // exactly the case the `never` in that switch exists to catch.
    const config = {
      ...baseConfig(),
      vector: { driver: "pinecone" },
    } as unknown as ContainerConfig;

    expect(() => new Container(config)).toThrow("Unknown vector driver: pinecone");
  });
});

describe("Container.dispose", () => {
  // A wrong order is a deadlock: closing Redis while BullMQ holds blocking connections
  // hangs the shutdown. Nothing but the private fields can observe which went first.
  it("closes the queue before Redis, and Postgres last", async () => {
    const container = new Container(baseConfig());
    const closed: string[] = [];

    const internals = container as unknown as Record<string, { close: () => Promise<void> }>;
    for (const name of ["queuePublisher", "redis", "emailSender", "database"]) {
      const held = internals[name];
      if (!held) throw new Error(`the container has no ${name} to close`);
      const original = held.close.bind(held);
      held.close = async () => {
        closed.push(name);
        await original();
      };
    }

    await container.dispose();

    // `database` closes through `DatabaseCluster.close()`, which holds node 0 — the
    // same object, so patching its `close` still observes the order.
    expect(closed).toEqual(["queuePublisher", "redis", "emailSender", "database"]);
  });
});

describe("Container.dispose — a close that fails", () => {
  // `CR.36`: one rejected close used to skip every close after it, Postgres included.
  it("still closes Postgres when Redis fails to close", async () => {
    const container = new Container(baseConfig());
    const internals = container as unknown as Record<string, { close: () => Promise<void> }>;
    const redis = internals.redis;
    const database = internals.database;
    if (!redis || !database) throw new Error("the container has no redis or database");

    const realRedisClose = redis.close.bind(redis);
    redis.close = async () => {
      await realRedisClose();
      throw new Error("redis would not close");
    };
    const closeDatabase = vi.spyOn(database, "close");

    await expect(container.dispose()).resolves.toBeUndefined();
    expect(closeDatabase).toHaveBeenCalled();
  });
});

describe("Container.eachShard", () => {
  // `CR.14`: node 2 of 3 failing used to mean node 3 was never reached at all.
  it("runs every node when one fails, then fails with the first error", async () => {
    const container = build();
    const internals = container as unknown as {
      cluster: { size: number };
      shards: { atNode: (node: number, work: () => Promise<void>) => Promise<void> };
    };
    Object.defineProperty(internals.cluster, "size", { value: 3 });
    internals.shards.atNode = (_node, work) => work();

    const reached: number[] = [];
    const broken = new Error("node 1 is down");

    await expect(
      container.eachShard(async (node) => {
        reached.push(node);
        if (node === 1) throw broken;
      }),
    ).rejects.toBe(broken);
    expect(reached).toEqual([0, 1, 2]);
  });
});

describe("Container.health", () => {
  it("reports each dependency separately and rolls them up", async () => {
    const report = await build().health();

    // Keyed by node index, not a boolean: one node reads `{ 0: true }`.
    expect(report.database).toEqual({ 0: true });
    expect(report.cache).toBe(true);
    expect(report.queue).toBe(true);
    // `null` rather than `true`: this deployment is not running one, which is neither
    // healthy nor degraded.
    expect(report.analytics).toBeNull();
    // Same rule, different reason: nothing has opened a stream, so there is no
    // subscriber connection — and asking would have created the thing being reported on.
    expect(report.realtime).toBeNull();
    expect(report.healthy).toBe(true);
  });

  it("is unhealthy when a dependency it cannot serve requests without is down", async () => {
    const container = build({ database: { url: "postgres://nobody@localhost:1/none" } });
    const report = await container.health();

    expect(report.database).toEqual({ 0: false });
    expect(report.healthy).toBe(false);
  });
});
