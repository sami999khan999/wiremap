import { type DomainId, NotFoundError } from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { MemberDomainRepository } from "./member-domain.repository.js";

export interface RemoveMemberDomainInput {
  readonly domainId: DomainId;
}

export class RemoveMemberDomainUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly domains: MemberDomainRepository,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: RemoveMemberDomainInput): Promise<void> {
    this.authorizer.assert(actor, "member.domain.manage");

    const domain = await this.domains.findById(actor.organizationId, input.domainId);
    if (!domain) throw new NotFoundError("domain", input.domainId);

    await this.unitOfWork.run(async () => {
      await this.domains.delete(actor.organizationId, domain.id);
      await this.activity.record(actor, "member.domain.removed", {
        domainId: domain.id,
        domain: domain.domain,
      });
    });
  }
}
