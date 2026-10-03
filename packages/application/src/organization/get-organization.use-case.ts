import { NotFoundError } from "../import.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { OrganizationRecord, OrganizationRepository } from "./organization.repository.js";

export class GetOrganizationUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly organizations: OrganizationRepository,
  ) {}

  public async execute(actor: Principal): Promise<OrganizationRecord> {
    this.authorizer.assert(actor, "member.read");
    const organization = await this.organizations.findById(actor.organizationId);
    if (!organization) throw new NotFoundError("organization", actor.organizationId);
    return organization;
  }
}
