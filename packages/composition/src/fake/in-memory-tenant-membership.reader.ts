import { type OrganizationId, TenantMembershipReader, type UserId } from "../import.js";

// Everyone is a member unless named absent. The inverse default would refuse every
// add-member in every spec that is not about membership, which is most of them.
export class InMemoryTenantMembershipReader extends TenantMembershipReader {
  private readonly absent: ReadonlySet<string>;

  public constructor(absent: readonly UserId[] = []) {
    super();
    this.absent = new Set(absent);
  }

  public override isActiveMember(
    _organizationId: OrganizationId,
    userId: UserId,
  ): Promise<boolean> {
    return Promise.resolve(!this.absent.has(userId));
  }

  public override activeMemberIds(
    _organizationId: OrganizationId,
    userIds: readonly UserId[],
  ): Promise<ReadonlySet<UserId>> {
    return Promise.resolve(new Set(userIds.filter((userId) => !this.absent.has(userId))));
  }
}
