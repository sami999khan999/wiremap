import { NotFoundError, type UserId } from "../import.js";
import type { MemberRepository } from "../member/member.repository.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type {
  PermissionOverrideRecord,
  PermissionOverrideRepository,
} from "./permission-override.repository.js";

export interface ListPermissionOverridesInput {
  readonly userId: UserId;
}

// One member's live exceptions, the platform's locked denies among them.
export class ListPermissionOverridesUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly members: MemberRepository,
    private readonly overrides: PermissionOverrideRepository,
  ) {}

  public async execute(
    actor: Principal,
    input: ListPermissionOverridesInput,
  ): Promise<readonly PermissionOverrideRecord[]> {
    this.authorizer.assert(actor, "rbac.override.read");

    // Membership first, so a uuid from another tenant is "not here" rather than "none".
    const member = await this.members.findByUser(actor.organizationId, input.userId);
    if (!member) throw new NotFoundError("member", input.userId);

    return this.overrides.findFor(actor.organizationId, member.userId);
  }
}
