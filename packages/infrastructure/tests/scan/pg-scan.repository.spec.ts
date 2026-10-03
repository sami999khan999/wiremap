import {
  Identifiers,
  type OrganizationId,
  type ProjectId,
  type ScanId,
  type UserId,
} from "@loadbearing/contracts";
import { Uuid } from "@loadbearing/core";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/pg/primitive/index.js";
import { DatabaseCluster } from "../../src/pg/primitive/index.js";
import { PgOrganizationFounder } from "../../src/pg/repository/pg-organization.founder.js";
import { PgScanRepository } from "../../src/pg/repository/pg-scan.repository.js";
import { organizations, users } from "../../src/pg/schema/index.js";
import { ShardScope, TransactionScope } from "../../src/pg/transaction/index.js";
import { openDatabase } from "../support/database.js";
import { RecordingLogger } from "../support/recording.logger.js";

const shards = new ShardScope();
let database: Database;
let cluster: DatabaseCluster;
let acme: OrganizationId;
const created: UserId[] = [];
const project = Uuid.v7() as ProjectId;
const repository = () => new PgScanRepository(cluster, new TransactionScope(), shards);
const counts = {
  files: 3,
  imports: 2,
  resolved: 2,
  total: 2,
  routes: 1,
  cycles: 0,
  unguarded: 1,
  unusedFiles: 0,
};

const queue = async (state: "queued" | "running" = "queued") => {
  const id = Uuid.v7() as ScanId;
  await repository().create(acme, {
    id,
    projectId: project,
    trigger: "manual",
    state,
    branch: null,
    commitSha: null,
    requestedBy: null,
  });
  return id;
};

beforeAll(async () => {
  // One node, so everything routed is placed on it.
  shards.enter({ key: "spec" as never, node: 0 });
  database = openDatabase();
  cluster = DatabaseCluster.single(database);
  const owner = Identifiers.userId.parse(Uuid.v7());
  await database.client
    .insert(users)
    .values({ id: owner, name: "Owner", email: `${owner}@example.test`, emailVerified: true });
  created.push(owner);
  const scope = new TransactionScope();
  // No audit rows: they would reach the outbox, and `pg-outbox.spec.ts` drains it whole.
  const activity = { record: () => Promise.resolve() } as never;
  acme = await new PgOrganizationFounder(
    cluster,
    scope,
    shards,
    activity,
    new RecordingLogger(),
  ).found(owner, "Acme");
});

afterAll(async () => {
  await database.client.delete(organizations).where(eq(organizations.id, acme));
  await database.client.delete(users).where(inArray(users.id, created));
  await database.close();
});

describe("PgScanRepository", () => {
  it("moves a scan only forward, from the states each step names", async () => {
    const id = await queue();
    const scans = repository();

    expect((await scans.active(acme, project))?.id).toBe(id);
    expect(
      await scans.succeed(acme, id, {
        at: new Date(),
        graphKey: "k",
        graphBytes: 10,
        counts,
        analyzerVersion: "t",
        commitSha: "abc",
      }),
    ).toBe(false);
    expect(await scans.start(acme, id, new Date())).toBe(true);
    expect(await scans.start(acme, id, new Date())).toBe(false);
    expect(
      await scans.succeed(acme, id, {
        at: new Date(),
        graphKey: "k",
        graphBytes: 10,
        counts,
        analyzerVersion: "t",
        commitSha: "abc",
      }),
    ).toBe(true);
    expect(await scans.fail(acme, id, new Date(), "late")).toBe(false);

    const scan = await scans.findById(acme, id);
    expect(scan).toMatchObject({ state: "succeeded", counts, commitSha: "abc", graphKey: "k" });
    expect(await scans.active(acme, project)).toBeNull();
    expect((await scans.latestSucceeded(acme, project))?.id).toBe(id);
    expect(
      (await scans.list(acme, project, { limit: 10, offset: 0 })).total,
    ).toBeGreaterThanOrEqual(1);
  });

  it("replaces a project's open findings, and sweeps what has gone stale", async () => {
    const scans = repository();
    const scanId = await queue("running");
    await scans.replaceFindings(acme, project, scanId, {
      added: [
        { kind: "cycle", key: "a.ts → b.ts" },
        { kind: "unguarded_route", key: "GET /x" },
      ],
      removed: [],
    });
    await scans.replaceFindings(acme, project, scanId, {
      added: [],
      removed: [{ kind: "cycle", key: "a.ts → b.ts" }],
    });
    expect(await scans.openFindings(acme, project)).toEqual([
      { kind: "unguarded_route", key: "GET /x" },
    ]);

    const swept = await scans.failStale(new Date(Date.now() + 60_000), new Date(), "stale");
    expect(swept.map((scan) => scan.id)).toContain(scanId);
    expect((await scans.findById(acme, scanId))?.state).toBe("failed");
  });
});
