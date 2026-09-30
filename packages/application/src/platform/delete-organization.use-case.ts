import { ConflictError, NotFoundError, type OrganizationId } from "../import.js";
import type { ActivityLogger, QueuePublisher } from "../port/index.js";
import type { Authorizer } from "../primitive/index.js";
import { Principal, QueueName } from "../primitive/index.js";
import type { PlatformReader } from "./platform.reader.js";
import type { TenantRepository } from "./tenant.repository.js";

export interface DeleteOrganizationInput {
  readonly organizationId: OrganizationId;
  // Typed by the operator and compared here, not only in the browser: a confirmation
  // the server does not check is a confirmation the API does not have.
  readonly slug: string;
}

export interface DeleteRequested {
  readonly jobId: string;
}

// The request half. Everything that reads or writes the tenant's own rows is
// `PurgeOrganizationUseCase`, which the worker runs placed on the tenant's node.
export class DeleteOrganizationUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly tenants: TenantRepository,
    private readonly queue: QueuePublisher,
    private readonly platform: PlatformReader,
    private readonly activity: ActivityLogger,
  ) {}

  public async execute(actor: Principal, input: DeleteOrganizationInput): Promise<DeleteRequested> {
    this.authorizer.assert(actor, "platform.tenant.manage");

    // Every guard runs here rather than in the job, so a mistyped slug is a sentence on
    // the screen rather than a worker failure nobody is watching.
    const tenant = await this.tenants.findBy(input.organizationId);
    if (!tenant) throw new NotFoundError("organization", input.organizationId);

    // The tier holds the platform roles every admin's capability comes from, this one
    // included. Deleting it locks the deployment out of its own platform screens.
    if (tenant.isPlatform) throw new ConflictError("organization", "platform");
    if (tenant.slug !== input.slug) throw new ConflictError("organization", "slug");

    // **No `:`** — BullMQ rejects a colon in a job id. One per tenant *in flight*: a
    // double click is one job, and a retry after a failure is a new one (`CR.18`).
    const jobId = `tenant-delete.${input.organizationId}`;

    const auditor = new Principal(
      await this.platform.organizationId(),
      actor.userId,
      actor.capabilities,
      actor.kind,
    );
    await this.activity.record(auditor, "tenant.delete_requested", {
      organizationId: input.organizationId,
      slug: tenant.slug,
      name: tenant.name,
    });

    await this.queue.publish(
      QueueName.MAINTENANCE,
      { organizationId: input.organizationId, actorId: actor.userId },
      { inFlightId: jobId, name: "tenant-delete" },
    );

    return { jobId };
  }
}
