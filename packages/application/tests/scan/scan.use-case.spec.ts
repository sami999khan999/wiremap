import {
  GRAPH_VERSION,
  type GraphDocument,
  type OrganizationId,
  type ProjectId,
  type ScanId,
} from "@loadbearing/contracts";
import { NotFoundError, UnauthorizedError, ValidationError } from "@loadbearing/errors";
import { describe, expect, it } from "vitest";
import type { DomainEventPublisher } from "../../src/port/domain-event.publisher.js";
import { QueuePublisher } from "../../src/port/queue.publisher.js";
import type { RepositoryProvider } from "../../src/port/repository.provider.js";
import type { ProjectRecord } from "../../src/project/project.repository.js";
import { CheckoutScanUseCase } from "../../src/scan/checkout-scan.use-case.js";
import { CompleteScanUseCase } from "../../src/scan/complete-scan.use-case.js";
import { FailScanUseCase } from "../../src/scan/fail-scan.use-case.js";
import type { GraphArchive } from "../../src/scan/graph-archive.js";
import { QueueScanUseCase } from "../../src/scan/queue-scan.use-case.js";
import {
  type FindingKey,
  type NewScan,
  type ScanRecord,
  ScanRepository,
  type SweptScan,
} from "../../src/scan/scan.repository.js";
import { ScanRefs } from "../../src/scan/scan-ref.js";
import { ScanRunner } from "../../src/scan/scan-runner.js";
import { ScanTokens } from "../../src/scan/scan-tokens.js";
import { SweepScansUseCase } from "../../src/scan/sweep-scans.use-case.js";
import { CLOCK, DirectUnitOfWork, holding, ORG } from "../support/wiremap-fakes.js";

const PROJECT = "018f8c00-0000-7000-8000-0000000000c1" as ProjectId;

class MemoryScans extends ScanRepository {
  public readonly rows: ScanRecord[] = [];
  public open: FindingKey[] = [];
  public replaced: { added: readonly FindingKey[]; removed: readonly FindingKey[] } | null = null;
  public create(_org: OrganizationId, scan: NewScan) {
    this.rows.push({
      ...scan,
      queuedAt: CLOCK.now(),
      startedAt: scan.state === "running" ? CLOCK.now() : null,
      finishedAt: null,
      error: null,
      graphKey: null,
      graphBytes: null,
      counts: null,
      analyzerVersion: null,
    });
    return Promise.resolve();
  }
  public findById(_org: OrganizationId, id: ScanId) {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }
  public list() {
    return Promise.resolve({ items: this.rows, total: this.rows.length });
  }
  public active(_org: OrganizationId, projectId: ProjectId) {
    return Promise.resolve(
      this.rows.find(
        (row) => row.projectId === projectId && (row.state === "queued" || row.state === "running"),
      ) ?? null,
    );
  }
  public latestSucceeded() {
    return Promise.resolve(this.rows.findLast((row) => row.state === "succeeded") ?? null);
  }
  private move(id: ScanId, from: ScanRecord["state"][], change: Partial<ScanRecord>) {
    const index = this.rows.findIndex((row) => row.id === id && from.includes(row.state));
    if (index === -1) return false;
    this.rows[index] = { ...(this.rows[index] as ScanRecord), ...change };
    return true;
  }
  public start(_org: OrganizationId, id: ScanId, at: Date) {
    return Promise.resolve(this.move(id, ["queued"], { state: "running", startedAt: at }));
  }
  public succeed(
    _org: OrganizationId,
    id: ScanId,
    result: Parameters<ScanRepository["succeed"]>[2],
  ) {
    return Promise.resolve(
      this.move(id, ["running"], {
        state: "succeeded",
        finishedAt: result.at,
        counts: result.counts,
        graphKey: result.graphKey,
      }),
    );
  }
  public fail(_org: OrganizationId, id: ScanId, at: Date, error: string) {
    return Promise.resolve(
      this.move(id, ["queued", "running"], { state: "failed", finishedAt: at, error }),
    );
  }
  public failStale(before: Date, at: Date, error: string): Promise<readonly SweptScan[]> {
    const swept: SweptScan[] = [];
    for (const row of this.rows) {
      if ((row.state === "queued" || row.state === "running") && row.queuedAt < before) {
        this.move(row.id, ["queued", "running"], { state: "failed", finishedAt: at, error });
        swept.push({
          organizationId: ORG,
          id: row.id,
          projectId: row.projectId,
          trigger: row.trigger,
          requestedBy: row.requestedBy,
        });
      }
    }
    return Promise.resolve(swept);
  }
  public removeForProject() {
    return Promise.resolve();
  }
  public openFindings() {
    return Promise.resolve(this.open);
  }
  public replaceFindings(
    _org: OrganizationId,
    _project: ProjectId,
    _scan: ScanId,
    change: { added: readonly FindingKey[]; removed: readonly FindingKey[] },
  ) {
    this.replaced = change;
    return Promise.resolve();
  }
}

