import { NotFoundError } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { OrganizationRecord, OrganizationRepository } from "./organization.repository.js";

export interface UpdateOrganizationInput {
  readonly name: string;
}

export class UpdateOrganizationUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly organizations: OrganizationRepository,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(
    actor: Principal,
    input: UpdateOrganizationInput,
  ): Promise<OrganizationRecord> {
    this.authorizer.assert(actor, "organization.profile.update");

    const before = await this.organizations.findById(actor.organizationId);
    if (!before) throw new NotFoundError("organization", actor.organizationId);
    const name = input.name.trim();
    if (name === before.name) return before;

    await this.unitOfWork.run(async () => {
      await this.organizations.rename(actor.organizationId, name);
      await this.activity.record(actor, "organization.updated", { from: before.name, to: name });
    });

    return { ...before, name };
  }
}
