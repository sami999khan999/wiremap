import type { CapabilitySet, UserId } from "../import.js";
import { NotFoundError } from "../import.js";
import type { MemberRepository } from "../member/index.js";
import type { Authorizer, Principal } from "../primitive/index.js";
import type { CapabilityExplanation, CapabilityRepository } from "./capability.repository.js";
import { CapabilityResolution } from "./capability-resolution.js";

export interface InspectEffectivePermissionsInput {
  readonly userId: UserId;
}

export interface EffectivePermissions {
  readonly capabilities: CapabilitySet;
  // What the answer is made of, so the screen can name each key's source.
  readonly explanation: CapabilityExplanation;
}

// "What can this person actually do here" — resolved from the same repository
// `CapabilityCache` reads, so the answer is the one `Authorizer.assert()` would give.
export class InspectEffectivePermissionsUseCase {
  public constructor(
    private readonly authorizer: Authorizer,
    private readonly members: MemberRepository,
    private readonly capabilities: CapabilityRepository,
  ) {}

  public async execute(
    actor: Principal,
    input: InspectEffectivePermissionsInput,
  ): Promise<EffectivePermissions> {
    this.authorizer.assert(actor, "rbac.effective.inspect");

    // Membership first: without it, a uuid from another tenant would resolve to an
    // empty set and read as "this person has no permissions" rather than "not here".
    const member = await this.members.findByUser(actor.organizationId, input.userId);
    if (!member) throw new NotFoundError("member", input.userId);

    // One read and one fold: the same fold `resolveFor` runs, so the two cannot disagree.
    const explanation = await this.capabilities.explainFor(actor.organizationId, member.userId);
    return { capabilities: CapabilityResolution.fold(explanation), explanation };
  }
}
