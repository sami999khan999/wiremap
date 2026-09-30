import type { AnalyticsProjector, StoragePolicyGateway } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { PartitionedTable } from "../primitive/index.js";
import type { ProjectionPolicyRepository } from "./projection-policy.repository.js";
import { RetentionRules } from "./retention.rules.js";
import type {
  ColdMode,
  RetentionPolicyRecord,
  RetentionPolicyRepository,
} from "./retention-policy.repository.js";

// One row per table on the allowlist, whether or not a policy row exists for it —
// **the screen lists what is partitionable, not what somebody has already edited.**
export interface RetentionEntry {
  readonly tableName: string;
  readonly hotMonths: number | null;
  readonly coldMonths: number | null;
  readonly coldMode: ColdMode;
  // True when the numbers come from `PartitionedTable.ALL` rather than from a row. The
  // screen says so, because "12 because nobody has decided" reads differently from "12".
  readonly isDefault: boolean;
  // `null` hot months means the calendar never retires this table — `messages`, which
  // is domain data. The screen renders it read-only rather than as a zero.
  readonly neverDropped: boolean;
}

export interface ClickHouseRetention {
  readonly months: number;
  readonly isDefault: boolean;
  // What the store currently holds, so the screen can show drift rather than assume the
  // last write landed. Empty when no analytics store is configured.
  readonly applied: string;
  readonly expected: string;
}

export interface RetentionPolicies {
  readonly postgres: readonly RetentionEntry[];
  readonly clickhouse: ClickHouseRetention | null;
  // What the bucket currently holds beside what the rows compose to. A screen that
  // showed only the rows would say "saved" about a call that failed after the commit.
  readonly lifecycle: { readonly applied: readonly string[]; readonly expected: readonly string[] };
}

export class ListRetentionPoliciesUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly policies: RetentionPolicyRepository,
    private readonly storagePolicy: StoragePolicyGateway,
    // Absent on a deployment with no analytics store, which is the third state the
    // screen renders — not configured, rather than on or off.
    private readonly projector: AnalyticsProjector | null,
    // The per-action clauses. Without them `expected` was the base clause alone and the
    // screen reported drift against a store that was exactly right.
    private readonly projectionPolicies: ProjectionPolicyRepository,
  ) {}

  public async execute(actor: Principal): Promise<RetentionPolicies> {
    this.authorizer.assert(actor, "platform.retention.read");

    const rows = await this.policies.all();
    const byTable = new Map(
      rows.filter((row) => row.store === "postgres").map((row) => [row.tableName, row]),
    );

    const expected = RetentionRules.lifecycleFor(rows, this.storagePolicy.coldTier());
    const [applied, clickhouse] = await Promise.all([
      this.storagePolicy.lifecycle(),
      this.clickhouseFor(rows),
    ]);

    return {
      postgres: PartitionedTable.MONTH_PARTITIONED.map((entry) =>
        ListRetentionPoliciesUseCase.entryFor(entry, byTable.get(entry.name)),
      ),
      clickhouse,
      lifecycle: {
        expected: expected.map((rule) => RetentionRules.describe(rule)),
        applied: [...applied]
          .sort((left, right) => left.prefix.localeCompare(right.prefix))
          .map((rule) => RetentionRules.describe(rule)),
      },
    };
  }

  private async clickhouseFor(
    rows: readonly RetentionPolicyRecord[],
  ): Promise<ClickHouseRetention | null> {
    if (!this.projector) return null;

    const row = rows.find((candidate) => candidate.store === "clickhouse");
    const months = row?.hotMonths ?? RetentionRules.DEFAULT_CLICKHOUSE_MONTHS;
    const [applied, projection] = await Promise.all([
      this.projector.retention(),
      this.projectionPolicies.all(),
    ]);

    return {
      months,
      isDefault: row === undefined,
      applied,
      expected: RetentionRules.clickhouseTtlFrom(rows, projection),
    };
  }

  // The allowlist entry is the default an absent row falls back to, which is decision
  // D23's surviving half and the reason an empty table changes no behaviour.
  private static entryFor(
    entry: { readonly name: string; readonly retentionMonths: number | null },
    row: RetentionPolicyRecord | undefined,
  ): RetentionEntry {
    return {
      tableName: entry.name,
      hotMonths: row?.hotMonths ?? entry.retentionMonths,
      coldMonths: row?.coldMonths ?? null,
      coldMode: row?.coldMode ?? "archive",
      isDefault: row === undefined,
      neverDropped: entry.retentionMonths === null && row === undefined,
    };
  }
}
