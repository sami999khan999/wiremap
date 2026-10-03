import {
  ConflictError,
  type DomainId,
  NotFoundError,
  type RoleId,
  Uuid,
  ValidationError,
} from "../import.js";
import type { ActivityLogger, UnitOfWork } from "../port/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import { type CapabilityRepository, type RoleRepository, RoleRules } from "../rbac/index.js";
import type { MemberDomainRecord, MemberDomainRepository } from "./member-domain.repository.js";
import { MemberDomainRules } from "./member-domain.rules.js";

export interface AddMemberDomainInput {
  readonly domain: string;
  readonly roleId: RoleId;
}

// Claims an email domain for auto-join. Each refusal is a way a stranger would walk in:
// a public provider, a domain the claimant gets no verified mail at, or another's claim.
export class AddMemberDomainUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly domains: MemberDomainRepository,
    private readonly roles: RoleRepository,
    private readonly entitlements: CapabilityRepository,
    private readonly activity: ActivityLogger,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  public async execute(actor: Principal, input: AddMemberDomainInput): Promise<MemberDomainRecord> {
    this.authorizer.assert(actor, "member.domain.manage");

    const domain = MemberDomainRules.normalise(input.domain);
    if (MemberDomainRules.isPublic(domain)) {
      throw new ValidationError([{ field: "domain", rule: "publicDomain" }]);
    }

    const email = await this.domains.verifiedEmailOf(actor.userId);
    if (!email || MemberDomainRules.domainOf(email) !== domain) {
      throw new ValidationError([{ field: "domain", rule: "notYourDomain" }]);
    }

    const role = await this.roles.findById(actor.organizationId, input.roleId);
    if (!role) throw new NotFoundError("role", input.roleId);
    RoleRules.assertAssignableBy(
      actor,
      role,
      await this.entitlements.entitlementFor(actor.organizationId),
    );

    if (await this.domains.isClaimed(domain)) throw new ConflictError("domain", "claimed");

    const id = Uuid.v7() as DomainId;
    await this.unitOfWork.run(async () => {
      await this.domains.save(actor.organizationId, {
        id,
        domain,
        roleId: role.id,
        createdBy: actor.userId,
      });
      await this.activity.record(actor, "member.domain.added", {
        domainId: id,
        domain,
        roleId: role.id,
      });
    });

    const saved = await this.domains.findById(actor.organizationId, id);
    if (!saved) throw new NotFoundError("domain", id);
    return saved;
  }
}
