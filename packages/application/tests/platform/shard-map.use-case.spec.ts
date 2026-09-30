import { Identifiers } from "@loadbearing/contracts";
import { ForbiddenError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { InspectShardMapUseCase } from "../../src/platform/inspect-shard-map.use-case.js";
import { LocateTenantUseCase } from "../../src/platform/locate-tenant.use-case.js";
import type {
  ShardMapReader,
  ShardNode,
  ShardTenant,
  ShardTenantPage,
} from "../../src/platform/shard-map.reader.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const OTHER = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000012");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");

const PLACED = new Date("2026-09-01T00:00:00.000Z");

const NODE: ShardNode = { node: 0, tenants: 3, lastAssignedAt: PLACED, lastMovedAt: null };

const TENANT: ShardTenant = {
  organizationId: OTHER,
  slug: "acme",
  name: "Acme",
  node: 0,
  assignedAt: PLACED,
  movedAt: null,
  retentionOverrides: 2,
};

// Records what was asked of it, because the whole point of the `node` input is that the
// expensive read does not happen until a node is named.
class RecordingDirectory implements ShardMapReader {
  public nodeReads = 0;
  public readonly pages: { node: number; limit: number; offset: number }[] = [];
  public readonly terms: string[] = [];

  public nodes(): Promise<readonly ShardNode[]> {
    this.nodeReads += 1;
    return Promise.resolve([NODE]);
  }

  public tenantsOn(
    node: number,
    page: { limit: number; offset: number },
  ): Promise<ShardTenantPage> {
    this.pages.push({ node, ...page });
    return Promise.resolve({ items: [TENANT], total: 1 });
  }

  public findByTerm(term: string): Promise<ShardTenant | null> {
    this.terms.push(term);
    return Promise.resolve(term === "acme" ? TENANT : null);
  }
}

const actor = (...platform: readonly PermissionKey[]): Principal =>
  new Principal(
    ORG,
    ACTOR,
    CapabilitySet.from({
      wildcard: false,
      org: { grants: [], denies: [] },
      goals: {},
      platform: { grants: platform, denies: [] },
    }),
  );

describe("InspectShardMapUseCase", () => {
  it("refuses an actor without the platform read", async () => {
    await expect(
      new InspectShardMapUseCase(new Authorizer(), new RecordingDirectory(), false).execute(
        actor(),
        { limit: 25, offset: 0 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // Every node's tenants at once is the whole directory, which is the one read this
  // screen must never make. Naming a node is what buys the second query.
  it("reads no tenants until a node is named", async () => {
    const directory = new RecordingDirectory();
    const map = await new InspectShardMapUseCase(new Authorizer(), directory, false).execute(
      actor("platform.shards.read"),
      { limit: 25, offset: 0 },
    );

    expect(directory.pages).toEqual([]);
    expect(directory.nodeReads).toBe(1);
    expect(map.nodes).toEqual([NODE]);
    expect(map.tenants).toEqual([]);
    expect(map.total).toBe(0);
  });

  it("expands the node it was given, with the page it was given", async () => {
    const directory = new RecordingDirectory();
    const map = await new InspectShardMapUseCase(new Authorizer(), directory, false).execute(
      actor("platform.shards.read"),
      { limit: 10, offset: 20, node: 0 },
    );

    expect(directory.pages).toEqual([{ node: 0, limit: 10, offset: 20 }]);
    expect(map.tenants).toEqual([TENANT]);
    expect(map.total).toBe(1);
    expect(map.limit).toBe(10);
    expect(map.offset).toBe(20);
  });

  // Two words rather than a boolean, and the screen renders the reason. A disabled
  // button with no reason is a screen that looks broken.
  it("says moves are unavailable until the container says otherwise", async () => {
    const directory = new RecordingDirectory();
    const authorizer = new Authorizer();

    const without = await new InspectShardMapUseCase(authorizer, directory, false).execute(
      actor("platform.shards.read"),
      { limit: 25, offset: 0 },
    );
    const enabled = await new InspectShardMapUseCase(authorizer, directory, true).execute(
      actor("platform.shards.read"),
      { limit: 25, offset: 0 },
    );

    expect(without.moves).toBe("unavailable");
    expect(enabled.moves).toBe("available");
  });
});

describe("LocateTenantUseCase", () => {
  it("refuses an actor without the platform read", async () => {
    await expect(
      new LocateTenantUseCase(new Authorizer(), new RecordingDirectory(), false).execute(actor(), {
        term: "acme",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("finds a tenant and says which node holds it", async () => {
    const directory = new RecordingDirectory();
    const found = await new LocateTenantUseCase(new Authorizer(), directory, false).execute(
      actor("platform.shards.read"),
      { term: "  acme  " },
    );

    // Trimmed before it reaches the reader: a pasted id arrives with whitespace more
    // often than not, and an untrimmed term matches nothing for no visible reason.
    expect(directory.terms).toEqual(["acme"]);
    expect(found.tenant).toEqual(TENANT);
  });

  // A miss is what a typed search usually is. `NOT_FOUND` would make the screen render
  // an error for normal typing.
  it("answers null rather than throwing for a term nothing matches", async () => {
    const found = await new LocateTenantUseCase(
      new Authorizer(),
      new RecordingDirectory(),
      false,
    ).execute(actor("platform.shards.read"), { term: "nobody" });

    expect(found.tenant).toBeNull();
    expect(found.moves).toBe("unavailable");
  });

  // The tenant comes off the term, not off the principal: a platform admin is signed
  // into the platform organization and is asking about somebody else's.
  it("does not substitute the actor's own organization", async () => {
    const directory = new RecordingDirectory();
    await new LocateTenantUseCase(new Authorizer(), directory, false).execute(
      actor("platform.shards.read"),
      { term: "acme" },
    );

    expect(directory.terms).not.toContain(ORG);
  });
});
