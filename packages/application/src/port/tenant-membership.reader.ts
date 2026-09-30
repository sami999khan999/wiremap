import type { OrganizationId, UserId } from "../import.js";

// "Is this person an active member of this tenant", for use-cases taking a user id as
// input. `auth` asks the same of a session, and `application` sits to its left.
export abstract class TenantMembershipReader {
  // Named apart from `auth`'s `isActive` on purpose: that one takes the user first, and
  // parameters compare bivariantly, so a swap would typecheck and then misread at run.
  public abstract isActiveMember(organizationId: OrganizationId, userId: UserId): Promise<boolean>;

  // The same question for many at once, in one query: which of these are active members.
  public abstract activeMemberIds(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
  ): Promise<ReadonlySet<UserId>>;
}