class Tokens extends ScanTokens {
  public issue(ref: { scanId: string }) {
    return `t-${ref.scanId}`;
  }
  public verify(ref: { scanId: string }, token: string | null) {
    return token === `t-${ref.scanId}`;
  }
}

class Runner extends ScanRunner {
  public constructor(public override readonly configured = true) {
    super();
  }
  public dispatch() {
    return Promise.resolve();
  }
}

class Queue extends QueuePublisher {
  public readonly jobs: string[] = [];
  public publish<T>(queue: string, _payload: T, options?: { name?: string }) {
    this.jobs.push(`${queue}/${options?.name ?? ""}`);
    return Promise.resolve();
  }
}

class Events {
  public readonly names: string[] = [];
  public publish(_actor: unknown, event: { name: string }) {
    this.names.push(event.name);
    return Promise.resolve();
  }
}

const provider = (configured = true) =>
  ({
    configured,
    readToken: () => Promise.resolve({ token: "ghs_x", expiresAt: new Date() }),
  }) as unknown as RepositoryProvider;

const project = (repositories = 1): ProjectRecord => ({
  id: PROJECT,
  slug: "shop",
  name: "Shop",
  description: null,
  visibility: "org",
  defaultRole: "project_editor",
  schedule: "off",
  ignore: ["dist"],
  settings: { tsconfigPath: null, workspace: null },
  repositories: Array.from({ length: repositories }, (_, i) => ({
    id: `018f8c00-0000-7000-8000-00000000d00${i}` as never,
    provider: "github" as const,
    externalId: String(i),
    fullName: `acme/repo${i}`,
    defaultBranch: "main",
    branches: ["main"],
    rootPath: null,
    private: true,
    installationId: 9,
  })),
  createdAt: new Date(),
});

const document = (cycles: string[][], unguarded: string[]): GraphDocument => ({
  version: GRAPH_VERSION,
  meta: {
    analyzer: "0.1.0",
    generatedAt: new Date().toISOString(),
    repositories: [{ name: "acme/repo0", commit: "abc", branch: "main" }],
    timings: { totalMs: 1 },
  },
  languages: [],
  frameworks: [],
  files: [],
  edges: [],
  unresolved: [],
  coverage: { resolved: 3, total: 4 },
  routes: [],
  calls: [],
  insights: {
    mostDepended: [],
    cycles,
    unusedFiles: [],
    unusedExports: [],
    unguardedRoutes: unguarded,
  },
});

const queued = async (scans = new MemoryScans()) => {
  const queue = new Queue();
  const scan = await new QueueScanUseCase(scans, new Runner(), provider(), queue).execute(ORG, {
    project: project(),
    trigger: "manual",
    branch: null,
    requestedBy: null,
  });
  return { scans, queue, scan, ref: { organizationId: ORG, scanId: scan.id } };
};

