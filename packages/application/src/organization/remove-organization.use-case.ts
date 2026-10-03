import { ConflictError, NotFoundError } from "../import.js";
import type { TenantRepository } from "../platform/index.js";
import type { ActivityLogger, QueuePublisher } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { QueueName } from "../primitive/index.js";

export interface RemoveOrganizationInput {
  // Typed back by the owner and compared here, as `DeleteOrganizationUseCase` compares
  // the platform admin's: a confirmation the server does not check is no confirmation.
  readonly confirmSlug: string;
}

// The owner's own delete. The request half only: the same `tenant-delete` maintenance job
// the platform runs does the work, placed on the tenant's node.
export class RemoveOrganizationUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly tenants: TenantRepository,
    private readonly queue: QueuePublisher,
    private readonly activity: ActivityLogger,
  ) {}

  public async execute(actor: Principal, input: RemoveOrganizationInput): Promise<void> {
    this.authorizer.assert(actor, "organization.delete");

    const tenant = await this.tenants.findBy(actor.organizationId);
    if (!tenant) throw new NotFoundError("organization", actor.organizationId);
    if (tenant.isPlatform) throw new ConflictError("organization", "platform");
    if (tenant.slug !== input.confirmSlug.trim()) throw new ConflictError("organization", "slug");

    await this.activity.record(actor, "organization.deletion.requested", {
      slug: tenant.slug,
      name: tenant.name,
    });

    await this.queue.publish(
      QueueName.MAINTENANCE,
      { organizationId: actor.organizationId, actorId: actor.userId },
      { inFlightId: `tenant-delete.${actor.organizationId}`, name: "tenant-delete" },
    );
  }
}
