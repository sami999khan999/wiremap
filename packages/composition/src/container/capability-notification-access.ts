import {
  type CapabilityCache,
  NotificationAccess,
  type OrganizationId,
  type UserId,
} from "../import.js";

// The same capability set a request would resolve, so a mention never reaches someone
// the project would answer `NOT_FOUND` to.
export class CapabilityNotificationAccess extends NotificationAccess {
  public constructor(private readonly capabilities: CapabilityCache) {
    super();
  }

  public override async readsProject(
    organizationId: OrganizationId,
    userId: UserId,
    projectId: string,
  ): Promise<boolean> {
    const set = await this.capabilities.forUser(organizationId, userId);
    return set.can("project.graph.read", projectId);
  }
}
