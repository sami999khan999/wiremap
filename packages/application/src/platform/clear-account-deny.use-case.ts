import { ConflictError, NotFoundError, type OrganizationId } from "../import.js";
import type { ActivityLogger, CapabilityInvalidator, UnitOfWork } from "../port/index.js";
import { type Authorizer, Principal } from "../primitive/index.js";
import type { PermissionOverrideRepository } from "../rbac/index.js";
import type { PlatformReader } from "./platform.reader.js";

export interface ClearAccountDenyInput {
  readonly organizationId: OrganizationId;
  readonly overrideId: string;
}

// The platform's half of clearing: its own denies only. An org's exception is the org
// admin's to clear, and the tier reaching into it would be a second way to change it.
export class ClearAccountDenyUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly overrides: PermissionOverrideRepository,
    private readonly platform: PlatformReader,
    private readonly invalidator: CapabilityInvalidator,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: ClearAccountDenyInput): Promise<void> {
    this.authorizer.assert(actor, "platform.account.manage");

    const row = await this.overrides.findById(input.organizationId, input.overrideId);
    if (!row) throw new NotFoundError("override", input.overrideId);
    if (row.authority !== "platform") throw new ConflictError("override", "org");

    const tier = await this.platform.organizationId();
    const organizations = new Set<OrganizationId>([input.organizationId, tier]);
    await this.unitOfWork.run(async () => {
      await this.overrides.delete(input.organizationId, row.id);
      for (const organizationId of organizations) {
        const auditor = new Principal(organizationId, actor.userId, actor.capabilities, actor.kind);
        await this.activity.record(auditor, "override.cleared", {
          userId: row.userId,
          organizationId: input.organizationId,
          permission: row.permission,
          effect: row.effect,
          authority: "platform",
        });
      }
    });

    await this.invalidator.invalidate(input.organizationId, row.userId);
  }
}