describe("QueueScanUseCase", () => {
  it("queues one scan and its dispatch job, and hands the same scan back while it is active", async () => {
    const { scans, queue, scan } = await queued();
    const again = await new QueueScanUseCase(scans, new Runner(), provider(), queue).execute(ORG, {
      project: project(),
      trigger: "push",
      branch: "main",
      requestedBy: null,
    });

    expect(again.id).toBe(scan.id);
    expect(queue.jobs).toEqual(["scan/dispatch"]);
  });

  it("refuses a project with no repository or a deployment with no runner", async () => {
    const useCase = (runner: boolean) =>
      new QueueScanUseCase(new MemoryScans(), new Runner(runner), provider(), new Queue());
    const input = { trigger: "manual" as const, branch: null, requestedBy: null };
    await expect(
      useCase(true).execute(ORG, { ...input, project: project(0) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      useCase(false).execute(ORG, { ...input, project: project() }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("the runner protocol", () => {
  it("checks out once, with a token per repository, and refuses a wrong token or a second checkout", async () => {
    const { scans, ref } = await queued();
    const projects = { findById: () => Promise.resolve(project(2)) } as never;
    const checkout = new CheckoutScanUseCase(new Tokens(), scans, projects, provider(), CLOCK);

    await expect(checkout.execute(ref, "wrong")).rejects.toBeInstanceOf(UnauthorizedError);
    const result = await checkout.execute(ref, `t-${ref.scanId}`);
    expect(result.repositories.map((each) => [each.fullName, each.ref, each.token])).toEqual([
      ["acme/repo0", "main", "ghs_x"],
      ["acme/repo1", "main", "ghs_x"],
    ]);
    expect(result.ignore).toEqual(["dist"]);
    await expect(checkout.execute(ref, `t-${ref.scanId}`)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("completes from the graph it reads back, recording only new findings", async () => {
    const { scans, ref } = await queued();
    await scans.start(ORG, ref.scanId, CLOCK.now());
    scans.open = [
      { kind: "unguarded_route", key: "GET /old" },
      { kind: "unguarded_route", key: "GET /users" },
    ];
    const archive = {
      read: () =>
        Promise.resolve({ document: document([["b.ts", "a.ts"]], ["GET /users"]), bytes: 120 }),
    } as unknown as GraphArchive;
    const events = new Events();
    const complete = new CompleteScanUseCase(
      new Tokens(),
      scans,
      archive,
      events as unknown as DomainEventPublisher,
      new DirectUnitOfWork(),
      CLOCK,
    );

    expect(await complete.execute(holding(), ref, `t-${ref.scanId}`)).toEqual({
      state: "succeeded",
    });

    expect(scans.rows[0]?.state).toBe("succeeded");
    expect(scans.rows[0]?.counts).toMatchObject({ resolved: 3, total: 4, cycles: 1, unguarded: 1 });
    expect(scans.replaced).toEqual({
      added: [{ kind: "cycle", key: "a.ts → b.ts" }],
      removed: [{ kind: "unguarded_route", key: "GET /old" }],
    });
    expect(events.names).toEqual(["scan.succeeded", "finding.created"]);
    await expect(complete.execute(holding(), ref, `t-${ref.scanId}`)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("fails a scan whose graph is refused, and one its runner reports", async () => {
    const first = await queued();
    await first.scans.start(ORG, first.ref.scanId, CLOCK.now());
    const archive = {
      read: () => Promise.resolve({ refused: "The graph is larger than 25 MB." }),
    } as unknown as GraphArchive;
    const events = new Events();
    const publisher = events as unknown as DomainEventPublisher;
    await new CompleteScanUseCase(
      new Tokens(),
      first.scans,
      archive,
      publisher,
      new DirectUnitOfWork(),
      CLOCK,
    ).execute(holding(), first.ref, `t-${first.ref.scanId}`);
    expect(first.scans.rows[0]).toMatchObject({
      state: "failed",
      error: "The graph is larger than 25 MB.",
    });

    const second = await queued();
    await new FailScanUseCase(
      new Tokens(),
      second.scans,
      publisher,
      new DirectUnitOfWork(),
      CLOCK,
    ).execute(
      holding(),
      second.ref,
      `t-${second.ref.scanId}`,
      "  tsconfig.json: unexpected token  ",
    );
    expect(second.scans.rows[0]).toMatchObject({
      state: "failed",
      error: "tsconfig.json: unexpected token",
    });
    expect(events.names).toEqual(["scan.failed", "scan.failed"]);
  });
});

describe("SweepScansUseCase", () => {
  it("fails what has been queued or running for over half an hour, and tells each tenant", async () => {
    const { scans } = await queued();
    const later = { now: () => new Date(CLOCK.now().getTime() + 31 * 60 * 1000) };
    const events = new Events();

    const swept = await new SweepScansUseCase(
      scans,
      events as unknown as DomainEventPublisher,
      later,
    ).execute(() => holding());

    expect(swept).toHaveLength(1);
    expect(scans.rows[0]?.state).toBe("failed");
    expect(events.names).toEqual(["scan.failed"]);
  });
});

describe("ScanRefs", () => {
  it("round-trips a reference and refuses anything else", () => {
    const scanId = "018f8c00-0000-7000-8000-0000000000e1" as ScanId;
    const formatted = ScanRefs.format({ organizationId: ORG, scanId });
    expect(ScanRefs.parse(formatted)).toEqual({ organizationId: ORG, scanId });
    expect(ScanRefs.parse(`${formatted}.x`)).toBeNull();
    expect(ScanRefs.parse("not-a-ref")).toBeNull();
    expect(ScanRefs.graphKey(ORG, PROJECT, scanId)).toBe(
      `graphs/${ORG}/${PROJECT}/${scanId}.json.gz`,
    );
  });
});
