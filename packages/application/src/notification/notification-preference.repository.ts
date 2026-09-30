import type {
  NotificationCategory,
  NotificationChannel,
  NotificationMode,
  OrganizationId,
  UserId,
} from "../import.js";

export interface PreferenceRecord {
  readonly userId: UserId;
  readonly category: NotificationCategory;
  readonly channel: NotificationChannel;
  readonly mode: NotificationMode;
}

export abstract class NotificationPreferenceRepository {
  // **One query for many users**, not one per user: a delivery fanning out to a hundred
  // recipients would otherwise be a hundred round trips before it writes anything.
  public abstract findFor(
    organizationId: OrganizationId,
    userIds: readonly UserId[],
    category: NotificationCategory,
  ): Promise<readonly PreferenceRecord[]>;

  public abstract listFor(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<readonly PreferenceRecord[]>;

  // Upsert on `(organization_id, user_id, category, channel)`. An absent row is the
  // policy's default, so this table holds only what somebody actually changed.
  public abstract save(
    organizationId: OrganizationId,
    userId: UserId,
    preference: Omit<PreferenceRecord, "userId">,
  ): Promise<void>;
}
