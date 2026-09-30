import { NotFoundError, type OrganizationId } from "../import.js";
import type { ActivityLogger, QueuePublisher } from "../port/index.js";
import type { Authorizer } from "../primitive/index.js";
import { Principal, QueueName } from "../primitive/index.js";
import type { PlatformReader } from "./platform.reader.js";
import type { TenantRepository } from "./tenant.repository.js";

export interface ExportOrganizationInput {
  readonly organizationId: OrganizationId;
}

export interface ExportRequested {
  readonly jobId: string;
}

// Queued, never done inline: an export is a full read of seven tables streamed to S3,
// and a request that waited for it would hold a connection open for minutes.
export class ExportOrganizationUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly tenants: TenantRepository,
    private readonly queue: QueuePublisher,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
    private readonly clock: { now(): Date },
  ) {}

  public async execute(actor: Principal, input: ExportOrganizationInput): Promise<ExportRequested> {
    this.authorizer.assert(actor, "platform.tenant.manage");

    // Checked before the job is queued, so "no such tenant" is an answer on the screen
    // rather than a worker failure nobody is watching.
    const tenant = await this.tenants.findBy(input.organizationId);
    if (!tenant) throw new NotFoundError("organization", input.organizationId);

    const day = this.clock.now().toISOString().slice(0, 10);

    // **No `:`** — BullMQ rejects a colon in a job id. One per tenant per day, which is
    // also what the object keys are: a second request today replaces nothing.
    const jobId = `tenant-export.${input.organizationId}.${day}`;

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );
    await this.activity.record(auditor, "tenant.export_requested", {
      organizationId: input.organizationId,
      slug: tenant.slug,
      day,
    });

    await this.queue.publish(
      QueueName.MAINTENANCE,
      { organizationId: input.organizationId, day },
      { jobId, name: "tenant-export" },
    );

    return { jobId };
  }
}
