import { Identifiers } from "@loadbearing/contracts";
import { ForbiddenError, ValidationError } from "@loadbearing/errors";
import { CapabilitySet, type PermissionKey } from "@loadbearing/permissions";
import { describe, expect, it } from "vitest";
import { PreviewRetentionChangeUseCase } from "../../src/platform/preview-retention-change.use-case.js";
import type { MaintenanceGateway, PartitionEstimate } from "../../src/port/index.js";
import { Authorizer } from "../../src/primitive/authorizer.js";
import { Principal } from "../../src/primitive/principal.js";

const ORG = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000010");
const ACTOR = Identifiers.userId.parse("018f8c00-0000-7000-8000-000000000011");
const NOW = new Date("2026-08-15T00:00:00.000Z");

// Records what it was asked for: the cutoff is the whole behaviour, and a double that
// ignored it would let the arithmetic drift from `prune()`'s without a failure.
class RecordingMaintenance implements Partial<MaintenanceGateway> {
  public readonly asked: { table: string; cutoff: Date; organizationId: string | null }[] = [];

  public constructor(private readonly estimates: readonly PartitionEstimate[] = []) {}

  public partitionsBefore(
    table: string,
    cutoff: Date,
    organizationId?: string | null,
  ): Promise<readonly PartitionEstimate[]> {
    this.asked.push({ table, cutoff, organizationId: organizationId ?? null });
    return Promise.resolve(this.estimates);
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

const useCase = (maintenance: RecordingMaintenance) =>
  new PreviewRetentionChangeUseCase(
    new Authorizer(),
    maintenance as unknown as MaintenanceGateway,
    { now: () => NOW },
  );

const estimate = (name: string, period: Date, rows: number, bytes: number): PartitionEstimate => ({
  name,
  period,
  estimatedRows: rows,
  bytes,
});

describe("PreviewRetentionChangeUseCase", () => {
  // The same arithmetic `prune()` runs. If the two drift, an operator is shown one set
  // of partitions and the next run drops another.
  it("asks for partitions before the month the cutoff falls in", async () => {
    const maintenance = new RecordingMaintenance();
    await useCase(maintenance).execute(actor("platform.retention.read"), {
      tableName: "activity_log",
      hotMonths: 6,
    });

    expect(maintenance.asked).toEqual([
      // `organizationId: null` is the table-wide read, and asserting it here is what
      // keeps `19.19`'s per-tenant preview from silently becoming the default.
      { table: "activity_log", cutoff: new Date(Date.UTC(2026, 1, 1)), organizationId: null },
    ]);
  });

  it("totals the partitions, the estimated rows and the bytes", async () => {
    const maintenance = new RecordingMaintenance([
      estimate("activity_log_2024_01", new Date(Date.UTC(2024, 0, 1)), 10, 1024),
      estimate("activity_log_2024_02", new Date(Date.UTC(2024, 1, 1)), 7, 512),
    ]);

    const preview = await useCase(maintenance).execute(actor("platform.retention.read"), {
      tableName: "activity_log",
      hotMonths: 13,
    });

    expect(preview.totalPartitions).toBe(2);
    expect(preview.estimatedRows).toBe(17);
    expect(preview.bytes).toBe(1536);
    expect(preview.partitions[0]?.period).toBe("2024-01-01");
  });

  it("answers zero for a change that would drop nothing", async () => {
    const preview = await useCase(new RecordingMaintenance()).execute(
      actor("platform.retention.read"),
      { tableName: "notifications", hotMonths: 120 },
    );

    expect(preview.totalPartitions).toBe(0);
    expect(preview.partitions).toEqual([]);
  });

  // Read rather than manage: seeing what a change would destroy must not require the
  // right to cause it, or nobody reviews the number before somebody with the right types it.
  it("asks for read rather than manage", async () => {
    await expect(
      useCase(new RecordingMaintenance()).execute(actor("platform.retention.manage"), {
        tableName: "activity_log",
        hotMonths: 6,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // Decision D37: the name reaches DDL through `partitionsBefore`, so the closed union
  // is the injection boundary and this is where a free string stops.
  it("refuses a table the allowlist does not name", async () => {
    const maintenance = new RecordingMaintenance();

    await expect(
      useCase(maintenance).execute(actor("platform.retention.read"), {
        tableName: "users; drop table organizations",
        hotMonths: 6,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(maintenance.asked).toEqual([]);
  });

  // `conversations` is tenant-partitioned with no month level, so there is no cutoff to
  // compute and `partitionsBefore` would throw rather than answer.
  it("refuses a partitioned table with no month level", async () => {
    await expect(
      useCase(new RecordingMaintenance()).execute(actor("platform.retention.read"), {
        tableName: "conversations",
        hotMonths: 6,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses zero months, which would drop the month being written to", async () => {
    await expect(
      useCase(new RecordingMaintenance()).execute(actor("platform.retention.read"), {
        tableName: "activity_log",
        hotMonths: 0,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// `19.19`: the screen edits a tenant's override and used to preview the table's own
// numbers, which are a different set of partitions and usually a much larger one.
describe("PreviewRetentionChangeUseCase for one tenant", () => {
  const OTHER = Identifiers.organizationId.parse("018f8c00-0000-7000-8000-000000000099");

  it("asks the gateway for that tenant's partitions rather than every tenant's", async () => {
    const maintenance = new RecordingMaintenance();
    const useCase = new PreviewRetentionChangeUseCase(
      new Authorizer(),
      maintenance as unknown as MaintenanceGateway,
      { now: () => NOW },
    );

    await useCase.execute(actor("platform.retention.read"), {
      tableName: "activity_log",
      hotMonths: 3,
      organizationId: OTHER,
    });

    expect(maintenance.asked[0]?.organizationId).toBe(OTHER);
  });

  it("still asks across every tenant when none is named", async () => {
    const maintenance = new RecordingMaintenance();
    const useCase = new PreviewRetentionChangeUseCase(
      new Authorizer(),
      maintenance as unknown as MaintenanceGateway,
      { now: () => NOW },
    );

    await useCase.execute(actor("platform.retention.read"), {
      tableName: "activity_log",
      hotMonths: 3,
    });

    expect(maintenance.asked[0]?.organizationId).toBeNull();
  });

  it("echoes the tenant back, so two previews in flight cannot be confused", async () => {
    const maintenance = new RecordingMaintenance();
    const useCase = new PreviewRetentionChangeUseCase(
      new Authorizer(),
      maintenance as unknown as MaintenanceGateway,
      { now: () => NOW },
    );

    const preview = await useCase.execute(actor("platform.retention.read"), {
      tableName: "activity_log",
      hotMonths: 3,
      organizationId: OTHER,
    });

    expect(preview.organizationId).toBe(OTHER);
  });

  // The same predicate `UpdateTenantRetentionUseCase` refuses on, so the screen cannot
  // offer a preview of an override that would not save. `doc_revision` is
  // ──
  // `retentionMonths: null` — the calendar never retires it.
  it("refuses a tenant preview of a table the calendar never retires", async () => {
    const useCase = new PreviewRetentionChangeUseCase(
      new Authorizer(),
      new RecordingMaintenance() as unknown as MaintenanceGateway,
      { now: () => NOW },
    );

    await expect(
      useCase.execute(actor("platform.retention.read"), {
        tableName: "doc_revision",
        hotMonths: 3,
        organizationId: OTHER,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // And the table-wide preview of the same table is still allowed: nothing is being
  // saved, and the number is the honest answer to "what would three months retire".
  it("allows the table-wide preview of that same table", async () => {
    const useCase = new PreviewRetentionChangeUseCase(
      new Authorizer(),
      new RecordingMaintenance() as unknown as MaintenanceGateway,
      { now: () => NOW },
    );

    const preview = await useCase.execute(actor("platform.retention.read"), {
      tableName: "doc_revision",
      hotMonths: 3,
    });

    expect(preview.tableName).toBe("doc_revision");
  });
});
