import type { Locale, OrganizationId, PermissionKey, UserId } from "../import.js";

export interface Recipient {
  readonly userId: UserId;
  readonly email: string;
  readonly name: string;
  readonly locale: Locale;
}

// A read seam and never a write one: a write method here would make a derived view of
// membership authoritative.
export abstract class NotificationRecipientReader {
  // Every method takes the tenant first. A recipient list that cannot be scoped is a
  // cross-tenant leak with an email address attached.
  public abstract organizationMembers(
    organizationId: OrganizationId,
    holding: PermissionKey | null,
    limit: number,
    afterUserId: UserId | null,
  ): Promise<readonly Recipient[]>;

  public abstract user(organizationId: OrganizationId, userId: UserId): Promise<Recipient | null>;

  public abstract users(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
  ): Promise<readonly Recipient[]>;
}
