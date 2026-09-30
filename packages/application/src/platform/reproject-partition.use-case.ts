import { ConflictError, NotFoundError, type OrganizationId, ValidationError } from "../import.js";
import type { ActivityLogger, PartitionArchiveGateway, QueuePublisher } from "../port/index.js";
import type { Authorizer } from "../primitive/index.js";
import { PartitionedTable, Principal, QueueName } from "../primitive/index.js";
import type { PlatformReader } from "./platform.reader.js";
import type { PlatformHealthReader } from "./platform-health.reader.js";

export interface ReprojectPartitionInput {
  // ISO `YYYY-MM-01`. The first of a month, which is what `partition_archive` stores.
  readonly period: string;
  // Absent re-projects every tenant that has a row for the month, which is what an
  // operator means by "fill March".
  readonly organizationId?: OrganizationId;
}

export interface ReprojectRequested {
  readonly jobId: string;
  readonly objects: number;
}

const PERIOD = /^\d{4}-\d{2}-01$/;

// `activity_log` only, and that is not a limitation to lift later: it is the one table
// the analytics store is a projection of.
export class ReprojectPartitionUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly archive: PartitionArchiveGateway,
    private readonly queue: QueuePublisher,
    private readonly health: PlatformHealthReader,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
  ) {}

  public async execute(
    actor: Principal,
    input: ReprojectPartitionInput,
  ): Promise<ReprojectRequested> {
    this.authorizer.assert(actor, "platform.analytics.manage");

    if (!PERIOD.test(input.period)) {
      throw new ValidationError([{ field: "period", rule: "format" }]);
    }

    // There is nowhere to project to. Refused here rather than in the worker, so the
    // answer lands on the screen instead of in a job nobody is watching.
    if ((await this.health.report()).analytics === null) {
      throw new ConflictError("analytics", "not_configured");
    }

    const entries = await this.archive.entriesFor(
      PartitionedTable.ACTIVITY_LOG,
      input.period,
      input.organizationId,
    );
    if (entries.length === 0) {
      throw new NotFoundError("cold", `${PartitionedTable.ACTIVITY_LOG}/${input.period}`);
    }

    // **No `:`** — BullMQ rejects a colon in a job id. One job while one is queued or
    // running, and a new one after it has finished (`CR.18`).
    const jobId = `cold-reproject.activity_log.${input.period}.${input.organizationId ?? "all"}`;

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );
    await this.activity.record(auditor, "platform.reproject.requested", {
      period: input.period,
      organizationId: input.organizationId ?? null,
      objects: entries.length,
    });

    await this.queue.publish(
      QueueName.ANALYTICS,
      { period: input.period, organizationId: input.organizationId ?? null },
      { inFlightId: jobId, name: "cold-reproject" },
    );

    return { jobId, objects: entries.length };
  }
}
