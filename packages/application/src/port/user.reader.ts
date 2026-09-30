import type { OrganizationId, UserId } from "../import.js";

// The display name behind a user id, and nothing else. `users` is a catalog table and a
// conversation's members are routed, so no repository may join the two.
export abstract class UserReader {
  // Tenant first and scoped by it, so an id from another tenant resolves to nothing.
  // A deactivated member still has a name: filtering one out renders a uuid instead.
  public abstract namesOf(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
  ): Promise<ReadonlyMap<UserId, string>>;
}
