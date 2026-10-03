import type { OrganizationId, UserId } from "../import.js";

// Whether a person may read a project, for a notification about it. A port because the
// answer is the capability read, which lives behind the cache in another package.
export abstract class NotificationAccess {
  public abstract readsProject(
    organizationId: OrganizationId,
    userId: UserId,
    projectId: string,
  ): Promise<boolean>;
}
