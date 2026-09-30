import { NotFoundError, type OrganizationId, ValidationError } from "../import.js";
import type { ActivityLogger, PartitionArchiveGateway, QueuePublisher } from "../port/index.js";
import type { Authorizer } from "../primitive/index.js";
import {
  PartitionedTable,
  type PartitionedTableName,
  Principal,
  QueueName,
} from "../primitive/index.js";
import type { PlatformReader } from "./platform.reader.js";

export interface RestorePartitionInput {
  readonly tableName: string;
  // ISO `YYYY-MM-DD`, the first of the month — the same string `partition_archive`
  // stores and the same one a replay is asked for.
  readonly period: string;
  // Absent restores every tenant that has a row for the month, which is what an
  // operator means by "restore March".
  readonly organizationId?: OrganizationId;
}

export interface RestoreRequested {
  readonly jobId: string;
  readonly objects: number;
}

const PERIOD = /^\d{4}-\d{2}-01$/;

// Queued, never done inline: a month is a stream out of S3 and an insert per batch, and
// a request that waited for it would hold a connection open for minutes.
export class RestorePartitionUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly archive: PartitionArchiveGateway,
    private readonly queue: QueuePublisher,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
  ) {}

  public async execute(actor: Principal, input: RestorePartitionInput): Promise<RestoreRequested> {
    this.authorizer.assert(actor, "platform.retention.manage");

    const table = RestorePartitionUseCase.assertKnownTable(input.tableName);
    if (!PERIOD.test(input.period)) {
      throw new ValidationError([{ field: "period", rule: "format" }]);
    }

    // Checked before the job is queued, so "there is nothing archived for that month"
    // is an answer on the screen rather than a worker failure nobody is watching.
    const entries = await this.archive.entriesFor(table, input.period, input.organizationId);
    if (entries.length === 0) {
      throw new NotFoundError("cold", `${table}/${input.period}`);
    }

    // **No `:`** — BullMQ keys on `jobId` and rejects one containing a colon at publish
    // time, which is why this is not the `<job>:<table>:<period>` the plan sketched.
    const jobId = `cold-restore.${table}.${input.period}.${input.organizationId ?? "all"}`;

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );
    await this.activity.record(auditor, "platform.restore.requested", {
      tableName: table,
      period: input.period,
      organizationId: input.organizationId ?? null,
      objects: entries.length,
    });

    // The dedupe id is the request: a double click is one job, and a second request for
    // the same month while the first is running is the same job. After, a new one.
    await this.queue.publish(
      QueueName.MAINTENANCE,
      { table, period: input.period, organizationId: input.organizationId ?? null },
      { inFlightId: jobId, name: "cold-restore" },
    );

    return { jobId, objects: entries.length };
  }

  private static assertKnownTable(tableName: string): PartitionedTableName {
    const known = PartitionedTable.MONTH_PARTITIONED.find((entry) => entry.name === tableName);
    if (!known) throw new ValidationError([{ field: "tableName", rule: "unknown" }]);
    return known.name;
  }
}
